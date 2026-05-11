import { Card, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { RealtimeStatusRecord } from '../types/models';

export function RealtimeStatusPage() {
  const [rows, setRows] = useState<RealtimeStatusRecord[]>([]);

  useEffect(() => {
    adminApi.getRealtimeStatus().then(setRows);
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="实时状态"
        description="按团队巡检当前在线、锁屏、静止和高风险人员，适合值班主管快速定位异常。"
      />
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: '员工', dataIndex: 'employee' },
            { title: '部门', dataIndex: 'department' },
            { title: '岗位', dataIndex: 'role' },
            { title: '设备', dataIndex: 'device' },
            {
              title: '当前状态',
              dataIndex: 'currentStatus',
              render: (value: string) => <StatusTag value={value} />
            },
            { title: '前台应用', dataIndex: 'app' },
            { title: '当前活动', dataIndex: 'activity' },
            {
              title: '最近截图',
              dataIndex: 'lastScreenshotAt',
              render: (value: string) => <Typography.Text code>{value}</Typography.Text>
            },
            { title: '无变化次数', dataIndex: 'noChangeCount' },
            {
              title: '风险级别',
              dataIndex: 'riskLevel',
              render: (value: string) => <StatusTag value={value} />
            }
          ]}
        />
      </Card>
    </Space>
  );
}
