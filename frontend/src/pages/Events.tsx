import { Button, Card, Space, Table, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { ChangeMetricsSummary } from '../components/ChangeMetricsSummary';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, EventRecord, EventStatus } from '../types/models';

const REVIEW_ACTIONS: EventStatus[] = ['reviewing', 'confirmed', 'ignored', 'closed'];

export function EventsPage() {
  const [rows, setRows] = useState<EventRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [messageApi, contextHolder] = message.useMessage();

  const loadEvents = useCallback(async () => {
    setLoading(true);
    const result = await adminApi.getEvents();
    setRows(result.data);
    setApiStatus(result.apiStatus);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const reviewableCount = useMemo(
    () => rows.filter((row) => row.status === 'new' || row.status === 'reviewing').length,
    [rows]
  );

  const handleReviewAction = useCallback(
    async (record: EventRecord, nextStatus: EventStatus) => {
      setPendingIds((current) => ({ ...current, [record.id]: true }));
      setRows((current) =>
        current.map((item) =>
          item.id === record.id
            ? {
                ...item,
                status: nextStatus,
                reviewedAt:
                  nextStatus === 'reviewing'
                    ? item.reviewedAt
                    : new Date().toLocaleString(),
                reviewNote:
                  nextStatus === 'ignored'
                    ? 'Marked ignored in admin UI fallback flow.'
                    : item.reviewNote
              }
            : item
        )
      );

      const result = await adminApi.reviewEvent(record.id, nextStatus);
      setApiStatus(result.apiStatus);

      if (result.events) {
        setRows(result.events);
        messageApi.success(`Event ${record.id} updated to ${nextStatus}.`);
      } else {
        messageApi.warning(`Backend review API unavailable. Event ${record.id} is updated locally only.`);
      }

      setPendingIds((current) => {
        const next = { ...current };
        delete next[record.id];
        return next;
      });
    },
    [messageApi]
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
                  {record.reviewedAt ? (
                    <Typography.Text type="secondary">Reviewed {record.reviewedAt}</Typography.Text>
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
                      disabled={Boolean(pendingIds[record.id])}
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
    </Space>
  );
}
