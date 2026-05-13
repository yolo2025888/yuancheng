import { Button, Card, Empty, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { GitHubTrendChart } from '../components/charts/GitHubTrendChart';
import { useI18n } from '../i18n/I18nContext';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, GitHubRiskRecord } from '../types/models';

export function GitHubRiskPage() {
  const { t, text } = useI18n();
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
        title={t('github.title', 'GitHub Risk')}
        description={t(
          'github.description',
          'The page reads live GitHub risk events from the backend.'
        )}
        extra={
          <Space size={8} wrap>
            <Tag color="red">{t('github.critical', '{{count}} critical', { count: summary.criticalCount })}</Tag>
            <Tag color="orange">{t('github.high', '{{count}} high', { count: summary.highCount })}</Tag>
            <Tag color="blue">{t('github.repositories', '{{count}} repositories', { count: summary.repositoryCount })}</Tag>
            <Button size="small" onClick={() => void loadGitHubRisks()} loading={loading}>
              {t('common.reload', 'Reload')}
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title={t('github.api', 'GitHub Risk API')} /> : null}
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
                description={t('github.empty', 'No GitHub risk events returned from the current source.')}
              />
            )
          }}
          columns={[
            {
              title: t('common.employee', 'Employee'),
              dataIndex: 'employee',
              width: 160
            },
            {
              title: t('github.repository', 'Repository'),
              dataIndex: 'repository',
              width: 220
            },
            {
              title: t('github.action', 'Action'),
              dataIndex: 'action',
              width: 140,
              render: (value: string) => <Typography.Text strong>{text(value)}</Typography.Text>
            },
            {
              title: t('github.riskRule', 'Risk rule'),
              dataIndex: 'riskRule',
              width: 260,
              render: (value: string) => text(value)
            },
            {
              title: t('events.severity', 'Severity'),
              dataIndex: 'severity',
              width: 120,
              render: (value: string) => <StatusTag value={value} />
            },
            {
              title: t('github.timestamp', 'Timestamp'),
              dataIndex: 'timestamp',
              width: 200
            },
            {
              title: t('github.correlation', 'Correlation'),
              width: 320,
              render: (_value: unknown, record: GitHubRiskRecord) => {
                const detailsText = summarizeRiskDetails(record.detailsJson);

                return (
                  <Space direction="vertical" size={2}>
                    <Typography.Text>{text(record.correlation)}</Typography.Text>
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
