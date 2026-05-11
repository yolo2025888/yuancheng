import { Button, Card, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { ChangeMetricsSummary } from '../components/ChangeMetricsSummary';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, EventRecord, EventStatus } from '../types/models';

const REVIEW_ACTIONS: EventStatus[] = ['reviewing', 'reviewed', 'confirmed', 'ignored', 'closed'];

export function EventsPage() {
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
                reviewNote: nextStatus === 'reviewing' ? item.reviewNote : item.reviewNote ?? buildReviewNote(nextStatus)
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
        messageApi.success(`Event ${record.id} updated to ${nextStatus}.`);
      } else if (result.apiStatus.label === 'Access denied') {
        setRows(previousRows);
        messageApi.error(`Review access denied. Event ${record.id} was not changed.`);
      } else {
        messageApi.warning(`Backend review API unavailable. Event ${record.id} is updated locally only.`);
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
        title="Events"
        description="Events load from the live list endpoint when available. Review actions update rows optimistically, then reload from the backend when the review endpoint succeeds."
        extra={
          <Space size={8} wrap>
            <Tag color="orange">{reviewableCount} need review</Tag>
            <Select
              size="small"
              value={statusFilter}
              style={{ width: 150 }}
              onChange={(value) => updateFilter('status', value)}
              options={[
                { value: 'reviewable', label: 'Need review' },
                { value: 'all', label: 'All statuses' },
                { value: 'reviewed', label: 'Reviewed' },
                { value: 'confirmed', label: 'Confirmed' },
                { value: 'ignored', label: 'Ignored' },
                { value: 'closed', label: 'Closed' }
              ]}
            />
            <Select
              size="small"
              value={severityFilter}
              style={{ width: 130 }}
              onChange={(value) => updateFilter('severity', value)}
              options={[
                { value: 'all', label: 'All severity' },
                { value: 'critical', label: 'Critical' },
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' }
              ]}
            />
            <Button size="small" onClick={() => void loadEvents()} loading={loading}>
              Reload
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Event API" /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="id"
          size="middle"
          dataSource={rows}
          loading={loading}
          pagination={false}
          scroll={{ x: 1580 }}
          columns={[
            { title: 'Event ID', dataIndex: 'id', width: 120, fixed: 'left' },
            { title: 'Employee', dataIndex: 'employee', width: 120 },
            { title: 'Department', dataIndex: 'department', width: 150 },
            {
              title: 'Type',
              dataIndex: 'type',
              width: 220,
              render: (_value: string, record: EventRecord) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text strong>{record.type}</Typography.Text>
                  {record.noChangeStreakTriggered ? <StatusTag value="no_change_streak" /> : null}
                </Space>
              )
            },
            {
              title: 'Severity',
              dataIndex: 'severity',
              width: 100,
              render: (value: string) => <StatusTag value={value} />
            },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 110,
              render: (value: string) => <StatusTag value={value} />
            },
            { title: 'Started', dataIndex: 'startedAt', width: 180 },
            { title: 'Duration', dataIndex: 'duration', width: 100 },
            {
              title: 'Screenshot diff',
              width: 340,
              render: (_value: unknown, record: EventRecord) => (
                <ChangeMetricsSummary
                  metrics={record.changeMetrics}
                  noChangeStreakTriggered={record.noChangeStreakTriggered}
                />
              )
            },
            {
              title: 'Summary / review',
              dataIndex: 'summary',
              width: 330,
              render: (value: string, record: EventRecord) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text>{value}</Typography.Text>
                  {record.streakCount ? (
                    <Typography.Text type="secondary">Streak count {record.streakCount}</Typography.Text>
                  ) : null}
                  {record.relatedScreenshotId ? (
                    <Typography.Text type="secondary">Screenshot {record.relatedScreenshotId}</Typography.Text>
                  ) : null}
                  <Space size={4}>
                    <Typography.Text type="secondary">Review status</Typography.Text>
                    <StatusTag value={record.status} />
                  </Space>
                  {record.reviewedAt ? (
                    <Typography.Text type="secondary">
                      Reviewed {record.reviewedAt}
                      {record.reviewerName ? ` by ${record.reviewerName}` : ''}
                    </Typography.Text>
                  ) : null}
                  {record.reviewNote ? (
                    <Typography.Text type="secondary">Review note: {record.reviewNote}</Typography.Text>
                  ) : null}
                </Space>
              )
            },
            {
              title: 'Review Actions',
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
                      {status}
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
          Review actions are disabled because the current auth profile does not include `events.review`.
        </Typography.Text>
      ) : null}
    </Space>
  );
}

function buildReviewNote(status: EventStatus) {
  switch (status) {
    case 'reviewed':
      return 'Reviewed in admin UI fallback flow.';
    case 'confirmed':
      return 'Confirmed in admin UI fallback flow.';
    case 'ignored':
      return 'Marked ignored in admin UI fallback flow.';
    case 'closed':
      return 'Closed in admin UI fallback flow.';
    default:
      return '';
  }
}
