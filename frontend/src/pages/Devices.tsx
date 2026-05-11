import { Card, Space, Table } from 'antd';
import { useEffect, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, DeviceRecord } from '../types/models';

export function DevicesPage() {
  const [rows, setRows] = useState<DeviceRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);

  useEffect(() => {
    adminApi.getDevices().then((result) => {
      setRows(result.data);
      setApiStatus(result.apiStatus);
    });
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Devices"
        description="Real device API is attempted first; mock rows stay available while the backend endpoint is incomplete."
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Device API" /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: 'Device', dataIndex: 'deviceName' },
            { title: 'Employee', dataIndex: 'employee' },
            { title: 'OS', dataIndex: 'os' },
            { title: 'Agent', dataIndex: 'agentVersion' },
            { title: 'Last Heartbeat', dataIndex: 'lastHeartbeat' },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (value: string) => <StatusTag value={value} />
            }
          ]}
        />
      </Card>
    </Space>
  );
}
