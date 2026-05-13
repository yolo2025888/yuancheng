import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message
} from 'antd';
import type { TableColumnsType } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { useI18n } from '../i18n/I18nContext';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, DeviceRecord } from '../types/models';

type IssuedTokenModalState = {
  deviceId: string;
  deviceName: string;
  token: string;
};

type RevokeTokenModalState = {
  deviceId: string;
  deviceName: string;
};

type PendingAction =
  | {
      deviceId: string;
      type: 'issue' | 'revoke';
    }
  | null;

export function DevicesPage() {
  const { t, text } = useI18n();
  const { canAccess, permissionsResolved } = useAuth();
  const [rows, setRows] = useState<DeviceRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [credentialStatus, setCredentialStatus] = useState<ApiStatus | null>(null);
  const [issuedTokenModal, setIssuedTokenModal] = useState<IssuedTokenModalState | null>(null);
  const [revokeTokenModal, setRevokeTokenModal] = useState<RevokeTokenModalState | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const canManageDeviceTokens = !permissionsResolved || canAccess('device_tokens.manage');

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);

    try {
      const result = await adminApi.getDevices();
      setRows(result.data);
      setApiStatus(result.apiStatus);
      return result;
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  const summary = useMemo(() => {
    const remoteCount = rows.filter((row) => row.metadataLabels?.some((label) => label.includes('Remote'))).length;
    const lockedCount = rows.filter((row) => row.metadataLabels?.some((label) => label.includes('Locked'))).length;
    const tokenCount = rows.filter((row) => row.hasAgentToken).length;
    const revokedCount = rows.filter((row) => Boolean(row.agentTokenRevokedAt)).length;

    return { remoteCount, lockedCount, tokenCount, revokedCount };
  }, [rows]);

  const clearIssuedTokenModal = useCallback(() => {
    setIssuedTokenModal(null);
  }, []);

  useEffect(() => {
    if (!issuedTokenModal) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setIssuedTokenModal(null);
    }, 60_000);

    return () => window.clearTimeout(timer);
  }, [issuedTokenModal]);

  const handleIssueToken = useCallback(
    async (record: DeviceRecord) => {
      setPendingAction({ deviceId: record.key, type: 'issue' });

      try {
        const result = await adminApi.issueDeviceAgentToken(record.key);
        setCredentialStatus(result.apiStatus);

        if (!result.token) {
          messageApi.error(getIssueFailureMessage(result.errorCode, result.apiStatus.detail, t, text));
          return;
        }

        setIssuedTokenModal({
          deviceId: result.deviceId ?? record.key,
          deviceName: record.deviceName,
          token: result.token
        });
        setRows((currentRows) =>
          currentRows.map((row) =>
            row.key === record.key
              ? {
                  ...row,
                  hasAgentToken: true,
                  agentTokenRevokedAt: null,
                  agentTokenExpiresAt: result.expiresAt ?? null,
                  agentTokenLastUsedAt: null
                }
              : row
          )
        );
        messageApi.success(
          record.hasAgentToken
            ? t('devices.tokenRotated', 'Rotated the agent token for {{device}}.', { device: record.deviceName })
            : t('devices.tokenIssued', 'Issued an agent token for {{device}}.', { device: record.deviceName })
        );
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : t('devices.issueFailed', 'The agent token could not be issued.');
        messageApi.error(failureMessage);
      } finally {
        setPendingAction(null);
      }
    },
    [messageApi]
  );

  const handleRevokeToken = useCallback(
    async () => {
      if (!revokeTokenModal) {
        return;
      }

      setPendingAction({ deviceId: revokeTokenModal.deviceId, type: 'revoke' });
      setRevokeError(null);
      try {
        const result = await adminApi.revokeDeviceAgentToken(revokeTokenModal.deviceId);
        setCredentialStatus(result.apiStatus);

        if (!result.revokedAt) {
          const failureMessage = getRevokeFailureMessage(result.errorCode, result.apiStatus.detail, t, text);
          setRevokeError(failureMessage);
          messageApi.error(failureMessage);
          return;
        }

        await loadDevices();
        messageApi.success(t('devices.tokenRevoked', 'Revoked the agent token for {{device}}.', { device: revokeTokenModal.deviceName }));
        setRevokeTokenModal(null);
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : t('devices.revokeFailed', 'The agent token could not be revoked.');
        setRevokeError(failureMessage);
        messageApi.error(failureMessage);
      } finally {
        setPendingAction(null);
      }
    },
    [loadDevices, messageApi, revokeTokenModal]
  );

  const columns: TableColumnsType<DeviceRecord> = [
    { title: t('common.device', 'Device'), dataIndex: 'deviceName', width: 180 },
    {
      title: t('common.employee', 'Employee'),
      width: 220,
      render: (_value: unknown, record: DeviceRecord) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{record.employee}</Typography.Text>
          <Typography.Text type="secondary">{record.employeeNo ?? t('common.noEmployeeNo', 'No employee no.')}</Typography.Text>
        </Space>
      )
    },
    {
      title: t('devices.rolePosition', 'Role / Position'),
      width: 220,
      render: (_value: unknown, record: DeviceRecord) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>
            {record.department ? text(record.department) : t('common.unknownDepartment', 'Unknown department')}
          </Typography.Text>
          <Typography.Text type="secondary">
            {[record.role, record.position].filter(Boolean).map((value) => text(value)).join(' / ') ||
              t('common.noRoleMetadata', 'No role metadata')}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: t('devices.agentOs', 'Agent / OS'),
      width: 180,
      render: (_value: unknown, record: DeviceRecord) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{t('devices.agentVersion', '客户端 {{version}}', { version: record.agentVersion })}</Typography.Text>
          <Typography.Text type="secondary">{record.os}</Typography.Text>
        </Space>
      )
    },
    { title: t('devices.lastHeartbeat', 'Last Heartbeat'), dataIndex: 'lastHeartbeat', width: 180 },
    {
      title: t('common.status', 'Status'),
      dataIndex: 'status',
      width: 120,
      render: (value: string) => <StatusTag value={value} />
    },
    {
      title: t('devices.agentToken', 'Agent Token'),
      width: 260,
      render: (_value: unknown, record: DeviceRecord) => (
        <Space direction="vertical" size={4}>
          <Tag color={deviceTokenStatusColor(record)}>{deviceTokenStatusLabel(record, t)}</Tag>
          <Typography.Text type="secondary">{buildDeviceTokenSummary(record, t)}</Typography.Text>
          <Typography.Text type="secondary">
            {t('devices.expires', 'Expires: {{value}}', { value: record.agentTokenExpiresAt ?? '--' })}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t('devices.lastUsed', 'Last used: {{value}}', { value: record.agentTokenLastUsedAt ?? '--' })}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: t('devices.agentMetadata', 'Agent Metadata'),
      width: 360,
      render: (_value: unknown, record: DeviceRecord) => (
        <Space size={[6, 6]} wrap>
          {(record.metadataLabels?.length ? record.metadataLabels : [t('devices.noMetadata', 'No extra metadata')]).map((label) => (
            <Tag key={label}>{text(label)}</Tag>
          ))}
        </Space>
      )
    }
  ];

  if (canManageDeviceTokens) {
    columns.push({
      title: t('common.actions', 'Actions'),
      width: 190,
      fixed: 'right',
      render: (_value: unknown, record: DeviceRecord) => {
        const issuePending = pendingAction?.deviceId === record.key && pendingAction.type === 'issue';
        const revokePending = pendingAction?.deviceId === record.key && pendingAction.type === 'revoke';
        const issueDisabled = Boolean(pendingAction && !issuePending);
        const revokeDisabled = !isDeviceTokenActive(record) || issuePending || Boolean(pendingAction && !revokePending);

        return (
          <Space size={8} wrap>
            <Button
              size="small"
              type="link"
              loading={issuePending}
              disabled={issueDisabled}
              onClick={() => void handleIssueToken(record)}
            >
              {isDeviceTokenActive(record) ? t('devices.rotateToken', 'Rotate token') : t('devices.issueToken', 'Issue token')}
            </Button>
            <Button
              size="small"
              type="link"
              danger
              loading={revokePending}
              disabled={revokeDisabled}
              onClick={() => {
                setRevokeError(null);
                setRevokeTokenModal({
                  deviceId: record.key,
                  deviceName: record.deviceName
                });
              }}
            >
              {t('devices.revoke', 'Revoke')}
            </Button>
          </Space>
        );
      }
    });
  }

  return (
    <Space direction="vertical" size={20} className="page-stack">
      {contextHolder}
      <PageSection
        title={t('devices.title', 'Devices')}
        description={t(
          'devices.description',
          'Live device heartbeat data is preferred. Device-scoped agent tokens can be issued and revoked here without exposing raw input or private content.'
        )}
        extra={
          <Space size={[8, 8]} wrap>
            <Tag color="blue">{t('devices.devices', '{{count}} devices', { count: rows.length })}</Tag>
            <Tag color="cyan">{t('devices.remoteSessions', '{{count}} remote sessions', { count: summary.remoteCount })}</Tag>
            <Tag color="gold">{t('devices.locked', '{{count}} locked', { count: summary.lockedCount })}</Tag>
            <Tag color="green">{t('devices.withToken', '{{count}} with token', { count: summary.tokenCount })}</Tag>
            <Tag color="red">{t('devices.revoked', '{{count}} revoked', { count: summary.revokedCount })}</Tag>
            <Button size="small" loading={loadingDevices} onClick={() => void loadDevices()}>
              {t('common.reload', 'Reload')}
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title={t('devices.api', 'Device API')} /> : null}
      {credentialStatus ? <ApiStatusNotice status={credentialStatus} title={t('devices.tokenApi', 'Device token API')} /> : null}
      {!canManageDeviceTokens ? (
        <Alert
          type="warning"
          showIcon
          message={t('devices.tokenRestricted', 'Agent token management is restricted for the current role.')}
          description={t(
            'devices.tokenRestrictedDesc',
            'Issue and revoke actions require the device_tokens.manage permission when RBAC permissions are resolved.'
          )}
        />
      ) : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          loading={loadingDevices}
          pagination={false}
          scroll={{ x: 1560 }}
          columns={columns}
        />
      </Card>
      <Modal
        open={Boolean(issuedTokenModal)}
        title={issuedTokenModal ? `${issuedTokenModal.deviceName} v2 agent token` : 'v2 agent token'}
        footer={null}
        onCancel={clearIssuedTokenModal}
        destroyOnClose
      >
        <Space direction="vertical" size={16} className="full-width">
          <Alert
            type="warning"
            showIcon
            message={t('devices.tokenShownOnce', 'This token is shown only once.')}
            description={t(
              'devices.tokenShownOnceDesc',
              'Store it now. After this dialog closes, the frontend will not keep showing the plaintext token.'
            )}
          />
          <Space direction="vertical" size={4} className="full-width">
            <Typography.Text strong>{t('devices.deviceId', 'Device ID')}</Typography.Text>
            <Typography.Text code>{issuedTokenModal?.deviceId}</Typography.Text>
          </Space>
          <Space direction="vertical" size={4} className="full-width">
            <Typography.Text strong>{t('devices.issuedToken', 'Issued token')}</Typography.Text>
            <Input.TextArea readOnly autoSize={{ minRows: 3, maxRows: 5 }} value={issuedTokenModal?.token ?? ''} />
          </Space>
          <Space size={8} wrap>
            <Button type="primary" onClick={clearIssuedTokenModal}>
              {t('devices.storedToken', 'I stored this token')}
            </Button>
          </Space>
        </Space>
      </Modal>
      <Modal
        open={Boolean(revokeTokenModal)}
        title={
          revokeTokenModal
            ? t('devices.revokeTitle', 'Revoke agent token - {{device}}', { device: revokeTokenModal.deviceName })
            : t('devices.revokeTitleDefault', 'Revoke agent token')
        }
        okText={t('devices.revokeToken', 'Revoke token')}
        okButtonProps={{
          danger: true,
          loading: pendingAction?.deviceId === revokeTokenModal?.deviceId && pendingAction?.type === 'revoke'
        }}
        onCancel={() => {
          if (pendingAction?.deviceId === revokeTokenModal?.deviceId && pendingAction?.type === 'revoke') {
            return;
          }

          setRevokeError(null);
          setRevokeTokenModal(null);
        }}
        onOk={() => void handleRevokeToken()}
        destroyOnClose
      >
        <Space direction="vertical" size={12} className="full-width">
          {revokeError ? (
            <Alert
              type="error"
              showIcon
              message={t('devices.unableRevoke', 'Unable to revoke the device token')}
              description={revokeError}
            />
          ) : null}
          <Typography.Text>
            {t(
              'devices.revokeDesc',
              'Revoking this agent token immediately invalidates the current device credential. The token value is never shown again during revoke.'
            )}
          </Typography.Text>
        </Space>
      </Modal>
    </Space>
  );
}

type TranslateFn = ReturnType<typeof useI18n>['t'];

function buildDeviceTokenSummary(record: DeviceRecord, t: TranslateFn) {
  if (!record.hasAgentToken) {
    return t('devices.noTokenYet', 'No device-scoped token has been issued yet.');
  }

  if (record.agentTokenRevokedAt) {
    return t('devices.tokenRevokedAt', 'The most recent device token was revoked at {{time}}.', {
      time: record.agentTokenRevokedAt
    });
  }

  return t('devices.tokenActive', 'A device-scoped token is currently active for this device.');
}

function isDeviceTokenActive(record: DeviceRecord) {
  return Boolean(record.hasAgentToken && !record.agentTokenRevokedAt);
}

function deviceTokenStatusLabel(record: DeviceRecord, t: TranslateFn) {
  if (record.agentTokenRevokedAt) {
    return t('devices.tokenStatusRevoked', 'Revoked');
  }

  if (record.hasAgentToken) {
    return t('devices.tokenStatusIssued', 'Issued');
  }

  return t('devices.tokenStatusNotIssued', 'Not issued');
}

function deviceTokenStatusColor(record: DeviceRecord) {
  if (record.agentTokenRevokedAt) {
    return 'volcano';
  }

  if (record.hasAgentToken) {
    return 'green';
  }

  return 'default';
}

type TranslateTextFn = ReturnType<typeof useI18n>['text'];

function getIssueFailureMessage(
  errorCode: string | undefined,
  detail: string,
  t: TranslateFn,
  text: TranslateTextFn
) {
  if (errorCode === 'forbidden') {
    return t('devices.noIssuePermission', 'You do not have permission to issue an agent token for this device.');
  }

  if (errorCode === 'not_found') {
    return t('devices.notFound', 'This device no longer exists or is not visible to the current admin account.');
  }

  return text(detail) || t('devices.issueFailed', 'The agent token could not be issued.');
}

function getRevokeFailureMessage(
  errorCode: string | undefined,
  detail: string,
  t: TranslateFn,
  text: TranslateTextFn
) {
  if (errorCode === 'forbidden') {
    return t('devices.noRevokePermission', 'You do not have permission to revoke the agent token for this device.');
  }

  if (errorCode === 'not_found') {
    return t('devices.notFound', 'This device no longer exists or is not visible to the current admin account.');
  }

  return text(detail) || t('devices.revokeFailed', 'The agent token could not be revoked.');
}
