import { Card, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, PolicyRecord } from '../types/models';

export function PoliciesPage() {
  const [rows, setRows] = useState<PolicyRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);

  useEffect(() => {
    adminApi.getPolicies().then((result) => {
      setRows(result.data);
      setApiStatus(result.apiStatus);
    });
  }, []);

  const summary = useMemo(() => {
    const activeCount = rows.filter((row) => row.status === 'active').length;
    const positions = new Set(rows.flatMap((row) => row.positions ?? []));

    return {
      activeCount,
      positions: positions.size
    };
  }, [rows]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Policies"
        description="Role and position scopes are shown directly so policy templates can be reviewed against different job posts without leaving the admin table."
        extra={
          <Space size={8} wrap>
            <Tag color="green">{summary.activeCount} active</Tag>
            <Tag color="blue">{rows.length} total policies</Tag>
            <Tag color="purple">{summary.positions} covered positions</Tag>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Policy API" /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1360 }}
          columns={[
            {
              title: 'Policy',
              width: 220,
              render: (_value: unknown, record: PolicyRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{record.name ?? record.role}</Typography.Text>
                  <Typography.Text type="secondary">{record.version ?? 'No version tag'}</Typography.Text>
                </Space>
              )
            },
            {
              title: 'Role Scope',
              dataIndex: 'role',
              width: 160
            },
            {
              title: 'Position Scope',
              width: 260,
              render: (_value: unknown, record: PolicyRecord) => (
                <Space size={[6, 6]} wrap>
                  {(record.positions?.length ? record.positions : ['All positions']).map((label) => (
                    <Tag color="geekblue" key={label}>
                      {label}
                    </Tag>
                  ))}
                </Space>
              )
            },
            {
              title: 'Department Scope',
              width: 220,
              render: (_value: unknown, record: PolicyRecord) => (
                <Space size={[6, 6]} wrap>
                  {(record.departments?.length ? record.departments : ['All departments']).map((label) => (
                    <Tag key={label}>{label}</Tag>
                  ))}
                </Space>
              )
            },
            {
              title: 'Capture / Review Window',
              width: 220,
              render: (_value: unknown, record: PolicyRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.screenshotInterval} capture interval</Typography.Text>
                  <Typography.Text type="secondary">{record.noChangeThreshold} no-change threshold</Typography.Text>
                  <Typography.Text type="secondary">{record.highRiskDuration} high-risk window</Typography.Text>
                </Space>
              )
            },
            {
              title: 'Retention / OCR',
              width: 170,
              render: (_value: unknown, record: PolicyRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.originalRetention}</Typography.Text>
                  <Typography.Text type="secondary">{record.ocrEnabled ? 'OCR enabled' : 'OCR disabled'}</Typography.Text>
                </Space>
              )
            },
            {
              title: 'Assigned',
              dataIndex: 'assignedEmployees',
              width: 100,
              render: (value?: number) => value ?? '--'
            },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 120,
              render: (value?: string) => <StatusTag value={value ?? 'draft'} />
            }
          ]}
        />
      </Card>
    </Space>
  );
}
