import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
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
  const [rows, setRows] = useState<PolicyRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [pendingActions, setPendingActions] = useState<Record<string, PolicyStateAction | undefined>>({});
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<PolicyEditorValues>();
  const watchedInterval = Form.useWatch('screenshotIntervalSeconds', form);
  const watchedThreshold = Form.useWatch('noChangeThresholdFrames', form);

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
      assignedEmployees
    };
  }, [rows]);

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
      setApiStatus(buildLocalPolicyStatus('Write endpoints are unavailable. Policy changes were saved locally only.'));
      messageApi.warning(`Policy ${localRecord.name} saved locally only.`);
      setSaving(false);
      return;
    }

    const result = await adminApi.savePolicy(values, currentPolicy?.key);
    if (result.data) {
      setRows(result.data);
      const matchingPolicy = result.data.find((item) => item.key === currentPolicy?.key || item.name === values.name);
      setSelectedKey(matchingPolicy?.key ?? result.data[0]?.key ?? NEW_POLICY_KEY);
      messageApi.success(currentPolicy ? `Policy ${values.name} saved.` : `Policy ${values.name} created.`);
    } else {
      setRows((current) => upsertLocalPolicy(current, localRecord));
      setSelectedKey(localRecord.key);
      messageApi.warning(`Backend policy write API is unavailable. ${localRecord.name} was saved locally only.`);
    }

    setApiStatus(result.apiStatus);
    setSaving(false);
  }, [apiStatus?.source, form, messageApi, selectedPolicy]);

  const handleStateAction = useCallback(
    async (record: PolicyRecord, action: PolicyStateAction) => {
      setPendingActions((current) => ({ ...current, [record.key]: action }));
      const canUseLiveMutation = apiStatus?.source === 'live' && isPersistedPolicyKey(record.key);

      if (!canUseLiveMutation) {
        setRows((current) => applyLocalPolicyState(current, record.key, action));
        setApiStatus(
          buildLocalPolicyStatus(`Policy ${record.name} was ${STATE_ACTION_LABELS[action].toLowerCase()} locally only.`)
        );
        messageApi.warning(`Policy ${record.name} updated locally only.`);
        setPendingActions((current) => clearPendingAction(current, record.key));
        return;
      }

      const result = await adminApi.updatePolicyState(record.key, action);

      if (result.data) {
        setRows(result.data);
        messageApi.success(`Policy ${record.name} ${STATE_ACTION_LABELS[action].toLowerCase()} successfully.`);
      } else {
        setRows((current) => applyLocalPolicyState(current, record.key, action));
        messageApi.warning(`Backend state API is unavailable. Policy ${record.name} was updated locally only.`);
      }

      setApiStatus(result.apiStatus);
      setPendingActions((current) => clearPendingAction(current, record.key));
    },
    [apiStatus?.source, messageApi]
  );

  const editorTitle = selectedPolicy ? `Editing ${selectedPolicy.name}` : 'Create policy';

  return (
    <Space direction="vertical" size={20} className="page-stack">
      {contextHolder}
      <PageSection
        title="Policies"
        description="Manage policy scope and thresholds from one dense admin surface. Only aggregate scope, timing, retention, and risk metadata are exposed here."
        extra={
          <Space size={8} wrap>
            <Tag color="green">{summary.activeCount} active</Tag>
            <Tag color="purple">{summary.draftCount} drafts</Tag>
            <Tag color="blue">{summary.assignedEmployees} assigned employees</Tag>
            <Button size="small" onClick={() => void loadPolicies()} loading={loading}>
              Reload
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Policy API" /> : null}
      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={15}>
          <Card
            bordered={false}
            className="panel-card"
            extra={
              <Button size="small" type="primary" onClick={handleCreateNew}>
                New policy
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
                  title: 'Policy',
                  width: 240,
                  render: (_value: unknown, record: PolicyRecord) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>{record.name}</Typography.Text>
                      <Typography.Text type="secondary">{record.version ?? 'No version tag'}</Typography.Text>
                    </Space>
                  )
                },
                {
                  title: 'Scope',
                  width: 380,
                  render: (_value: unknown, record: PolicyRecord) => (
                    <Space direction="vertical" size={4}>
                      <Tag color="geekblue">{record.roles.join(', ') || 'All roles'}</Tag>
                      <Typography.Text type="secondary">
                        Departments: {record.departments.join(', ') || 'All departments'}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        Positions: {record.positions.join(', ') || 'All positions'}
                      </Typography.Text>
                    </Space>
                  )
                },
                {
                  title: 'Capture / Retention',
                  width: 240,
                  render: (_value: unknown, record: PolicyRecord) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text>{record.screenshotInterval}</Typography.Text>
                      <Typography.Text type="secondary">{record.noChangeThreshold}</Typography.Text>
                      <Typography.Text type="secondary">{record.originalRetention}</Typography.Text>
                    </Space>
                  )
                },
                {
                  title: 'Coverage',
                  width: 120,
                  render: (_value: unknown, record: PolicyRecord) => record.assignedEmployees ?? '--'
                },
                {
                  title: 'Status',
                  dataIndex: 'status',
                  width: 120,
                  render: (value?: string) => <StatusTag value={value ?? 'draft'} />
                },
                {
                  title: 'Actions',
                  width: 280,
                  fixed: 'right',
                  render: (_value: unknown, record: PolicyRecord) => (
                    <Space size={[6, 6]} wrap>
                      <Button size="small" onClick={() => setSelectedKey(record.key)}>
                        Edit
                      </Button>
                      {record.status !== 'active' ? (
                        <>
                          <Button
                            size="small"
                            loading={pendingActions[record.key] === 'activate'}
                            onClick={() => void handleStateAction(record, 'activate')}
                          >
                            Activate
                          </Button>
                          <Button
                            size="small"
                            type="primary"
                            loading={pendingActions[record.key] === 'set_active'}
                            onClick={() => void handleStateAction(record, 'set_active')}
                          >
                            Set active
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="small"
                          danger
                          loading={pendingActions[record.key] === 'deactivate'}
                          onClick={() => void handleStateAction(record, 'deactivate')}
                        >
                          Deactivate
                        </Button>
                      )}
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
                <Button size="small" onClick={handleCreateNew}>
                  Reset
                </Button>
                <Button size="small" type="primary" loading={saving} onClick={() => void handleSave()}>
                  Save
                </Button>
              </Space>
            }
          >
            {apiStatus?.source === 'mock' ? (
              <Alert
                type="warning"
                showIcon
                className="embedded-alert"
                message="Policy writes are running in local fallback mode."
                description="Read access is preserved, but create and update operations stay in the frontend until backend write endpoints are available."
              />
            ) : null}
            <Form form={form} layout="vertical" size="small" requiredMark={false}>
              <Form.Item
                label="Policy name"
                name="name"
                rules={[{ required: true, whitespace: true, message: 'Policy name is required.' }]}
              >
                <Input placeholder="Engineering standard" />
              </Form.Item>
              <Form.Item label="Version" name="version">
                <Input placeholder="2026.05" />
              </Form.Item>
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item
                    label="Interval (s)"
                    name="screenshotIntervalSeconds"
                    rules={[{ required: true, message: 'Required.' }]}
                  >
                    <InputNumber min={1} max={3600} className="full-width" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    label="No-change"
                    name="noChangeThresholdFrames"
                    rules={[{ required: true, message: 'Required.' }]}
                  >
                    <InputNumber min={1} max={240} className="full-width" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    label="Retention (days)"
                    name="retentionDays"
                    rules={[{ required: true, message: 'Required.' }]}
                  >
                    <InputNumber min={1} max={365} className="full-width" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="Target roles" name="roles">
                <Select mode="tags" placeholder="Add one or more roles" tokenSeparators={[',']} />
              </Form.Item>
              <Form.Item label="Target departments" name="departments">
                <Select mode="tags" placeholder="Add one or more departments" tokenSeparators={[',']} />
              </Form.Item>
              <Form.Item label="Target positions" name="positions">
                <Select mode="tags" placeholder="Add one or more positions" tokenSeparators={[',']} />
              </Form.Item>
            </Form>
            <Space direction="vertical" size={4} className="policy-editor-hints">
              <Typography.Text type="secondary">
                Effective high-risk window: {formatPolicyWindow(watchedInterval, watchedThreshold)}
              </Typography.Text>
              <Typography.Text type="secondary">
                Only aggregate/session/risk metadata is configurable here. Raw keystrokes, clipboard, webcam, microphone, and private-content capture stay out of this UI.
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
    positions: []
  };
}

function policyToEditorValues(policy: PolicyRecord): PolicyEditorValues {
  return {
    name: policy.name,
    version: policy.version ?? '',
    screenshotIntervalSeconds: policy.screenshotIntervalSeconds,
    noChangeThresholdFrames: policy.noChangeThresholdFrames,
    retentionDays: policy.retentionDays,
    roles: policy.roles,
    departments: policy.departments,
    positions: policy.positions
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
    positions: dedupeTags(values.positions)
  };
}

function buildPolicyRecord(values: PolicyEditorValues, current?: PolicyRecord | null): PolicyRecord {
  const key = current?.key ?? `local-${Date.now()}`;
  const status = current?.status ?? 'draft';
  const isActive = current?.isActive ?? false;
  const highRiskDurationSeconds = values.screenshotIntervalSeconds * values.noChangeThresholdFrames;

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
    originalRetention: `${values.retentionDays} days`
  };
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
