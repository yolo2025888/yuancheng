import { Card, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { BackendHealthNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { BackendHealth, RealtimeStatusRecord } from '../types/models';

export function RealtimeStatusPage() {
  const [rows, setRows] = useState<RealtimeStatusRecord[]>([]);
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);

  useEffect(() => {
    adminApi.getRealtimeStatus().then((data) => {
      setRows(data.rows);
      setBackendHealth(data.backendHealth);
    });
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Realtime Status"
        description="Current mock monitoring board with backend health signal for MVP-1 API rollout."
      />
      {backendHealth ? <BackendHealthNotice health={backendHealth} /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: 'Employee', dataIndex: 'employee' },
            { title: 'Department', dataIndex: 'department' },
            { title: 'Role', dataIndex: 'role' },
            { title: 'Device', dataIndex: 'device' },
            {
              title: 'Status',
              dataIndex: 'currentStatus',
              render: (value: string) => <StatusTag value={value} />
            },
            { title: 'App', dataIndex: 'app' },
            { title: 'Activity', dataIndex: 'activity' },
            {
              title: 'Last Screenshot',
              dataIndex: 'lastScreenshotAt',
              render: (value: string) => <Typography.Text code>{value}</Typography.Text>
            },
            { title: 'No Change', dataIndex: 'noChangeCount' },
            {
              title: 'Risk',
              dataIndex: 'riskLevel',
              render: (value: string) => <StatusTag value={value} />
            }
          ]}
        />
      </Card>
    </Space>
  );
}
