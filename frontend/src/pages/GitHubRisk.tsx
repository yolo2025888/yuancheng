import { Button, Card, Empty, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { GitHubTrendChart } from '../components/charts/GitHubTrendChart';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, GitHubRiskRecord } from '../types/models';

export function GitHubRiskPage() {
  const [rows, setRows] = useState<GitHubRiskRecord[]>([]);
  const [trend, setTrend] = useState<readonly (readonly [string, number])[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const loadGitHubRisks = useCallback(async () => {
    setLoading(true);
    const result = await adminApi.getGitHubRisks();
    setRows(result.records);
    setTrend(result.trend);
    setApiStatus(result.apiStatus);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadGitHubRisks();
  }, [loadGitHubRisks]);

  const summary = useMemo(() => {
    const criticalCount = rows.filter((row) => row.severity === 'critical').length;
    const highCount = rows.filter((row) => row.severity === 'high').length;
    const repositoryCount = new Set(rows.map((row) => row.repository)).size;

    return {
      criticalCount,
      highCount,
      repositoryCount
    };
  }, [rows]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="GitHub Risk"
        description="The page prefers the live GitHub risk API and keeps the existing mock fallback so the review lane remains usable while backend endpoints settle."
        extra={
          <Space size={8} wrap>
            <Tag color="red">{summary.criticalCount} critical</Tag>
            <Tag color="orange">{summary.highCount} high</Tag>
            <Tag color="blue">{summary.repositoryCount} repositories</Tag>
            <Button size="small" onClick={() => void loadGitHubRisks()} loading={loading}>
              Reload
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="GitHub Risk API" /> : null}
      <Card bordered={false} className="panel-card">
        <GitHubTrendChart data={trend} />
      </Card>
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          loading={loading}
          pagination={false}
          scroll={{ x: 1320 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No GitHub risk events returned from the current source."
              />
            )
          }}
          columns={[
            {
              title: 'Employee',
              dataIndex: 'employee',
              width: 160
            },
            {
              title: 'Repository',
              dataIndex: 'repository',
              width: 220
            },
            {
              title: 'Action',
              dataIndex: 'action',
              width: 140,
              render: (value: string) => <Typography.Text strong>{value}</Typography.Text>
            },
            {
              title: 'Risk rule',
              dataIndex: 'riskRule',
              width: 260
            },
            {
              title: 'Severity',
              dataIndex: 'severity',
              width: 120,
              render: (value: string) => <StatusTag value={value} />
            },
            {
              title: 'Timestamp',
              dataIndex: 'timestamp',
              width: 200
            },
            {
              title: 'Correlation',
              width: 320,
              render: (_value: unknown, record: GitHubRiskRecord) => {
                const detailsText = summarizeRiskDetails(record.detailsJson);

                return (
                  <Space direction="vertical" size={2}>
                    <Typography.Text>{record.correlation}</Typography.Text>
                    {detailsText ? <Typography.Text type="secondary">{detailsText}</Typography.Text> : null}
                  </Space>
                );
              }
            }
          ]}
        />
      </Card>
    </Space>
  );
}

function summarizeRiskDetails(details?: Record<string, unknown>) {
  if (!details) {
    return '';
  }

  return Object.entries(details)
    .filter(([, value]) => value !== null && typeof value !== 'object')
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' / ');
}
