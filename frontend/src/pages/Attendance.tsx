import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
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
  const { t, text } = useI18n();
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
        messageApi.success(
          t('attendance.marked', '{{employee}} marked as {{status}}.', {
            employee: record.employee,
            status: reviewStatusLabel(reviewStatus, t)
          })
        );
      } else if (result.errorCode === 'forbidden') {
        messageApi.error(t('attendance.noReviewPermission', 'You do not have permission to review this attendance record.'));
      } else if (result.errorCode === 'not_found') {
        messageApi.error(t('attendance.recordGone', 'This attendance record is no longer available.'));
      } else if (result.errorCode === 'invalid') {
        messageApi.error(t('attendance.reviewRejected', 'The attendance review update was rejected.'));
      } else {
        messageApi.warning(t('attendance.reviewNotSaved', 'Review was not saved by the backend. The table was left unchanged.'));
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

      messageApi.success(t('attendance.ruleUpdated', 'Default attendance rule updated.'));
      setRuleEditorOpen(false);
      setRuleSaving(false);
      return;
    }

    const failureMessage = getRuleUpdateFailureMessage(result.errorCode, result.apiStatus.detail, t, text);
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
        title={t('attendance.title', 'Attendance')}
        description={t(
          'attendance.description',
          'Review employee clock-in and clock-out records, including late arrivals, early departures, and review status.'
        )}
        extra={
          <Space size={[8, 8]} wrap>
            <Tag color="blue">
              {t('attendance.records', '{{visible}}/{{total}} records', {
                visible: filteredRows.length,
                total: rows.length
              })}
            </Tag>
            <Tag color="cyan">{t('attendance.clockIns', '{{count}} clock-ins', { count: summary.clockInCount })}</Tag>
            <Tag color={summary.abnormalCount > 0 ? 'orange' : 'green'}>
              {t('attendance.exceptions', '{{count}} exceptions', { count: summary.abnormalCount })}
            </Tag>
            <Tag color={summary.pendingCount > 0 ? 'gold' : 'green'}>
              {t('attendance.pendingReview', '{{count}} pending review', { count: summary.pendingCount })}
            </Tag>
            <Button
              size="small"
              onClick={() => void Promise.all([loadAttendance(), loadAttendanceRules()])}
              loading={loading}
            >
              {t('common.reload', 'Reload')}
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title={t('attendance.api', 'Attendance API')} /> : null}
      <Card bordered={false} className="panel-card">
        <Space direction="vertical" size={8}>
          <Space size={8} wrap>
            <Typography.Text strong>{text(ruleSummary.name)}</Typography.Text>
            <Tag color={ruleApiStatus?.source === 'live' ? 'green' : 'gold'}>
              {text(ruleSummary.sourceLabel ?? ruleApiStatus?.label ?? t('attendance.fallbackDefaults', 'Fallback defaults'))}
            </Tag>
            {ruleSummary.timezone ? <Tag color="blue">{text(ruleSummary.timezone)}</Tag> : null}
            {canManageAttendance ? (
              <Button size="small" onClick={openRuleEditor}>
                {t('attendance.editThresholds', 'Edit thresholds')}
              </Button>
            ) : null}
          </Space>
          <Space size={[8, 8]} wrap>
            <Tag color="orange">{t('attendance.lateAfter', 'Late after {{time}}', { time: ruleSummary.lateThreshold })}</Tag>
            <Tag color="purple">
              {t('attendance.earlyBefore', 'Early leave before {{time}}', { time: ruleSummary.earlyLeaveThreshold })}
            </Tag>
          </Space>
          <Typography.Text type="secondary">
            {t(
              'attendance.ruleHint',
              'These thresholds drive the table explanations below. If the backend rule endpoint is unavailable, the page uses the current default rule.'
            )}
          </Typography.Text>
        </Space>
      </Card>
      <Card bordered={false} className="panel-card">
        <Space size={[12, 12]} wrap style={{ marginBottom: 16 }}>
          <Input
            type="date"
            value={filters.date}
            style={{ width: 170 }}
            aria-label={t('attendance.date', 'Attendance date')}
            onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))}
          />
          <Select
            value={filters.anomalyStatus}
            style={{ width: 180 }}
            aria-label={t('attendance.exceptionStatus', 'Exception status')}
            options={[
              { value: 'all', label: t('attendance.allExceptions', 'All exceptions') },
              { value: 'normal', label: t('attendance.normal', 'Normal') },
              { value: 'late', label: t('attendance.late', 'Late') },
              { value: 'early_leave', label: t('attendance.earlyLeave', 'Early leave') },
              { value: 'duplicate_clock_in', label: t('attendance.duplicateClockIn', 'Duplicate clock-in') },
              { value: 'duplicate_clock_out', label: t('attendance.duplicateClockOut', 'Duplicate clock-out') },
              { value: 'missing_clock_in', label: t('attendance.missingClockIn', 'Missing clock-in') },
              { value: 'missing_clock_out', label: t('attendance.missingClockOut', 'Missing clock-out') }
            ]}
            onChange={(value) => setFilters((current) => ({ ...current, anomalyStatus: value }))}
          />
          <Select
            value={filters.reviewStatus}
            style={{ width: 190 }}
            aria-label={t('attendance.reviewStatus', 'Review status')}
            options={[
              { value: 'all', label: t('attendance.allReviews', 'All review statuses') },
              { value: 'pending', label: t('attendance.pending', 'Pending review') },
              { value: 'reviewed', label: t('attendance.reviewed', 'Reviewed') },
              { value: 'confirmed', label: t('attendance.reviewConfirmed', 'Confirmed exception') },
              { value: 'ignored', label: t('attendance.reviewIgnored', 'Ignored') }
            ]}
            onChange={(value) => setFilters((current) => ({ ...current, reviewStatus: value }))}
          />
          <Select
            value={filters.eventType}
            style={{ width: 150 }}
            aria-label={t('attendance.clockType', 'Clock type')}
            options={[
              { value: 'all', label: t('attendance.allTypes', 'All types') },
              { value: 'clock_in', label: t('attendance.clockIn', 'Clock in') },
              { value: 'clock_out', label: t('attendance.clockOut', 'Clock out') }
            ]}
            onChange={(value) => setFilters((current) => ({ ...current, eventType: value }))}
          />
          <Button onClick={() => setFilters(DEFAULT_FILTERS)}>{t('common.clear', 'Clear')}</Button>
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
              title: t('common.employee', 'Employee'),
              width: 220,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{record.employee}</Typography.Text>
                  <Typography.Text type="secondary">{record.employeeNo ?? record.userName}</Typography.Text>
                </Space>
              )
            },
            {
              title: t('attendance.departmentDevice', 'Department / Device'),
              width: 220,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.department ? text(record.department) : '--'}</Typography.Text>
                  <Typography.Text type="secondary">{record.machineName ?? t('common.unknownDevice', 'Unknown device')}</Typography.Text>
                </Space>
              )
            },
            {
              title: t('common.type', 'Type'),
              width: 130,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Tag color={record.eventType === 'clock_in' ? 'blue' : 'purple'}>{text(record.eventLabel)}</Tag>
              )
            },
            {
              title: t('common.time', 'Time'),
              width: 220,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.occurredAt}</Typography.Text>
                  <Typography.Text type="secondary">{record.workDate ?? '--'}</Typography.Text>
                </Space>
              )
            },
            {
              title: t('attendance.exception', 'Exception'),
              width: 260,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={4}>
                  <Tag color={attendanceStatusColor(record.anomalyStatus)}>{text(record.anomalyLabel)}</Tag>
                  {buildAnomalyDetails(record, ruleSummary, t, text).length > 0 ? (
                    buildAnomalyDetails(record, ruleSummary, t, text).map((reason) => (
                      <Typography.Text key={reason} type="secondary">
                        {reason}
                      </Typography.Text>
                    ))
                  ) : (
                    <Typography.Text type="secondary">{t('attendance.noException', 'No exception detected')}</Typography.Text>
                  )}
                </Space>
              )
            },
            {
              title: t('common.review', 'Review'),
              width: 180,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={4}>
                  <Tag color={reviewStatusColor(record.reviewStatus)}>{reviewStatusLabel(record.reviewStatus, t)}</Tag>
                  {record.reviewNote ? <Typography.Text type="secondary">{record.reviewNote}</Typography.Text> : null}
                </Space>
              )
            },
            ...(canManageAttendance
              ? [
                  {
                    title: t('common.actions', 'Actions'),
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
                              note: record.reviewNote ?? buildDefaultReviewNote(record, 'confirmed', ruleSummary, t, text)
                            })
                          }
                        >
                          {t('attendance.confirm', 'Confirm')}
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
                              note: record.reviewNote ?? buildDefaultReviewNote(record, 'ignored', ruleSummary, t, text)
                            })
                          }
                        >
                          {t('attendance.ignore', 'Ignore')}
                        </Button>
                      </Space>
                    )
                  }
                ]
              : []),
            {
              title: t('common.source', 'Source'),
              dataIndex: 'source',
              width: 120
            }
          ]}
        />
      </Card>
      <Modal
        title={t('attendance.editRule', 'Edit default attendance rule')}
        open={ruleEditorOpen}
        okText={t('common.save', 'Save')}
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
              message={t('attendance.unableSaveRule', 'Unable to save the default attendance rule')}
              description={ruleSaveError}
            />
          ) : null}
          <Form form={ruleForm} layout="vertical" preserve={false}>
            <Form.Item
              label={t('attendance.late', 'Late after')}
              name="clockInLateAfter"
              rules={[
                { required: true, message: t('attendance.lateThresholdRequired', 'Enter the late threshold.') },
                {
                  validator: (_rule, value: string) =>
                    isValidTimeValue(value) ? Promise.resolve() : Promise.reject(new Error(t('attendance.timeFormat', 'Use 24-hour HH:MM.')))
                }
              ]}
            >
              <Input type="time" step={60} aria-label={t('attendance.late', '迟到阈值')} />
            </Form.Item>
            <Form.Item
              label={t('attendance.earlyLeave', 'Early leave before')}
              name="clockOutEarlyBefore"
              rules={[
                { required: true, message: t('attendance.earlyThresholdRequired', 'Enter the early leave threshold.') },
                {
                  validator: (_rule, value: string) =>
                    isValidTimeValue(value) ? Promise.resolve() : Promise.reject(new Error(t('attendance.timeFormat', 'Use 24-hour HH:MM.')))
                }
              ]}
            >
              <Input type="time" step={60} aria-label={t('attendance.earlyLeave', '早退阈值')} />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
      <Modal
        title={reviewDraft ? `${reviewStatusLabel(reviewDraft.reviewStatus, t)} - ${reviewDraft.record.employee}` : t('attendance.reviewModal', 'Review')}
        open={Boolean(reviewDraft)}
        okText={t('attendance.submitReview', 'Submit review')}
        confirmLoading={Boolean(reviewDraft && reviewingKey === `${reviewDraft.record.key}:${reviewDraft.reviewStatus}`)}
        onCancel={() => setReviewDraft(null)}
        onOk={() => void submitReview()}
      >
        {reviewDraft ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space direction="vertical" size={2}>
              <Typography.Text strong>{text(reviewDraft.record.eventLabel)}</Typography.Text>
              <Typography.Text type="secondary">
                {reviewDraft.record.occurredAt} / {reviewDraft.record.machineName ?? t('common.unknownDevice', 'Unknown device')}
              </Typography.Text>
            </Space>
            <Input.TextArea
              value={reviewDraft.note}
              rows={4}
              maxLength={300}
              showCount
              placeholder={t('attendance.addReviewNote', 'Add a review note')}
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

type TranslateFn = ReturnType<typeof useI18n>['t'];
type TranslateTextFn = ReturnType<typeof useI18n>['text'];

function getRuleUpdateFailureMessage(
  errorCode: string | undefined,
  detail: string,
  t: TranslateFn,
  text: TranslateTextFn
) {
  if (errorCode === 'forbidden') {
    return t('attendance.ruleNoPermission', 'You do not have permission to update the default attendance rule.');
  }

  if (errorCode === 'not_found') {
    return t('attendance.ruleNoApi', 'This backend does not expose the default attendance rule update API yet.');
  }

  if (errorCode === 'invalid') {
    return text(detail) || t('attendance.ruleInvalid', 'The backend rejected the submitted rule values.');
  }

  return text(detail) || t('attendance.ruleSaveFailed', 'The default attendance rule could not be saved.');
}

function reviewStatusLabel(status: string, t: TranslateFn) {
  if (status === 'pending') {
    return t('attendance.pending', 'Pending review');
  }
  if (status === 'reviewed') {
    return t('attendance.reviewed', 'Reviewed');
  }
  if (status === 'confirmed') {
    return t('attendance.reviewConfirmed', 'Confirmed exception');
  }
  if (status === 'ignored') {
    return t('attendance.reviewIgnored', 'Ignored');
  }
  return status;
}

function buildAnomalyDetails(
  record: AttendanceRecord,
  ruleSummary: AttendanceRuleSummary,
  t: TranslateFn,
  text: TranslateTextFn
) {
  if (record.anomalyStatus === 'normal') {
    return [];
  }

  const reasons = record.anomalyReasons.length > 0 ? record.anomalyReasons : [record.anomalyLabel];
  return reasons.map((reason) => formatAnomalyReason(record, text(reason), ruleSummary, t));
}

function formatAnomalyReason(
  record: AttendanceRecord,
  reason: string,
  ruleSummary: AttendanceRuleSummary,
  t: TranslateFn
) {
  if (record.anomalyStatus === 'late') {
    return t('attendance.expectedClockIn', '{{reason}} / expected clock-in no later than {{time}}', {
      reason,
      time: ruleSummary.lateThreshold
    });
  }

  if (record.anomalyStatus === 'early_leave') {
    return t('attendance.expectedClockOut', '{{reason}} / expected clock-out no earlier than {{time}}', {
      reason,
      time: ruleSummary.earlyLeaveThreshold
    });
  }

  if (record.anomalyStatus === 'missing_clock_in') {
    return t('attendance.noClockIn', '{{reason}} / no valid clock-in record for {{date}}', {
      reason,
      date: record.workDate ?? t('attendance.selectedWorkDate', 'the selected work date')
    });
  }

  if (record.anomalyStatus === 'missing_clock_out') {
    return t('attendance.noClockOut', '{{reason}} / no valid clock-out record for {{date}}', {
      reason,
      date: record.workDate ?? t('attendance.selectedWorkDate', 'the selected work date')
    });
  }

  if (record.anomalyStatus === 'duplicate_clock_in') {
    return t('attendance.multiClockIn', '{{reason}} / more than one clock-in exists for {{date}}', {
      reason,
      date: record.workDate ?? t('attendance.selectedWorkDate', 'the selected work date')
    });
  }

  if (record.anomalyStatus === 'duplicate_clock_out') {
    return t('attendance.multiClockOut', '{{reason}} / more than one clock-out exists for {{date}}', {
      reason,
      date: record.workDate ?? t('attendance.selectedWorkDate', 'the selected work date')
    });
  }

  return reason;
}

function buildDefaultReviewNote(
  record: AttendanceRecord,
  reviewStatus: AttendanceReviewStatus,
  ruleSummary: AttendanceRuleSummary,
  t: TranslateFn,
  text: TranslateTextFn
) {
  const action =
    reviewStatus === 'confirmed'
      ? t('attendance.confirmedException', 'Confirmed exception')
      : t('attendance.ignoredException', 'Ignored exception');
  const reason = buildAnomalyDetails(record, ruleSummary, t, text)[0] ?? text(record.anomalyLabel);
  return `${action}: ${reason}`;
}
