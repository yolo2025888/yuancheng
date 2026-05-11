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
          messageApi.error(getIssueFailureMessage(result.errorCode, result.apiStatus.detail));
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
            ? `Rotated the agent token for ${record.deviceName}.`
            : `Issued an agent token for ${record.deviceName}.`
        );
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : 'The agent token could not be issued.';
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
          const failureMessage = getRevokeFailureMessage(result.errorCode, result.apiStatus.detail);
          setRevokeError(failureMessage);
          messageApi.error(failureMessage);
          return;
        }

        await loadDevices();
        messageApi.success(`Revoked the agent token for ${revokeTokenModal.deviceName}.`);
        setRevokeTokenModal(null);
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : 'The agent token could not be revoked.';
        setRevokeError(failureMessage);
        messageApi.error(failureMessage);
      } finally {
        setPendingAction(null);
      }
    },
    [loadDevices, messageApi, revokeTokenModal]
  );

  const columns: TableColumnsType<DeviceRecord> = [
    { title: 'Device', dataIndex: 'deviceName', width: 180 },
    {
      title: 'Employee',
      width: 220,
      render: (_value: unknown, record: DeviceRecord) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{record.employee}</Typography.Text>
          <Typography.Text type="secondary">{record.employeeNo ?? 'No employee no.'}</Typography.Text>
        </Space>
      )
    },
    {
      title: 'Role / Position',
      width: 220,
      render: (_value: unknown, record: DeviceRecord) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{record.department ?? 'Unknown department'}</Typography.Text>
          <Typography.Text type="secondary">
            {[record.role, record.position].filter(Boolean).join(' / ') || 'No role metadata'}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: 'Agent / OS',
      width: 180,
      render: (_value: unknown, record: DeviceRecord) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>Agent {record.agentVersion}</Typography.Text>
          <Typography.Text type="secondary">{record.os}</Typography.Text>
        </Space>
      )
    },
    { title: 'Last Heartbeat', dataIndex: 'lastHeartbeat', width: 180 },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 120,
      render: (value: string) => <StatusTag value={value} />
    },
    {
      title: 'Agent Token',
      width: 260,
      render: (_value: unknown, record: DeviceRecord) => (
        <Space direction="vertical" size={4}>
          <Tag color={deviceTokenStatusColor(record)}>{deviceTokenStatusLabel(record)}</Tag>
          <Typography.Text type="secondary">{buildDeviceTokenSummary(record)}</Typography.Text>
          <Typography.Text type="secondary">Expires: {record.agentTokenExpiresAt ?? '--'}</Typography.Text>
          <Typography.Text type="secondary">Last used: {record.agentTokenLastUsedAt ?? '--'}</Typography.Text>
        </Space>
      )
    },
    {
      title: 'Agent Metadata',
      width: 360,
      render: (_value: unknown, record: DeviceRecord) => (
        <Space size={[6, 6]} wrap>
          {(record.metadataLabels?.length ? record.metadataLabels : ['No extra metadata']).map((label) => (
            <Tag key={label}>{label}</Tag>
          ))}
        </Space>
      )
    }
  ];

  if (canManageDeviceTokens) {
    columns.push({
      title: 'Actions',
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
              {isDeviceTokenActive(record) ? 'Rotate token' : 'Issue token'}
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
              Revoke
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
        title="Devices"
        description="Live device heartbeat data is preferred. Device-scoped agent tokens can be issued and revoked here without exposing raw input or private content."
        extra={
          <Space size={[8, 8]} wrap>
            <Tag color="blue">{rows.length} devices</Tag>
            <Tag color="cyan">{summary.remoteCount} remote sessions</Tag>
            <Tag color="gold">{summary.lockedCount} locked</Tag>
            <Tag color="green">{summary.tokenCount} with token</Tag>
            <Tag color="red">{summary.revokedCount} revoked</Tag>
            <Button size="small" loading={loadingDevices} onClick={() => void loadDevices()}>
              Reload
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Device API" /> : null}
      {credentialStatus ? <ApiStatusNotice status={credentialStatus} title="Device token API" /> : null}
      {!canManageDeviceTokens ? (
        <Alert
          type="warning"
          showIcon
          message="Agent token management is restricted for the current role."
          description="Issue and revoke actions require the device_tokens.manage permission when RBAC permissions are resolved."
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
            message="This token is shown only once."
            description="Store it now. After this dialog closes, the frontend will not keep showing the plaintext token."
          />
          <Space direction="vertical" size={4} className="full-width">
            <Typography.Text strong>Device ID</Typography.Text>
            <Typography.Text code>{issuedTokenModal?.deviceId}</Typography.Text>
          </Space>
          <Space direction="vertical" size={4} className="full-width">
            <Typography.Text strong>Issued token</Typography.Text>
            <Input.TextArea readOnly autoSize={{ minRows: 3, maxRows: 5 }} value={issuedTokenModal?.token ?? ''} />
          </Space>
          <Space size={8} wrap>
            <Button type="primary" onClick={clearIssuedTokenModal}>
              I stored this token
            </Button>
          </Space>
        </Space>
      </Modal>
      <Modal
        open={Boolean(revokeTokenModal)}
        title={revokeTokenModal ? `Revoke agent token - ${revokeTokenModal.deviceName}` : 'Revoke agent token'}
        okText="Revoke token"
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
              message="Unable to revoke the device token"
              description={revokeError}
            />
          ) : null}
          <Typography.Text>
            Revoking this agent token immediately invalidates the current device credential. The token value is never
            shown again during revoke.
          </Typography.Text>
        </Space>
      </Modal>
    </Space>
  );
}

function buildDeviceTokenSummary(record: DeviceRecord) {
  if (!record.hasAgentToken) {
    return 'No device-scoped token has been issued yet.';
  }

  if (record.agentTokenRevokedAt) {
    return `The most recent device token was revoked at ${record.agentTokenRevokedAt}.`;
  }

  return 'A device-scoped token is currently active for this device.';
}

function isDeviceTokenActive(record: DeviceRecord) {
  return Boolean(record.hasAgentToken && !record.agentTokenRevokedAt);
}

function deviceTokenStatusLabel(record: DeviceRecord) {
  if (record.agentTokenRevokedAt) {
    return 'Revoked';
  }

  if (record.hasAgentToken) {
    return 'Issued';
  }

  return 'Not issued';
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

function getIssueFailureMessage(errorCode: string | undefined, detail: string) {
  if (errorCode === 'forbidden') {
    return 'You do not have permission to issue an agent token for this device.';
  }

  if (errorCode === 'not_found') {
    return 'This device no longer exists or is not visible to the current admin account.';
  }

  return detail || 'The agent token could not be issued.';
}

function getRevokeFailureMessage(errorCode: string | undefined, detail: string) {
  if (errorCode === 'forbidden') {
    return 'You do not have permission to revoke the agent token for this device.';
  }

  if (errorCode === 'not_found') {
    return 'This device no longer exists or is not visible to the current admin account.';
  }

  return detail || 'The agent token could not be revoked.';
}
