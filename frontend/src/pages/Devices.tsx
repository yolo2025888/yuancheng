import { Card, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';

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

  const summary = useMemo(() => {
    const remoteCount = rows.filter((row) => row.metadataLabels?.some((label) => label.includes('Remote'))).length;
    const lockedCount = rows.filter((row) => row.metadataLabels?.some((label) => label.includes('Locked'))).length;

    return { remoteCount, lockedCount };
  }, [rows]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Devices"
        description="Live device heartbeat data is preferred. Agent-only aggregate metadata is shown as labels without exposing raw input or private content."
        extra={
          <Space size={8} wrap>
            <Tag color="blue">{rows.length} devices</Tag>
            <Tag color="cyan">{summary.remoteCount} remote sessions</Tag>
            <Tag color="gold">{summary.lockedCount} locked</Tag>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Device API" /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1320 }}
          columns={[
            { title: 'Device', dataIndex: 'deviceName', width: 180 },
            {
              title: 'Employee',
              width: 220,
              render: (_value: unknown, record: DeviceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{record.employee}</Typography.Text>
                  <Typography.Text type="secondary">{record.employeeNo ?? 'No employee no.'}</Typography.Text>
                </Space>
              )
            },
            {
              title: 'Role / Position',
              width: 220,
              render: (_value: unknown, record: DeviceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.department ?? 'Unknown department'}</Typography.Text>
                  <Typography.Text type="secondary">
                    {[record.role, record.position].filter(Boolean).join(' / ') || 'No role metadata'}
                  </Typography.Text>
                </Space>
              )
            },
            {
              title: 'Agent / OS',
              width: 180,
              render: (_value: unknown, record: DeviceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>Agent {record.agentVersion}</Typography.Text>
                  <Typography.Text type="secondary">{record.os}</Typography.Text>
                </Space>
              )
            },
            { title: 'Last Heartbeat', dataIndex: 'lastHeartbeat', width: 180 },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 120,
              render: (value: string) => <StatusTag value={value} />
            },
            {
              title: 'Agent Metadata',
              width: 360,
              render: (_value: unknown, record: DeviceRecord) => (
                <Space size={[6, 6]} wrap>
                  {(record.metadataLabels?.length ? record.metadataLabels : ['No extra metadata']).map((label) => (
                    <Tag key={label}>{label}</Tag>
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
