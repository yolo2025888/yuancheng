import { Card, Space, Table } from 'antd';
import { useEffect, useState } from 'react';

import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { DeviceRecord } from '../types/models';

export function DevicesPage() {
  const [rows, setRows] = useState<DeviceRecord[]>([]);

  useEffect(() => {
    adminApi.getDevices().then(setRows);
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="设备管理"
        description="设备列表预留在线状态、Agent 版本和心跳字段，后续可扩展到升级、重试和离线告警。"
      />
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: '设备名', dataIndex: 'deviceName' },
            { title: '绑定员工', dataIndex: 'employee' },
            { title: '系统', dataIndex: 'os' },
            { title: 'Agent 版本', dataIndex: 'agentVersion' },
            { title: '最近心跳', dataIndex: 'lastHeartbeat' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (value: string) => <StatusTag value={value} />
            }
          ]}
        />
      </Card>
    </Space>
  );
}
