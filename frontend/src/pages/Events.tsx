import { Card, Space, Table } from 'antd';
import { useEffect, useState } from 'react';

import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { EventRecord } from '../types/models';

export function EventsPage() {
  const [rows, setRows] = useState<EventRecord[]>([]);

  useEffect(() => {
    adminApi.getEvents().then(setRows);
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="事件中心"
        description="集中展示静止、离线、GitHub 异常等事件，表格字段按复核流程预留状态和摘要。"
      />
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="id"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: '事件 ID', dataIndex: 'id' },
            { title: '员工', dataIndex: 'employee' },
            { title: '部门', dataIndex: 'department' },
            { title: '类型', dataIndex: 'type' },
            {
              title: '严重级别',
              dataIndex: 'severity',
              render: (value: string) => <StatusTag value={value} />
            },
            {
              title: '处理状态',
              dataIndex: 'status',
              render: (value: string) => <StatusTag value={value} />
            },
            { title: '开始时间', dataIndex: 'startedAt' },
            { title: '持续时长', dataIndex: 'duration' },
            { title: '摘要', dataIndex: 'summary' }
          ]}
        />
      </Card>
    </Space>
  );
}
