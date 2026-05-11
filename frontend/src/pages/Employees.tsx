import { Card, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, EmployeeRecord } from '../types/models';

export function EmployeesPage() {
  const [rows, setRows] = useState<EmployeeRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);

  useEffect(() => {
    adminApi.getEmployees().then((result) => {
      setRows(result.data);
      setApiStatus(result.apiStatus);
    });
  }, []);

  const summary = useMemo(() => {
    const positions = new Set(rows.map((row) => row.position).filter(Boolean));
    const riskyEmployees = rows.filter((row) => row.todayRisk > 0).length;

    return {
      positions: positions.size,
      riskyEmployees
    };
  }, [rows]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Employees"
        description="Live employee records are used when available. Job role and position are shown explicitly so admin policy coverage can be managed by post."
        extra={
          <Space size={8} wrap>
            <Tag color="blue">{rows.length} employees</Tag>
            <Tag color="purple">{summary.positions} positions</Tag>
            <Tag color={summary.riskyEmployees > 0 ? 'orange' : 'green'}>
              {summary.riskyEmployees} with risk today
            </Tag>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Employee API" /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1180 }}
          columns={[
            {
              title: 'Employee',
              dataIndex: 'name',
              width: 220,
              render: (_value: string, record: EmployeeRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{record.name}</Typography.Text>
                  <Typography.Text type="secondary">{record.employeeNo ?? 'No employee no.'}</Typography.Text>
                </Space>
              )
            },
            { title: 'Department', dataIndex: 'department', width: 180 },
            {
              title: 'Role / Position',
              width: 240,
              render: (_value: unknown, record: EmployeeRecord) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text>{record.role}</Typography.Text>
                  {record.position ? <Tag color="geekblue">{record.position}</Tag> : null}
                </Space>
              )
            },
            {
              title: 'Manager / Policy',
              width: 220,
              render: (_value: unknown, record: EmployeeRecord) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text>{record.manager}</Typography.Text>
                  {record.policyName ? <Typography.Text type="secondary">{record.policyName}</Typography.Text> : null}
                </Space>
              )
            },
            {
              title: 'Devices / Risk',
              width: 140,
              render: (_value: unknown, record: EmployeeRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.devices} devices</Typography.Text>
                  <Typography.Text type={record.todayRisk > 0 ? 'warning' : 'secondary'}>
                    {record.todayRisk} risk events
                  </Typography.Text>
                </Space>
              )
            },
            { title: 'GitHub', dataIndex: 'githubAccount', width: 180 },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 120,
              render: (value?: string) => <StatusTag value={value ?? 'active'} />
            }
          ]}
        />
      </Card>
    </Space>
  );
}
