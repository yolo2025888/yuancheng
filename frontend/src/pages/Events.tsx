import { Card, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { ChangeMetricsSummary } from '../components/ChangeMetricsSummary';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, EventRecord } from '../types/models';

export function EventsPage() {
  const [rows, setRows] = useState<EventRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);

  useEffect(() => {
    adminApi.getEvents().then((result) => {
      setRows(result.data);
      setApiStatus(result.apiStatus);
    });
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Events"
        description="Event rows keep live API sourcing when available and tolerate backend field drift for diff metrics."
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Event API" /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="id"
          size="middle"
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1280 }}
          columns={[
            { title: 'Event ID', dataIndex: 'id', width: 120, fixed: 'left' },
            { title: 'Employee', dataIndex: 'employee', width: 120 },
            { title: 'Department', dataIndex: 'department', width: 120 },
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
            { title: 'Duration', dataIndex: 'duration', width: 110 },
            {
              title: 'Screenshot diff',
              width: 360,
              render: (_value: unknown, record: EventRecord) => (
                <ChangeMetricsSummary
                  metrics={record.changeMetrics}
                  noChangeStreakTriggered={record.noChangeStreakTriggered}
                />
              )
            },
            {
              title: 'Summary / reason',
              dataIndex: 'summary',
              width: 340,
              render: (value: string, record: EventRecord) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text>{value}</Typography.Text>
                  {record.streakCount ? (
                    <Typography.Text type="secondary">
                      Streak count {record.streakCount}
                    </Typography.Text>
                  ) : null}
                  {record.relatedScreenshotId ? (
                    <Typography.Text type="secondary">
                      Screenshot {record.relatedScreenshotId}
                    </Typography.Text>
                  ) : null}
                </Space>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}
