import { Button, Card, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, AuditLogRecord } from '../types/models';

export function AuditLogsPage() {
  const [rows, setRows] = useState<AuditLogRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const loadAuditLogs = useCallback(async () => {
    setLoading(true);
    const result = await adminApi.getAuditLogs();
    setRows(result.data);
    setApiStatus(result.apiStatus);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAuditLogs();
  }, [loadAuditLogs]);

  const summary = useMemo(() => {
    const reviewActions = rows.filter((item) => item.action.toLowerCase().includes('review')).length;
    const policyActions = rows.filter(
      (item) =>
        item.action.toLowerCase().includes('policy') ||
        item.target.toLowerCase().includes('policy') ||
        item.scope?.toLowerCase().includes('policy')
    ).length;
    const screenshotAccess = rows.filter((item) => item.action.toLowerCase().includes('screenshot')).length;

    return {
      reviewActions,
      policyActions,
      screenshotAccess
    };
  }, [rows]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Audit Logs"
        description="Review operator actions and safe session or risk metadata without exposing private capture content. The page uses the live audit endpoint when available and keeps a mock fallback otherwise."
        extra={
          <Space size={8} wrap>
            <Tag color="blue">{summary.reviewActions} review actions</Tag>
            <Tag color="purple">{summary.policyActions} policy changes</Tag>
            <Tag color="gold">{summary.screenshotAccess} screenshot access actions</Tag>
            <Button size="small" onClick={() => void loadAuditLogs()} loading={loading}>
              Reload
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Audit Log API" /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="small"
          dataSource={rows}
          loading={loading}
          pagination={false}
          scroll={{ x: 1260 }}
          columns={[
            {
              title: 'Operator',
              dataIndex: 'operator',
              width: 160
            },
            {
              title: 'Action',
              width: 180,
              render: (_value: unknown, record: AuditLogRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{record.action}</Typography.Text>
                  {record.scope ? <Tag>{record.scope}</Tag> : null}
                </Space>
              )
            },
            {
              title: 'Target / metadata',
              width: 320,
              render: (_value: unknown, record: AuditLogRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.target}</Typography.Text>
                  {record.metadataSummary ? (
                    <Typography.Text type="secondary">{record.metadataSummary}</Typography.Text>
                  ) : null}
                </Space>
              )
            },
            {
              title: 'Reason',
              dataIndex: 'reason',
              width: 320
            },
            {
              title: 'Result',
              width: 120,
              render: (_value: unknown, record: AuditLogRecord) => (
                <Tag color={auditResultColor(record.result)}>{record.result}</Tag>
              )
            },
            {
              title: 'Timestamp',
              dataIndex: 'timestamp',
              width: 180
            }
          ]}
        />
      </Card>
    </Space>
  );
}

function auditResultColor(result: string) {
  const normalized = result.trim().toLowerCase();
  if (normalized.includes('fail') || normalized.includes('deny')) {
    return 'red';
  }

  if (normalized.includes('pending') || normalized.includes('review')) {
    return 'gold';
  }

  if (normalized.includes('approved') || normalized.includes('applied') || normalized.includes('logged')) {
    return 'green';
  }

  return 'default';
}
