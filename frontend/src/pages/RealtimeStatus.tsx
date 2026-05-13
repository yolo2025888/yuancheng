import { Card, Space, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { BackendHealthNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { useI18n } from '../i18n/I18nContext';
import { adminApi } from '../services/adminApi';
import type { BackendHealth, RealtimeStatusRecord } from '../types/models';

export function RealtimeStatusPage() {
  const { t, text } = useI18n();
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
        title={t('realtime.title', 'Realtime Status')}
        description={t('realtime.description', 'Current live monitoring board with backend health signal.')}
      />
      {backendHealth ? <BackendHealthNotice health={backendHealth} /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: t('common.employee', 'Employee'), dataIndex: 'employee' },
            { title: t('common.department', 'Department'), dataIndex: 'department', render: (value: string) => text(value) },
            { title: t('common.role', 'Role'), dataIndex: 'role', render: (value: string) => text(value) },
            { title: t('common.device', 'Device'), dataIndex: 'device' },
            {
              title: t('common.status', 'Status'),
              dataIndex: 'currentStatus',
              render: (value: string) => <StatusTag value={value} />
            },
            { title: t('realtime.app', 'App'), dataIndex: 'app' },
            { title: t('realtime.activity', 'Activity'), dataIndex: 'activity', render: (value: string) => text(value) },
            {
              title: t('realtime.lastScreenshot', 'Last Screenshot'),
              dataIndex: 'lastScreenshotAt',
              render: (value: string) => <Typography.Text code>{value}</Typography.Text>
            },
            { title: t('realtime.noChange', 'No Change'), dataIndex: 'noChangeCount' },
            {
              title: t('realtime.risk', 'Risk'),
              dataIndex: 'riskLevel',
              render: (value: string) => <StatusTag value={value} />
            }
          ]}
        />
      </Card>
    </Space>
  );
}
