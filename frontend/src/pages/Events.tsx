import { Card, Space, Table } from 'antd';
import { useEffect, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
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
        description="Real event rows come from the backend when available and fall back to mock data otherwise."
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Event API" /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="id"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: 'Event ID', dataIndex: 'id' },
            { title: 'Employee', dataIndex: 'employee' },
            { title: 'Department', dataIndex: 'department' },
            { title: 'Type', dataIndex: 'type' },
            {
              title: 'Severity',
              dataIndex: 'severity',
              render: (value: string) => <StatusTag value={value} />
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (value: string) => <StatusTag value={value} />
            },
            { title: 'Started', dataIndex: 'startedAt' },
            { title: 'Duration', dataIndex: 'duration' },
            { title: 'Summary', dataIndex: 'summary' }
          ]}
        />
      </Card>
    </Space>
  );
}
