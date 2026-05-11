import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { useAuth } from '../auth/AuthContext';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, AttendanceRecord, AttendanceReviewStatus, AttendanceRuleSummary } from '../types/models';

type AttendanceFilters = {
  date: string;
  anomalyStatus: string;
  reviewStatus: string;
  eventType: string;
};

type ReviewDraft = {
  record: AttendanceRecord;
  reviewStatus: AttendanceReviewStatus;
  note: string;
};

type AttendanceRuleEditorValues = {
  clockInLateAfter: string;
  clockOutEarlyBefore: string;
};

const DEFAULT_FILTERS: AttendanceFilters = {
  date: '',
  anomalyStatus: 'all',
  reviewStatus: 'all',
  eventType: 'all'
};

const FALLBACK_RULE_SUMMARY: AttendanceRuleSummary = {
  key: 'default-attendance-rule',
  name: 'Default attendance rule',
  lateThreshold: '09:30',
  earlyLeaveThreshold: '18:00',
  timezone: 'Local time',
  sourceLabel: 'Fallback defaults'
};

export function AttendancePage() {
  const [rows, setRows] = useState<AttendanceRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [ruleSummary, setRuleSummary] = useState<AttendanceRuleSummary>(FALLBACK_RULE_SUMMARY);
  const [ruleApiStatus, setRuleApiStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewingKey, setReviewingKey] = useState<string | null>(null);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleSaveError, setRuleSaveError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AttendanceFilters>(DEFAULT_FILTERS);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | null>(null);
  const { canAccess } = useAuth();
  const canManageAttendance = canAccess('attendance.manage');
  const [messageApi, contextHolder] = message.useMessage();
  const [ruleForm] = Form.useForm<AttendanceRuleEditorValues>();

  const loadAttendance = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi.getAttendance();
      setRows(result.data);
      setApiStatus(result.apiStatus);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAttendanceRules = useCallback(async () => {
    const result = await adminApi.getAttendanceRules();
    setRuleSummary(result.data);
    setRuleApiStatus(result.apiStatus);
    return result;
  }, []);

  useEffect(() => {
    void Promise.all([loadAttendance(), loadAttendanceRules()]);
  }, [loadAttendance, loadAttendanceRules]);

  const submitReview = useCallback(
    async () => {
      if (!reviewDraft) {
        return;
      }

      const { record, reviewStatus, note } = reviewDraft;
      const nextReviewKey = `${record.key}:${reviewStatus}`;
      setReviewingKey(nextReviewKey);
      const result = await adminApi.reviewAttendance(record.key, reviewStatus, note.trim() || undefined);

      if (result.records) {
        setRows(result.records);
        messageApi.success(`${record.employee} marked as ${reviewStatusLabel(reviewStatus)}.`);
      } else {
        messageApi.warning('Review was not saved by the backend. The table was left unchanged.');
      }

      setApiStatus(result.apiStatus);
      setReviewingKey(null);
      setReviewDraft(null);
    },
    [messageApi, reviewDraft]
  );

  const openRuleEditor = useCallback(() => {
    ruleForm.setFieldsValue({
      clockInLateAfter: ruleSummary.lateThreshold,
      clockOutEarlyBefore: ruleSummary.earlyLeaveThreshold
    });
    setRuleSaveError(null);
    setRuleEditorOpen(true);
  }, [ruleForm, ruleSummary.earlyLeaveThreshold, ruleSummary.lateThreshold]);

  const submitRuleUpdate = useCallback(async () => {
    const values = await ruleForm.validateFields().catch(() => null);

    if (!values) {
      return;
    }

    setRuleSaving(true);
    setRuleSaveError(null);
    const result = await adminApi.updateAttendanceRule({
      name: ruleSummary.name,
      clockInLateAfter: values.clockInLateAfter,
      clockOutEarlyBefore: values.clockOutEarlyBefore
    });

    setRuleApiStatus(result.apiStatus);

    if (result.data) {
      setRuleSummary(result.data);
      const refreshed = await loadAttendanceRules();

      if (refreshed.apiStatus.source !== 'live') {
        setRuleSummary(result.data);
        setRuleApiStatus(result.apiStatus);
      }

      messageApi.success('Default attendance rule updated.');
      setRuleEditorOpen(false);
      setRuleSaving(false);
      return;
    }

    const failureMessage = getRuleUpdateFailureMessage(result.errorCode, result.apiStatus.detail);
    setRuleSaveError(failureMessage);
    messageApi.error(failureMessage);
    setRuleSaving(false);
  }, [loadAttendanceRules, messageApi, ruleForm, ruleSummary.name]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const matchesDate =
          !filters.date || row.workDate === filters.date || row.occurredAt.includes(filters.date);
        const matchesAnomaly =
          filters.anomalyStatus === 'all' || row.anomalyStatus === filters.anomalyStatus;
        const matchesReview =
          filters.reviewStatus === 'all' || row.reviewStatus === filters.reviewStatus;
        const matchesEvent = filters.eventType === 'all' || row.eventType === filters.eventType;

        return matchesDate && matchesAnomaly && matchesReview && matchesEvent;
      }),
    [filters, rows]
  );

  const summary = useMemo(() => {
    const abnormalCount = filteredRows.filter((row) => row.anomalyStatus !== 'normal').length;
    const pendingCount = filteredRows.filter((row) => row.reviewStatus === 'pending').length;
    const clockInCount = filteredRows.filter((row) => row.eventType === 'clock_in').length;

    return { abnormalCount, pendingCount, clockInCount };
  }, [filteredRows]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      {contextHolder}
      <PageSection
        title="Attendance"
        description="Review employee clock-in and clock-out records, including late arrivals, early departures, and review status."
        extra={
          <Space size={[8, 8]} wrap>
            <Tag color="blue">
              {filteredRows.length}/{rows.length} records
            </Tag>
            <Tag color="cyan">{summary.clockInCount} clock-ins</Tag>
            <Tag color={summary.abnormalCount > 0 ? 'orange' : 'green'}>
              {summary.abnormalCount} exceptions
            </Tag>
            <Tag color={summary.pendingCount > 0 ? 'gold' : 'green'}>
              {summary.pendingCount} pending review
            </Tag>
            <Button
              size="small"
              onClick={() => void Promise.all([loadAttendance(), loadAttendanceRules()])}
              loading={loading}
            >
              Reload
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Attendance API" /> : null}
      <Card bordered={false} className="panel-card">
        <Space direction="vertical" size={8}>
          <Space size={8} wrap>
            <Typography.Text strong>{ruleSummary.name}</Typography.Text>
            <Tag color={ruleApiStatus?.source === 'live' ? 'green' : 'gold'}>
              {ruleSummary.sourceLabel ?? ruleApiStatus?.label ?? 'Fallback defaults'}
            </Tag>
            {ruleSummary.timezone ? <Tag color="blue">{ruleSummary.timezone}</Tag> : null}
            {canManageAttendance ? (
              <Button size="small" onClick={openRuleEditor}>
                Edit thresholds
              </Button>
            ) : null}
          </Space>
          <Space size={[8, 8]} wrap>
            <Tag color="orange">Late after {ruleSummary.lateThreshold}</Tag>
            <Tag color="purple">Early leave before {ruleSummary.earlyLeaveThreshold}</Tag>
          </Space>
          <Typography.Text type="secondary">
            These thresholds drive the table explanations below. If the backend rule endpoint is unavailable, the page
            uses the current default rule.
          </Typography.Text>
        </Space>
      </Card>
      <Card bordered={false} className="panel-card">
        <Space size={[12, 12]} wrap style={{ marginBottom: 16 }}>
          <Input
            type="date"
            value={filters.date}
            style={{ width: 170 }}
            aria-label="Attendance date"
            onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))}
          />
          <Select
            value={filters.anomalyStatus}
            style={{ width: 180 }}
            aria-label="Exception status"
            options={[
              { value: 'all', label: 'All exceptions' },
              { value: 'normal', label: 'Normal' },
              { value: 'late', label: 'Late' },
              { value: 'early_leave', label: 'Early leave' },
              { value: 'duplicate_clock_in', label: 'Duplicate clock-in' },
              { value: 'duplicate_clock_out', label: 'Duplicate clock-out' },
              { value: 'missing_clock_in', label: 'Missing clock-in' },
              { value: 'missing_clock_out', label: 'Missing clock-out' }
            ]}
            onChange={(value) => setFilters((current) => ({ ...current, anomalyStatus: value }))}
          />
          <Select
            value={filters.reviewStatus}
            style={{ width: 190 }}
            aria-label="Review status"
            options={[
              { value: 'all', label: 'All review statuses' },
              { value: 'pending', label: 'Pending review' },
              { value: 'reviewed', label: 'Reviewed' },
              { value: 'confirmed', label: 'Confirmed exception' },
              { value: 'ignored', label: 'Ignored' }
            ]}
            onChange={(value) => setFilters((current) => ({ ...current, reviewStatus: value }))}
          />
          <Select
            value={filters.eventType}
            style={{ width: 150 }}
            aria-label="Clock type"
            options={[
              { value: 'all', label: 'All types' },
              { value: 'clock_in', label: 'Clock in' },
              { value: 'clock_out', label: 'Clock out' }
            ]}
            onChange={(value) => setFilters((current) => ({ ...current, eventType: value }))}
          />
          <Button onClick={() => setFilters(DEFAULT_FILTERS)}>Clear</Button>
        </Space>
        <Table
          rowKey="key"
          size="middle"
          dataSource={filteredRows}
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1360 }}
          columns={[
            {
              title: 'Employee',
              width: 220,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{record.employee}</Typography.Text>
                  <Typography.Text type="secondary">{record.employeeNo ?? record.userName}</Typography.Text>
                </Space>
              )
            },
            {
              title: 'Department / Device',
              width: 220,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.department ?? '--'}</Typography.Text>
                  <Typography.Text type="secondary">{record.machineName ?? 'Unknown device'}</Typography.Text>
                </Space>
              )
            },
            {
              title: 'Type',
              width: 130,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Tag color={record.eventType === 'clock_in' ? 'blue' : 'purple'}>{record.eventLabel}</Tag>
              )
            },
            {
              title: 'Time',
              width: 220,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.occurredAt}</Typography.Text>
                  <Typography.Text type="secondary">{record.workDate ?? '--'}</Typography.Text>
                </Space>
              )
            },
            {
              title: 'Exception',
              width: 260,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={4}>
                  <Tag color={attendanceStatusColor(record.anomalyStatus)}>{record.anomalyLabel}</Tag>
                  {buildAnomalyDetails(record, ruleSummary).length > 0 ? (
                    buildAnomalyDetails(record, ruleSummary).map((reason) => (
                      <Typography.Text key={reason} type="secondary">
                        {reason}
                      </Typography.Text>
                    ))
                  ) : (
                    <Typography.Text type="secondary">No exception detected</Typography.Text>
                  )}
                </Space>
              )
            },
            {
              title: 'Review',
              width: 180,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={4}>
                  <Tag color={reviewStatusColor(record.reviewStatus)}>{reviewStatusLabel(record.reviewStatus)}</Tag>
                  {record.reviewNote ? <Typography.Text type="secondary">{record.reviewNote}</Typography.Text> : null}
                </Space>
              )
            },
            ...(canManageAttendance
              ? [
                  {
                    title: 'Actions',
                    width: 180,
                    render: (_value: unknown, record: AttendanceRecord) => (
                      <Space size={4} wrap>
                        <Button
                          size="small"
                          type="link"
                          disabled={record.reviewStatus === 'confirmed'}
                          loading={reviewingKey === `${record.key}:confirmed`}
                          onClick={() =>
                            setReviewDraft({
                              record,
                              reviewStatus: 'confirmed',
                              note: record.reviewNote ?? buildDefaultReviewNote(record, 'confirmed', ruleSummary)
                            })
                          }
                        >
                          Confirm
                        </Button>
                        <Button
                          size="small"
                          type="link"
                          disabled={record.reviewStatus === 'ignored'}
                          loading={reviewingKey === `${record.key}:ignored`}
                          onClick={() =>
                            setReviewDraft({
                              record,
                              reviewStatus: 'ignored',
                              note: record.reviewNote ?? buildDefaultReviewNote(record, 'ignored', ruleSummary)
                            })
                          }
                        >
                          Ignore
                        </Button>
                      </Space>
                    )
                  }
                ]
              : []),
            {
              title: 'Source',
              dataIndex: 'source',
              width: 120
            }
          ]}
        />
      </Card>
      <Modal
        title="Edit default attendance rule"
        open={ruleEditorOpen}
        okText="Save"
        confirmLoading={ruleSaving}
        destroyOnClose
        onCancel={() => {
          setRuleEditorOpen(false);
          setRuleSaveError(null);
        }}
        onOk={() => void submitRuleUpdate()}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {ruleSaveError ? (
            <Alert
              type="error"
              showIcon
              message="Unable to save the default attendance rule"
              description={ruleSaveError}
            />
          ) : null}
          <Form form={ruleForm} layout="vertical" preserve={false}>
            <Form.Item
              label="Late after"
              name="clockInLateAfter"
              rules={[
                { required: true, message: 'Enter the late threshold.' },
                {
                  validator: (_rule, value: string) =>
                    isValidTimeValue(value) ? Promise.resolve() : Promise.reject(new Error('Use 24-hour HH:MM.'))
                }
              ]}
            >
              <Input type="time" step={60} aria-label="Late after" />
            </Form.Item>
            <Form.Item
              label="Early leave before"
              name="clockOutEarlyBefore"
              rules={[
                { required: true, message: 'Enter the early leave threshold.' },
                {
                  validator: (_rule, value: string) =>
                    isValidTimeValue(value) ? Promise.resolve() : Promise.reject(new Error('Use 24-hour HH:MM.'))
                }
              ]}
            >
              <Input type="time" step={60} aria-label="Early leave before" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
      <Modal
        title={reviewDraft ? `${reviewStatusLabel(reviewDraft.reviewStatus)} - ${reviewDraft.record.employee}` : 'Review'}
        open={Boolean(reviewDraft)}
        okText="Submit review"
        confirmLoading={Boolean(reviewDraft && reviewingKey === `${reviewDraft.record.key}:${reviewDraft.reviewStatus}`)}
        onCancel={() => setReviewDraft(null)}
        onOk={() => void submitReview()}
      >
        {reviewDraft ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space direction="vertical" size={2}>
              <Typography.Text strong>{reviewDraft.record.eventLabel}</Typography.Text>
              <Typography.Text type="secondary">
                {reviewDraft.record.occurredAt} / {reviewDraft.record.machineName ?? 'Unknown device'}
              </Typography.Text>
            </Space>
            <Input.TextArea
              value={reviewDraft.note}
              rows={4}
              maxLength={300}
              showCount
              placeholder="Add a review note"
              onChange={(event) =>
                setReviewDraft((current) => (current ? { ...current, note: event.target.value } : current))
              }
            />
          </Space>
        ) : null}
      </Modal>
    </Space>
  );
}

function attendanceStatusColor(status: string) {
  if (status === 'late' || status === 'early_leave') {
    return 'orange';
  }
  if (status === 'duplicate_clock_in' || status === 'duplicate_clock_out') {
    return 'volcano';
  }
  if (status === 'missing_clock_out' || status === 'missing_clock_in') {
    return 'red';
  }
  return 'green';
}

function reviewStatusColor(status: string) {
  if (status === 'pending') {
    return 'gold';
  }
  if (status === 'confirmed') {
    return 'red';
  }
  if (status === 'ignored' || status === 'reviewed') {
    return 'green';
  }
  return 'default';
}

function isValidTimeValue(value?: string) {
  return Boolean(value && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value));
}

function getRuleUpdateFailureMessage(errorCode: string | undefined, detail: string) {
  if (errorCode === 'forbidden') {
    return 'You do not have permission to update the default attendance rule.';
  }

  if (errorCode === 'not_found') {
    return 'This backend does not expose the default attendance rule update API yet.';
  }

  if (errorCode === 'invalid') {
    return detail || 'The backend rejected the submitted rule values.';
  }

  return detail || 'The default attendance rule could not be saved.';
}

function reviewStatusLabel(status: string) {
  if (status === 'pending') {
    return 'Pending review';
  }
  if (status === 'reviewed') {
    return 'Reviewed';
  }
  if (status === 'confirmed') {
    return 'Confirmed exception';
  }
  if (status === 'ignored') {
    return 'Ignored';
  }
  return status;
}

function buildAnomalyDetails(record: AttendanceRecord, ruleSummary: AttendanceRuleSummary) {
  if (record.anomalyStatus === 'normal') {
    return [];
  }

  const reasons = record.anomalyReasons.length > 0 ? record.anomalyReasons : [record.anomalyLabel];
  return reasons.map((reason) => formatAnomalyReason(record, reason, ruleSummary));
}

function formatAnomalyReason(record: AttendanceRecord, reason: string, ruleSummary: AttendanceRuleSummary) {
  if (record.anomalyStatus === 'late') {
    return `${reason} / expected clock-in no later than ${ruleSummary.lateThreshold}`;
  }

  if (record.anomalyStatus === 'early_leave') {
    return `${reason} / expected clock-out no earlier than ${ruleSummary.earlyLeaveThreshold}`;
  }

  if (record.anomalyStatus === 'missing_clock_in') {
    return `${reason} / no valid clock-in record for ${record.workDate ?? 'the selected work date'}`;
  }

  if (record.anomalyStatus === 'missing_clock_out') {
    return `${reason} / no valid clock-out record for ${record.workDate ?? 'the selected work date'}`;
  }

  if (record.anomalyStatus === 'duplicate_clock_in') {
    return `${reason} / more than one clock-in exists for ${record.workDate ?? 'the selected work date'}`;
  }

  if (record.anomalyStatus === 'duplicate_clock_out') {
    return `${reason} / more than one clock-out exists for ${record.workDate ?? 'the selected work date'}`;
  }

  return reason;
}

function buildDefaultReviewNote(
  record: AttendanceRecord,
  reviewStatus: AttendanceReviewStatus,
  ruleSummary: AttendanceRuleSummary
) {
  const action = reviewStatus === 'confirmed' ? 'Confirmed exception' : 'Ignored exception';
  const reason = buildAnomalyDetails(record, ruleSummary)[0] ?? record.anomalyLabel;
  return `${action}: ${reason}`;
}
