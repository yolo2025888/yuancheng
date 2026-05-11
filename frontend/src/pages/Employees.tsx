import { Card, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { PageSection } from '../components/PageSection';
import { adminApi } from '../services/adminApi';
import type { EmployeeRecord } from '../types/models';

export function EmployeesPage() {
  const [rows, setRows] = useState<EmployeeRecord[]>([]);

  useEffect(() => {
    adminApi.getEmployees().then(setRows);
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="员工管理"
        description="展示员工、部门、岗位、主管关系和 GitHub 账号绑定，作为后续 CRUD 的占位骨架。"
      />
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '姓名', dataIndex: 'name' },
            { title: '部门', dataIndex: 'department' },
            { title: '岗位', dataIndex: 'role' },
            { title: '直属主管', dataIndex: 'manager' },
            { title: '绑定设备', dataIndex: 'devices' },
            {
              title: '今日风险数',
              dataIndex: 'todayRisk',
              render: (value: number) => (
                <Typography.Text type={value > 0 ? 'warning' : undefined}>
                  {value}
                </Typography.Text>
              )
            },
            { title: 'GitHub 账号', dataIndex: 'githubAccount' }
          ]}
        />
      </Card>
    </Space>
  );
}
