import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { useI18n } from '../i18n/I18nContext';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, PolicyMutationInput, PolicyRecord } from '../types/models';

type PolicyEditorValues = PolicyMutationInput;
type PolicyStateAction = 'activate' | 'deactivate' | 'set_active';

const NEW_POLICY_KEY = '__new_policy__';

const STATE_ACTION_LABELS: Record<PolicyStateAction, string> = {
  activate: 'Activate',
  deactivate: 'Deactivate',
  set_active: 'Set active'
};

export function PoliciesPage() {
  const { t, text } = useI18n();
  const { canAccess, permissionsResolved } = useAuth();
  const [rows, setRows] = useState<PolicyRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingPolicyKey, setDeletingPolicyKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [pendingActions, setPendingActions] = useState<Record<string, PolicyStateAction | undefined>>({});
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<PolicyEditorValues>();
  const watchedInterval = Form.useWatch('screenshotIntervalSeconds', form);
  const watchedThreshold = Form.useWatch('noChangeThresholdFrames', form);
  const watchedAiEnabled = Form.useWatch(['aiAnalysis', 'enabled'], form);
  const watchedAiConfidence = Form.useWatch(['aiAnalysis', 'confidenceThreshold'], form);
  const watchedAiRisk = Form.useWatch(['aiAnalysis', 'riskThreshold'], form);
  const watchedAiProvider = Form.useWatch(['aiAnalysis', 'provider'], form);
  const watchedAiModel = Form.useWatch(['aiAnalysis', 'model'], form);
  const watchedAiUsePrevious = Form.useWatch(['aiAnalysis', 'usePreviousScreenshot'], form);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    const result = await adminApi.getPolicies();
    setRows(result.data);
    setApiStatus(result.apiStatus);
    setSelectedKey((current) => {
      if (current === NEW_POLICY_KEY) {
        return current;
      }

      return result.data.some((item) => item.key === current) ? current : (result.data[0]?.key ?? '');
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  const selectedPolicy =
    selectedKey === NEW_POLICY_KEY ? null : rows.find((item) => item.key === selectedKey) ?? null;

  useEffect(() => {
    form.setFieldsValue(selectedPolicy ? policyToEditorValues(selectedPolicy) : createEmptyEditorValues());
  }, [form, selectedPolicy]);

  const summary = useMemo(() => {
    const assignedEmployees = rows.reduce((total, item) => total + (item.assignedEmployees ?? 0), 0);

    return {
      activeCount: rows.filter((item) => item.status === 'active').length,
      draftCount: rows.filter((item) => item.status === 'draft').length,
      assignedEmployees,
      aiEnabledCount: rows.filter((item) => getPolicyAiAnalysis(item).enabled).length
    };
  }, [rows]);
  const canManagePolicies = !permissionsResolved || canAccess('policies.manage');

  const handleCreateNew = useCallback(() => {
    setSelectedKey(NEW_POLICY_KEY);
    form.setFieldsValue(createEmptyEditorValues());
  }, [form]);

  const handleSave = useCallback(async () => {
    const values = normalizeEditorValues(await form.validateFields());
    const currentPolicy = selectedPolicy;
    const localRecord = buildPolicyRecord(values, currentPolicy);
    const canUseLiveMutation = apiStatus?.source === 'live' && (!currentPolicy || isPersistedPolicyKey(currentPolicy.key));

    setSaving(true);

    if (!canUseLiveMutation) {
      setRows((current) => upsertLocalPolicy(current, localRecord));
      setSelectedKey(localRecord.key);
      setApiStatus(buildLocalPolicyStatus(t('policies.writeUnavailableDetail', 'Write endpoints are unavailable. Policy changes were saved locally only.')));
      messageApi.warning(t('policies.savedLocal', 'Policy {{name}} saved locally only.', { name: localRecord.name }));
      setSaving(false);
      return;
    }

    const result = await adminApi.savePolicy(values, currentPolicy?.key);
    if (result.data) {
      setRows(result.data);
      const matchingPolicy = result.data.find((item) => item.key === currentPolicy?.key || item.name === values.name);
      setSelectedKey(matchingPolicy?.key ?? result.data[0]?.key ?? NEW_POLICY_KEY);
      messageApi.success(
        currentPolicy
          ? t('policies.saved', 'Policy {{name}} saved.', { name: values.name })
          : t('policies.created', 'Policy {{name}} created.', { name: values.name })
      );
    } else {
      setRows((current) => upsertLocalPolicy(current, localRecord));
      setSelectedKey(localRecord.key);
      messageApi.warning(
        t('policies.writeUnavailable', 'Backend policy write API is unavailable. {{name}} was saved locally only.', {
          name: localRecord.name
        })
      );
    }

    setApiStatus(result.apiStatus);
    setSaving(false);
  }, [apiStatus?.source, form, messageApi, selectedPolicy, t]);

  const handleStateAction = useCallback(
    async (record: PolicyRecord, action: PolicyStateAction) => {
      setPendingActions((current) => ({ ...current, [record.key]: action }));
      const canUseLiveMutation = apiStatus?.source === 'live' && isPersistedPolicyKey(record.key);

      if (!canUseLiveMutation) {
        setRows((current) => applyLocalPolicyState(current, record.key, action));
        setApiStatus(
          buildLocalPolicyStatus(
            t('policies.updatedLocal', 'Policy {{name}} updated locally only.', { name: record.name })
          )
        );
        messageApi.warning(t('policies.updatedLocal', 'Policy {{name}} updated locally only.', { name: record.name }));
        setPendingActions((current) => clearPendingAction(current, record.key));
        return;
      }

      const result = await adminApi.updatePolicyState(record.key, action);

      if (result.data) {
        setRows(result.data);
        messageApi.success(
          t('policies.updated', 'Policy {{name}} {{action}} successfully.', {
            name: record.name,
            action: t(policyStateActionKey(action), STATE_ACTION_LABELS[action].toLowerCase())
          })
        );
      } else {
        setRows((current) => applyLocalPolicyState(current, record.key, action));
        messageApi.warning(
          t('policies.stateUnavailable', 'Backend state API is unavailable. Policy {{name}} was updated locally only.', {
            name: record.name
          })
        );
      }

      setApiStatus(result.apiStatus);
      setPendingActions((current) => clearPendingAction(current, record.key));
    },
    [apiStatus?.source, messageApi, t]
  );

  const handleDeletePolicy = useCallback(
    async (record: PolicyRecord) => {
      const canUseLiveMutation = apiStatus?.source === 'live' && isPersistedPolicyKey(record.key);
      setDeletingPolicyKey(record.key);

      if (!canUseLiveMutation) {
        setRows((current) => current.filter((item) => item.key !== record.key));
        setSelectedKey((current) => (current === record.key ? rows.find((item) => item.key !== record.key)?.key ?? '' : current));
        setApiStatus(buildLocalPolicyStatus(t('policies.deletedLocal', 'Policy {{name}} deleted locally only.', { name: record.name })));
        messageApi.warning(t('policies.deletedLocal', 'Policy {{name}} deleted locally only.', { name: record.name }));
        setDeletingPolicyKey(null);
        return;
      }

      const result = await adminApi.deletePolicy(record.key, record.name);
      if (result.data) {
        setRows(result.data);
        setSelectedKey((current) => (current === record.key ? result.data?.[0]?.key ?? '' : current));
        messageApi.success(t('policies.deleted', 'Policy {{name}} deleted.', { name: record.name }));
      } else {
        messageApi.warning(
          t('policies.deleteUnavailable', 'Backend delete API is unavailable. Policy {{name}} was not deleted.', {
            name: record.name
          })
        );
      }

      setApiStatus(result.apiStatus);
      setDeletingPolicyKey(null);
    },
    [apiStatus?.source, messageApi, rows, t]
  );

  const editorTitle = selectedPolicy
    ? t('policies.editing', 'Editing {{name}}', { name: selectedPolicy.name })
    : t('policies.create', 'Create policy');

  return (
    <Space direction="vertical" size={20} className="page-stack">
      {contextHolder}
      <PageSection
        title={t('nav.policies', 'Policies')}
        description={t(
          'policies.description',
          'Manage policy scope and thresholds from one dense admin surface. Only aggregate scope, timing, retention, and risk metadata are exposed here.'
        )}
        extra={
          <Space size={8} wrap>
            <Tag color="green">{summary.activeCount} {t('status.active', 'active')}</Tag>
            <Tag color="purple">{summary.draftCount} {t('status.draft', 'drafts')}</Tag>
            <Tag color="blue">{t('policies.assignedEmployees', '{{count}} assigned employees', { count: summary.assignedEmployees })}</Tag>
            <Tag color="cyan">{t('policies.aiEnabledCount', '{{count}} 个已启用 AI', { count: summary.aiEnabledCount })}</Tag>
            <Button size="small" onClick={() => void loadPolicies()} loading={loading}>
              {t('common.reload', 'Reload')}
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title={t('policies.api', 'Policy API')} /> : null}
      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={15}>
          <Card
            bordered={false}
            className="panel-card"
            extra={
              <Button size="small" type="primary" onClick={handleCreateNew} disabled={!canManagePolicies}>
                {t('policies.newPolicy', 'New policy')}
              </Button>
            }
          >
            <Table
              rowKey="key"
              size="small"
              dataSource={rows}
              loading={loading}
              pagination={false}
              scroll={{ x: 1280 }}
              rowClassName={(record) => (record.key === selectedKey ? 'policy-table-row-selected' : '')}
              onRow={(record) => ({
                onClick: () => setSelectedKey(record.key)
              })}
              columns={[
                {
                  title: t('policies.policy', 'Policy'),
                  width: 240,
                  render: (_value: unknown, record: PolicyRecord) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>{text(record.name)}</Typography.Text>
                      <Typography.Text type="secondary">{record.version ?? t('common.noVersionTag', 'No version tag')}</Typography.Text>
                    </Space>
                  )
                },
                {
                  title: t('dashboard.scope', 'Scope'),
                  width: 380,
                  render: (_value: unknown, record: PolicyRecord) => (
                    <Space direction="vertical" size={4}>
                      <Tag color="geekblue">{record.roles.map(text).join(', ') || t('common.allRoles', 'All roles')}</Tag>
                      <Typography.Text type="secondary">
                        {t('access.departments', 'Departments: {{value}}', {
                          value: record.departments.map(text).join(', ') || t('common.allDepartments', 'All departments')
                        })}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {t('access.positions', 'Positions: {{value}}', {
                          value: record.positions.map(text).join(', ') || t('common.allPositions', 'All positions')
                        })}
                      </Typography.Text>
                    </Space>
                  )
                },
                {
                  title: t('policies.captureRetention', 'Capture / Retention'),
                  width: 240,
                  render: (_value: unknown, record: PolicyRecord) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text>{record.screenshotInterval}</Typography.Text>
                      <Typography.Text type="secondary">{text(record.noChangeThreshold)}</Typography.Text>
                      <Typography.Text type="secondary">{text(record.originalRetention)}</Typography.Text>
                    </Space>
                  )
                },
                {
                  title: t('policies.aiAnalysis', 'AI 分析'),
                  width: 280,
                  render: (_value: unknown, record: PolicyRecord) => (
                    <Space direction="vertical" size={4}>
                      <Tag color={policyAiStateColor(record)}>
                        {getPolicyAiAnalysis(record).enabled
                          ? t('policies.aiEnabled', '已启用')
                          : t('policies.aiDisabled', '已停用')}
                      </Tag>
                      <Typography.Text type="secondary">
                        {formatAiProviderModel(record) ?? t('policies.aiProviderModelUnset', '未设置服务商和模型')}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {buildAiKeySummary(record, t)}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {buildAiThresholdSummary(record, t)}
                      </Typography.Text>
                    </Space>
                  )
                },
                {
                  title: t('policies.coverage', 'Coverage'),
                  width: 120,
                  render: (_value: unknown, record: PolicyRecord) => record.assignedEmployees ?? '--'
                },
                {
                  title: t('common.status', 'Status'),
                  dataIndex: 'status',
                  width: 120,
                  render: (value?: string) => <StatusTag value={value ?? 'draft'} />
                },
                {
                  title: t('common.actions', 'Actions'),
                  width: 360,
                  fixed: 'right',
                  render: (_value: unknown, record: PolicyRecord) => (
                    <Space size={[6, 6]} wrap>
                      <Button size="small" onClick={() => setSelectedKey(record.key)} disabled={!canManagePolicies}>
                        {t('common.edit', 'Edit')}
                      </Button>
                      {record.status !== 'active' ? (
                        <>
                          <Button
                            size="small"
                            loading={pendingActions[record.key] === 'activate'}
                            disabled={!canManagePolicies}
                            onClick={() => void handleStateAction(record, 'activate')}
                          >
                            {t('policies.activate', 'Activate')}
                          </Button>
                          <Button
                            size="small"
                            type="primary"
                            loading={pendingActions[record.key] === 'set_active'}
                            disabled={!canManagePolicies}
                            onClick={() => void handleStateAction(record, 'set_active')}
                          >
                            {t('policies.setActive', 'Set active')}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="small"
                          danger
                          loading={pendingActions[record.key] === 'deactivate'}
                          disabled={!canManagePolicies}
                          onClick={() => void handleStateAction(record, 'deactivate')}
                        >
                          {t('policies.deactivate', 'Deactivate')}
                        </Button>
                      )}
                      <Popconfirm
                        title={t('policies.deleteTitle', 'Delete policy?')}
                        description={t(
                          'policies.deleteDescription',
                          'This removes the policy definition. Existing audit history remains available.'
                        )}
                        okText={t('policies.delete', 'Delete')}
                        okButtonProps={{ danger: true }}
                        onConfirm={() => void handleDeletePolicy(record)}
                      >
                        <Button
                          size="small"
                          danger
                          loading={deletingPolicyKey === record.key}
                          disabled={!canManagePolicies}
                        >
                          {t('policies.delete', 'Delete')}
                        </Button>
                      </Popconfirm>
                    </Space>
                  )
                }
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card
            bordered={false}
            className="panel-card"
            title={editorTitle}
            extra={
              <Space size={8}>
                <Button size="small" onClick={handleCreateNew} disabled={!canManagePolicies}>
                  {t('common.reset', 'Reset')}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  loading={saving}
                  disabled={!canManagePolicies}
                  onClick={() => void handleSave()}
                >
                  {t('common.save', 'Save')}
                </Button>
              </Space>
            }
          >
            {!canManagePolicies ? (
              <Alert
                type="warning"
                showIcon
                className="embedded-alert"
                message={t('policies.disabled', 'Policy management is disabled for the current role.')}
                description={t(
                  'policies.disabledDesc',
                  'Permission data from the auth profile does not include `policies.manage`.'
                )}
              />
            ) : null}
            {apiStatus?.source === 'mock' ? (
              <Alert
                type="warning"
                showIcon
                className="embedded-alert"
                message={t('policies.localWrites', 'Policy writes are running in local fallback mode.')}
                description={t(
                  'policies.localWritesDesc',
                  'Read access is preserved, but create and update operations stay in the frontend until backend write endpoints are available.'
                )}
              />
            ) : null}
            <Form form={form} layout="vertical" size="small" requiredMark={false}>
              <Form.Item
                label={t('policies.name', 'Policy name')}
                name="name"
                rules={[{ required: true, whitespace: true, message: t('policies.nameRequired', 'Policy name is required.') }]}
              >
                <Input placeholder={t('policies.namePlaceholder', '工程标准策略')} disabled={!canManagePolicies} />
              </Form.Item>
              <Form.Item label={t('policies.version', 'Version')} name="version">
                <Input placeholder="2026.05" disabled={!canManagePolicies} />
              </Form.Item>
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item
                    label={t('policies.interval', 'Interval (s)')}
                    name="screenshotIntervalSeconds"
                    rules={[{ required: true, message: t('policies.required', 'Required.') }]}
                  >
                    <InputNumber min={1} max={3600} className="full-width" disabled={!canManagePolicies} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    label={t('policies.noChange', 'No-change')}
                    name="noChangeThresholdFrames"
                    rules={[{ required: true, message: t('policies.required', 'Required.') }]}
                  >
                    <InputNumber min={1} max={240} className="full-width" disabled={!canManagePolicies} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    label={t('policies.retention', 'Retention (days)')}
                    name="retentionDays"
                    rules={[{ required: true, message: t('policies.required', 'Required.') }]}
                  >
                    <InputNumber min={1} max={365} className="full-width" disabled={!canManagePolicies} />
                  </Form.Item>
                </Col>
              </Row>
              <Space direction="vertical" size={12} className="full-width">
                <Typography.Title level={5}>{t('policies.aiScreenshotAnalysis', 'AI 截图分析')}</Typography.Title>
                <Typography.Text type="secondary">
                  {t(
                    'policies.aiScreenshotDesc',
                    '配置可选的模型辅助截图分析，同时保持密钥脱敏。完整 API key 不会再次显示在该界面中。'
                  )}
                </Typography.Text>
                <Row gutter={12} align="middle">
                  <Col xs={24} sm={12}>
                    <Form.Item
                      label={t('policies.aiEnable', '启用 AI 分析')}
                      name={['aiAnalysis', 'enabled']}
                      valuePropName="checked"
                    >
                      <Switch disabled={!canManagePolicies} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Alert
                      type={getPolicyAiAnalysis(selectedPolicy).hasApiKey ? 'info' : watchedAiEnabled ? 'warning' : 'success'}
                      showIcon
                      className="embedded-alert"
                      message={buildAiKeyStateMessage(selectedPolicy, t)}
                      description={buildAiKeyStateDescription(selectedPolicy, watchedAiEnabled, t)}
                    />
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24} sm={12}>
                    <Form.Item label={t('policies.aiProvider', '服务商')} name={['aiAnalysis', 'provider']}>
                      <Input placeholder="openai" disabled={!canManagePolicies} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item label={t('policies.aiModel', '模型')} name={['aiAnalysis', 'model']}>
                      <Input placeholder="gpt-4.1-mini" disabled={!canManagePolicies} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24} sm={16}>
                    <Form.Item label={t('policies.aiBaseUrl', '基础地址')} name={['aiAnalysis', 'baseUrl']}>
                      <Input placeholder="https://api.openai.com/v1" disabled={!canManagePolicies} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8}>
                    <Form.Item label={t('policies.aiTimeout', '超时（秒）')} name={['aiAnalysis', 'timeoutSeconds']}>
                      <InputNumber min={1} max={120} className="full-width" disabled={!canManagePolicies} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item
                  label={t('policies.aiReplacementKey', '替换 API key')}
                  name={['aiAnalysis', 'apiKey']}
                  extra={t(
                    'policies.aiReplacementKeyExtra',
                    '留空将保留已存储的密钥状态。填写新值会在保存时替换后端密钥。'
                  )}
                >
                  <Input.Password
                    autoComplete="new-password"
                    placeholder={t('policies.aiReplacementKeyPlaceholder', '仅在轮换凭据时粘贴新的替换 key')}
                    disabled={!canManagePolicies}
                  />
                </Form.Item>
                <Row gutter={12}>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      label={t('policies.aiMinimumConfidence', '最低置信度（%）')}
                      name={['aiAnalysis', 'confidenceThreshold']}
                    >
                      <InputNumber min={0} max={100} className="full-width" disabled={!canManagePolicies} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item
                      label={t('policies.aiReviewThreshold', '复核阈值（%）')}
                      name={['aiAnalysis', 'riskThreshold']}
                    >
                      <InputNumber min={0} max={100} className="full-width" disabled={!canManagePolicies} />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item
                  label={t('policies.aiIncludePrevious', '包含上一张截图')}
                  name={['aiAnalysis', 'usePreviousScreenshot']}
                  valuePropName="checked"
                >
                  <Switch disabled={!canManagePolicies} />
                </Form.Item>
              </Space>
              <Form.Item label={t('policies.targetRoles', 'Target roles')} name="roles">
                <Select
                  mode="tags"
                  placeholder={t('policies.addRoles', 'Add one or more roles')}
                  tokenSeparators={[',']}
                  disabled={!canManagePolicies}
                />
              </Form.Item>
              <Form.Item label={t('policies.targetDepartments', 'Target departments')} name="departments">
                <Select
                  mode="tags"
                  placeholder={t('policies.addDepartments', 'Add one or more departments')}
                  tokenSeparators={[',']}
                  disabled={!canManagePolicies}
                />
              </Form.Item>
              <Form.Item label={t('policies.targetPositions', 'Target positions')} name="positions">
                <Select
                  mode="tags"
                  placeholder={t('policies.addPositions', 'Add one or more positions')}
                  tokenSeparators={[',']}
                  disabled={!canManagePolicies}
                />
              </Form.Item>
            </Form>
            <Space direction="vertical" size={4} className="policy-editor-hints">
              <Typography.Text type="secondary">
                {t('policies.effectiveWindow', 'Effective high-risk window: {{value}}', {
                  value: formatPolicyWindow(watchedInterval, watchedThreshold)
                })}
              </Typography.Text>
              <Typography.Text type="secondary">
                {buildAiEditorSummary(
                  {
                    enabled: watchedAiEnabled,
                    confidenceThreshold: watchedAiConfidence,
                    riskThreshold: watchedAiRisk,
                    provider: watchedAiProvider,
                    model: watchedAiModel,
                    usePreviousScreenshot: watchedAiUsePrevious
                  },
                  t
                )}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t(
                  'policies.safetyHint',
                  'Only aggregate/session/risk metadata is configurable here. Raw keystrokes, clipboard, webcam, microphone, and private-content capture stay out of this UI.'
                )}
              </Typography.Text>
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function createEmptyEditorValues(): PolicyEditorValues {
  return {
    name: '',
    version: '',
    screenshotIntervalSeconds: 10,
    noChangeThresholdFrames: 6,
    retentionDays: 7,
    roles: [],
    departments: [],
    positions: [],
    aiAnalysis: {
      enabled: false,
      provider: '',
      model: '',
      baseUrl: '',
      timeoutSeconds: 20,
      usePreviousScreenshot: true,
      apiKey: '',
      confidenceThreshold: 70,
      riskThreshold: 85
    }
  };
}

function policyToEditorValues(policy: PolicyRecord): PolicyEditorValues {
  const aiAnalysis = getPolicyAiAnalysis(policy);

  return {
    name: policy.name,
    version: policy.version ?? '',
    screenshotIntervalSeconds: policy.screenshotIntervalSeconds,
    noChangeThresholdFrames: policy.noChangeThresholdFrames,
    retentionDays: policy.retentionDays,
    roles: policy.roles,
    departments: policy.departments,
    positions: policy.positions,
    aiAnalysis: {
      enabled: aiAnalysis.enabled,
      provider: aiAnalysis.provider ?? '',
      model: aiAnalysis.model ?? '',
      baseUrl: aiAnalysis.baseUrl ?? '',
      timeoutSeconds: aiAnalysis.timeoutSeconds ?? 20,
      usePreviousScreenshot: aiAnalysis.usePreviousScreenshot ?? true,
      apiKey: '',
      confidenceThreshold: aiAnalysis.confidenceThreshold ?? 70,
      riskThreshold: aiAnalysis.riskThreshold ?? 85
    }
  };
}

function normalizeEditorValues(values: PolicyEditorValues): PolicyEditorValues {
  return {
    name: values.name.trim(),
    version: values.version?.trim() ?? '',
    screenshotIntervalSeconds: values.screenshotIntervalSeconds,
    noChangeThresholdFrames: values.noChangeThresholdFrames,
    retentionDays: values.retentionDays,
    roles: dedupeTags(values.roles),
    departments: dedupeTags(values.departments),
    positions: dedupeTags(values.positions),
    aiAnalysis: {
      enabled: values.aiAnalysis.enabled,
      provider: values.aiAnalysis.provider?.trim() ?? '',
      model: values.aiAnalysis.model?.trim() ?? '',
      baseUrl: values.aiAnalysis.baseUrl?.trim() ?? '',
      timeoutSeconds: values.aiAnalysis.timeoutSeconds ?? 20,
      usePreviousScreenshot: values.aiAnalysis.usePreviousScreenshot ?? true,
      apiKey: values.aiAnalysis.apiKey?.trim() ?? '',
      confidenceThreshold: normalizePercentageValue(values.aiAnalysis.confidenceThreshold),
      riskThreshold: normalizePercentageValue(values.aiAnalysis.riskThreshold)
    }
  };
}

function buildPolicyRecord(values: PolicyEditorValues, current?: PolicyRecord | null): PolicyRecord {
  const key = current?.key ?? `local-${Date.now()}`;
  const status = current?.status ?? 'draft';
  const isActive = current?.isActive ?? false;
  const highRiskDurationSeconds = values.screenshotIntervalSeconds * values.noChangeThresholdFrames;
  const currentAiAnalysis = getPolicyAiAnalysis(current);
  const nextMaskedKey =
    maskPolicyApiKey(values.aiAnalysis.apiKey) ??
    currentAiAnalysis.apiKeyMasked ??
    null;
  const hasApiKey = Boolean(nextMaskedKey);

  return {
    key,
    name: values.name,
    version: values.version || undefined,
    role: values.roles[0] ?? 'All roles',
    roles: values.roles,
    positions: values.positions,
    departments: values.departments,
    status,
    isActive,
    assignedEmployees: current?.assignedEmployees,
    screenshotIntervalSeconds: values.screenshotIntervalSeconds,
    screenshotInterval: `${values.screenshotIntervalSeconds}s`,
    noChangeThresholdFrames: values.noChangeThresholdFrames,
    noChangeThreshold: `${values.noChangeThresholdFrames} frames`,
    highRiskDurationSeconds,
    highRiskDuration: formatPolicyWindow(values.screenshotIntervalSeconds, values.noChangeThresholdFrames),
    ocrEnabled: current?.ocrEnabled ?? false,
    retentionDays: values.retentionDays,
    originalRetention: `${values.retentionDays} days`,
    aiAnalysis: {
      enabled: values.aiAnalysis.enabled,
      provider: values.aiAnalysis.provider || undefined,
      model: values.aiAnalysis.model || undefined,
      baseUrl: values.aiAnalysis.baseUrl || undefined,
      timeoutSeconds: values.aiAnalysis.timeoutSeconds ?? null,
      usePreviousScreenshot: values.aiAnalysis.usePreviousScreenshot ?? true,
      apiKeyMasked: nextMaskedKey,
      apiKeyState: hasApiKey ? 'configured' : values.aiAnalysis.enabled ? 'missing' : 'not_required',
      hasApiKey,
      confidenceThreshold: values.aiAnalysis.confidenceThreshold ?? null,
      riskThreshold: values.aiAnalysis.riskThreshold ?? null
    }
  };
}

function policyAiStateColor(record: PolicyRecord) {
  const aiAnalysis = getPolicyAiAnalysis(record);

  if (!aiAnalysis.enabled) {
    return 'default';
  }

  if (aiAnalysis.hasApiKey) {
    return 'cyan';
  }

  return 'orange';
}

function formatAiProviderModel(record: PolicyRecord) {
  const aiAnalysis = getPolicyAiAnalysis(record);
  const values = [aiAnalysis.provider, aiAnalysis.model].filter(Boolean);
  return values.length > 0 ? values.join(' / ') : null;
}

function buildAiKeySummary(record: PolicyRecord, t: ReturnType<typeof useI18n>['t']) {
  const aiAnalysis = getPolicyAiAnalysis(record);

  if (aiAnalysis.apiKeyMasked) {
    return t('policies.aiKeyMasked', '密钥 {{value}}', { value: aiAnalysis.apiKeyMasked });
  }

  return t('policies.aiKeyState', '密钥状态：{{state}}', {
    state: formatAiStateLabel(aiAnalysis.apiKeyState, t)
  });
}

function buildAiThresholdSummary(record: PolicyRecord, t: ReturnType<typeof useI18n>['t']) {
  const aiAnalysis = getPolicyAiAnalysis(record);

  return t('policies.aiThresholdSummary', '置信度 {{confidence}} / 复核 {{review}} / 超时 {{timeout}} 秒', {
    confidence: formatPercentage(aiAnalysis.confidenceThreshold) ?? '--',
    review: formatPercentage(aiAnalysis.riskThreshold) ?? '--',
    timeout: aiAnalysis.timeoutSeconds ?? '--'
  });
}

function buildAiKeyStateMessage(policy: PolicyRecord | null, t: ReturnType<typeof useI18n>['t']) {
  const aiAnalysis = getPolicyAiAnalysis(policy);

  if (aiAnalysis.apiKeyMasked) {
    return t('policies.aiStoredKey', '已存储密钥：{{value}}', { value: aiAnalysis.apiKeyMasked });
  }

  return t('policies.aiNoStoredKey', '该策略暂未显示已存储的 API key。');
}

function buildAiKeyStateDescription(
  policy: PolicyRecord | null,
  enabled: boolean | undefined,
  t: ReturnType<typeof useI18n>['t']
) {
  const aiAnalysis = getPolicyAiAnalysis(policy);

  if (aiAnalysis.apiKeyMasked) {
    return t(
      'policies.aiKeepStoredKey',
      '替换字段留空会保留已存储密钥。填写新值会轮换密钥，且不会暴露当前 key。'
    );
  }

  if (enabled) {
    return t('policies.aiNeedsKey', 'AI 分析已启用，后端需要有效的服务商 key 才能完成实时分析。');
  }

  return t('policies.aiDisabledKeyHint', '可以保持 AI 分析停用，也可以在该策略需要模型辅助复核时再添加 key。');
}

function buildAiEditorSummary(input: {
  enabled: boolean | undefined;
  confidenceThreshold: number | null | undefined;
  riskThreshold: number | null | undefined;
  provider: string | undefined;
  model: string | undefined;
  usePreviousScreenshot: boolean | undefined;
}, t: ReturnType<typeof useI18n>['t']) {
  const providerModel = [input.provider?.trim(), input.model?.trim()].filter(Boolean).join(' / ');
  if (!input.enabled) {
    return t('policies.aiEditorDisabled', '该策略草稿当前已停用 AI 分析。');
  }

  return t(
    'policies.aiEditorEnabled',
    'AI 分析将使用 {{providerModel}}，最低置信度 {{confidence}}，复核阈值 {{review}}，{{previous}}。',
    {
      providerModel: providerModel || t('policies.aiProviderModelPending', '已配置的服务商'),
      confidence: formatPercentage(input.confidenceThreshold) ?? '--',
      review: formatPercentage(input.riskThreshold) ?? '--',
      previous: input.usePreviousScreenshot
        ? t('policies.aiWillIncludePrevious', '会包含上一张截图')
        : t('policies.aiWillNotIncludePrevious', '不会包含上一张截图')
    }
  );
}

function formatAiStateLabel(state: string | null | undefined, t: ReturnType<typeof useI18n>['t']) {
  switch (state) {
    case 'configured':
      return t('policies.aiStateConfigured', '已配置');
    case 'missing':
      return t('policies.aiStateMissing', '缺失');
    case 'invalid':
      return t('policies.aiStateInvalid', '无效');
    case 'rotation_required':
      return t('policies.aiStateRotationRequired', '需要轮换');
    case 'not_required':
      return t('policies.aiStateNotRequired', '不需要');
    default:
      return state ? t('policies.aiStateUnknownValue', '未知状态：{{state}}', { state }) : t('api.unknown', '未知');
  }
}

function getPolicyAiAnalysis(policy?: PolicyRecord | null) {
  return (
    policy?.aiAnalysis ?? {
      enabled: false,
      provider: undefined,
      model: undefined,
      baseUrl: undefined,
      timeoutSeconds: null,
      usePreviousScreenshot: true,
      apiKeyMasked: null,
      apiKeyState: 'not_required',
      hasApiKey: false,
      confidenceThreshold: null,
      riskThreshold: null
    }
  );
}

function normalizePercentageValue(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }

  return value;
}

function formatPercentage(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }

  const normalized = value > 1 ? value : value * 100;
  return `${normalized.toFixed(Number.isInteger(normalized) ? 0 : 1)}%`;
}

function maskPolicyApiKey(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= 4) {
    return '••••';
  }

  return `••••${trimmed.slice(-4)}`;
}

function upsertLocalPolicy(rows: PolicyRecord[], nextRecord: PolicyRecord) {
  const existingIndex = rows.findIndex((item) => item.key === nextRecord.key);
  if (existingIndex === -1) {
    return [nextRecord, ...rows];
  }

  return rows.map((item) => (item.key === nextRecord.key ? { ...item, ...nextRecord } : item));
}

function applyLocalPolicyState(rows: PolicyRecord[], policyKey: string, action: PolicyStateAction) {
  return rows.map((item) => {
    if (action === 'set_active') {
      if (item.key === policyKey) {
        return { ...item, status: 'active', isActive: true };
      }

      return item.status === 'active' ? { ...item, status: 'inactive', isActive: false } : item;
    }

    if (item.key !== policyKey) {
      return item;
    }

    if (action === 'activate') {
      return { ...item, status: 'active', isActive: true };
    }

    return { ...item, status: 'inactive', isActive: false };
  });
}

function buildLocalPolicyStatus(detail: string): ApiStatus {
  return {
    source: 'mock',
    state: 'fallback',
    label: 'Local admin fallback',
    detail,
    endpoint: '/api/policies'
  };
}

function clearPendingAction(
  state: Record<string, PolicyStateAction | undefined>,
  key: string
) {
  const next = { ...state };
  delete next[key];
  return next;
}

function policyStateActionKey(action: PolicyStateAction) {
  if (action === 'activate') {
    return 'policies.activate' as const;
  }

  if (action === 'set_active') {
    return 'policies.setActive' as const;
  }

  return 'policies.deactivate' as const;
}

function dedupeTags(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isPersistedPolicyKey(key: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
}

function formatPolicyWindow(intervalSeconds?: number, threshold?: number) {
  const totalSeconds = (intervalSeconds ?? 0) * (threshold ?? 0);
  if (totalSeconds <= 0) {
    return '--';
  }

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
