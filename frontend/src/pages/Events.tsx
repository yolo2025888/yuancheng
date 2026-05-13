import { Button, Card, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { ChangeMetricsSummary } from '../components/ChangeMetricsSummary';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { useI18n } from '../i18n/I18nContext';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, EventRecord, EventStatus } from '../types/models';

const REVIEW_ACTIONS: EventStatus[] = ['reviewing', 'reviewed', 'confirmed', 'ignored', 'closed'];

export function EventsPage() {
  const { t, text } = useI18n();
  const { canAccess, permissionsResolved } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<EventRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [messageApi, contextHolder] = message.useMessage();

  const statusFilter = searchParams.get('status') || 'reviewable';
  const severityFilter = searchParams.get('severity') || 'all';

  const loadEvents = useCallback(async () => {
    setLoading(true);
    const result = await adminApi.getEvents({ status: statusFilter, severity: severityFilter });
    setRows(result.data);
    setApiStatus(result.apiStatus);
    setLoading(false);
  }, [severityFilter, statusFilter]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const reviewableCount = useMemo(
    () => rows.filter((row) => row.status === 'new' || row.status === 'reviewing').length,
    [rows]
  );
  const canReviewEvents = !permissionsResolved || canAccess('events.review');

  const handleReviewAction = useCallback(
    async (record: EventRecord, nextStatus: EventStatus) => {
      const previousRows = rows;
      setPendingIds((current) => ({ ...current, [record.id]: true }));
      setRows((current) =>
        current.map((item) =>
          item.id === record.id
            ? {
                ...item,
                status: nextStatus,
                reviewedAt: nextStatus === 'reviewing' ? item.reviewedAt : new Date().toLocaleString(),
                reviewNote: nextStatus === 'reviewing' ? item.reviewNote : item.reviewNote ?? buildReviewNote(nextStatus, t)
              }
            : item
        )
      );

      const result = await adminApi.reviewEvent(record.id, nextStatus, undefined, {
        status: statusFilter,
        severity: severityFilter
      });
      setApiStatus(result.apiStatus);

      if (result.events) {
        setRows(result.events);
        messageApi.success(t('events.updated', 'Event {{id}} updated to {{status}}.', { id: record.id, status: text(nextStatus) }));
      } else if (result.apiStatus.label === 'Access denied') {
        setRows(previousRows);
        messageApi.error(t('events.accessDenied', 'Review access denied. Event {{id}} was not changed.', { id: record.id }));
      } else {
        messageApi.warning(t('events.localOnly', 'Backend review API unavailable. Event {{id}} is updated locally only.', { id: record.id }));
      }

      setPendingIds((current) => {
        const next = { ...current };
        delete next[record.id];
        return next;
      });
    },
    [messageApi, rows, severityFilter, statusFilter]
  );

  const updateFilter = useCallback(
    (key: 'status' | 'severity', value: string) => {
      const next = new URLSearchParams(searchParams);
      next.set(key, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  return (
    <Space direction="vertical" size={20} className="page-stack">
      {contextHolder}
      <PageSection
        title={t('events.title', 'Events')}
        description={t(
          'events.description',
          'Events load from the live list endpoint when available. Review actions update rows optimistically, then reload from the backend when the review endpoint succeeds.'
        )}
        extra={
          <Space size={8} wrap>
            <Tag color="orange">{t('events.needReview', '{{count}} need review', { count: reviewableCount })}</Tag>
            <Select
              size="small"
              value={statusFilter}
              style={{ width: 150 }}
              onChange={(value) => updateFilter('status', value)}
              options={[
                { value: 'reviewable', label: t('events.needReviewLabel', 'Need review') },
                { value: 'all', label: t('events.allStatuses', 'All statuses') },
                { value: 'reviewed', label: t('events.reviewed', 'Reviewed') },
                { value: 'confirmed', label: t('events.confirmed', 'Confirmed') },
                { value: 'ignored', label: t('events.ignored', 'Ignored') },
                { value: 'closed', label: t('events.closed', 'Closed') }
              ]}
            />
            <Select
              size="small"
              value={severityFilter}
              style={{ width: 130 }}
              onChange={(value) => updateFilter('severity', value)}
              options={[
                { value: 'all', label: t('events.allSeverity', 'All severity') },
                { value: 'critical', label: t('events.critical', 'Critical') },
                { value: 'high', label: t('events.high', 'High') },
                { value: 'medium', label: t('events.medium', 'Medium') },
                { value: 'low', label: t('events.low', 'Low') }
              ]}
            />
            <Button size="small" onClick={() => void loadEvents()} loading={loading}>
              {t('common.reload', 'Reload')}
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title={t('events.api', 'Event API')} /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="id"
          size="middle"
          dataSource={rows}
          loading={loading}
          pagination={false}
          scroll={{ x: 1580 }}
          columns={[
            { title: t('events.eventId', 'Event ID'), dataIndex: 'id', width: 120, fixed: 'left' },
            { title: t('common.employee', 'Employee'), dataIndex: 'employee', width: 120 },
            { title: t('common.department', 'Department'), dataIndex: 'department', width: 150, render: (value: string) => text(value) },
            {
              title: t('common.type', 'Type'),
              dataIndex: 'type',
              width: 220,
              render: (_value: string, record: EventRecord) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text strong>{text(record.type)}</Typography.Text>
                  {record.noChangeStreakTriggered ? <StatusTag value="no_change_streak" /> : null}
                </Space>
              )
            },
            {
              title: t('events.severity', 'Severity'),
              dataIndex: 'severity',
              width: 100,
              render: (value: string) => <StatusTag value={value} />
            },
            {
              title: t('common.status', 'Status'),
              dataIndex: 'status',
              width: 110,
              render: (value: string) => <StatusTag value={value} />
            },
            { title: t('events.started', 'Started'), dataIndex: 'startedAt', width: 180 },
            { title: t('events.duration', 'Duration'), dataIndex: 'duration', width: 100 },
            {
              title: t('events.screenshotDiff', 'Screenshot diff'),
              width: 340,
              render: (_value: unknown, record: EventRecord) => (
                <ChangeMetricsSummary
                  metrics={record.changeMetrics}
                  noChangeStreakTriggered={record.noChangeStreakTriggered}
                />
              )
            },
            {
              title: t('events.summaryReview', 'Summary / review'),
              dataIndex: 'summary',
              width: 330,
              render: (value: string, record: EventRecord) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text>{text(value)}</Typography.Text>
                  {record.streakCount ? (
                    <Typography.Text type="secondary">
                      {t('events.streakCount', 'Streak count {{count}}', { count: record.streakCount })}
                    </Typography.Text>
                  ) : null}
                  {record.relatedScreenshotId ? (
                    <Typography.Text type="secondary">
                      {t('events.screenshot', 'Screenshot {{id}}', { id: record.relatedScreenshotId })}
                    </Typography.Text>
                  ) : null}
                  <Space size={4}>
                    <Typography.Text type="secondary">{t('events.reviewStatus', 'Review status')}</Typography.Text>
                    <StatusTag value={record.status} />
                  </Space>
                  {record.reviewedAt ? (
                    <Typography.Text type="secondary">
                      {t('events.reviewedAt', 'Reviewed {{time}}{{reviewer}}', {
                        time: record.reviewedAt,
                        reviewer: record.reviewerName
                          ? t('events.byReviewer', ' by {{name}}', { name: record.reviewerName })
                          : ''
                      })}
                    </Typography.Text>
                  ) : null}
                  {record.reviewNote ? (
                    <Typography.Text type="secondary">
                      {t('events.reviewNote', 'Review note: {{note}}', { note: text(record.reviewNote) })}
                    </Typography.Text>
                  ) : null}
                </Space>
              )
            },
            {
              title: t('events.reviewActions', 'Review Actions'),
              width: 340,
              fixed: 'right',
              render: (_value: unknown, record: EventRecord) => (
                <Space size={[6, 6]} wrap>
                  {REVIEW_ACTIONS.map((status) => (
                    <Button
                      key={status}
                      size="small"
                      type={record.status === status ? 'primary' : 'default'}
                      loading={pendingIds[record.id] && record.status === status}
                      disabled={Boolean(pendingIds[record.id]) || !canReviewEvents}
                      onClick={() => void handleReviewAction(record, status)}
                    >
                      {text(status)}
                    </Button>
                  ))}
                </Space>
              )
            }
          ]}
        />
      </Card>
      {!canReviewEvents ? (
        <Typography.Text type="secondary">
          {t(
            'events.reviewDisabled',
            'Review actions are disabled because the current auth profile does not include `events.review`.'
          )}
        </Typography.Text>
      ) : null}
    </Space>
  );
}

type TranslateFn = ReturnType<typeof useI18n>['t'];

function buildReviewNote(status: EventStatus, t: TranslateFn) {
  switch (status) {
    case 'reviewed':
      return t('events.noteReviewed', 'Reviewed in admin UI fallback flow.');
    case 'confirmed':
      return t('events.noteConfirmed', 'Confirmed in admin UI fallback flow.');
    case 'ignored':
      return t('events.noteIgnored', 'Marked ignored in admin UI fallback flow.');
    case 'closed':
      return t('events.noteClosed', 'Closed in admin UI fallback flow.');
    default:
      return '';
  }
}
