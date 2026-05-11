import { Card, Col, Row, Space, Table } from 'antd';
import { useEffect, useState } from 'react';

import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { GitHubTrendChart } from '../components/charts/GitHubTrendChart';
import { adminApi } from '../services/adminApi';
import type { GitHubRiskRecord } from '../types/models';

export function GitHubRiskPage() {
  const [rows, setRows] = useState<GitHubRiskRecord[]>([]);
  const [trend, setTrend] = useState<readonly (readonly [string, number])[]>([]);

  useEffect(() => {
    adminApi.getGitHubRisks().then((data) => {
      setRows(data.records);
      setTrend(data.trend);
    });
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="GitHub 风险"
        description="聚合 clone/fetch、review、敏感仓库访问等风险，便于与截图和时间线联动复核。"
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <GitHubTrendChart data={trend} />
        </Col>
        <Col xs={24} xl={15}>
          <Card bordered={false} className="panel-card">
            <Table
              rowKey="key"
              size="middle"
              dataSource={rows}
              pagination={false}
              columns={[
                { title: '员工', dataIndex: 'employee' },
                { title: '仓库', dataIndex: 'repository' },
                { title: '操作', dataIndex: 'action' },
                { title: '风险规则', dataIndex: 'riskRule' },
                {
                  title: '严重级别',
                  dataIndex: 'severity',
                  render: (value: string) => <StatusTag value={value} />
                },
                { title: '时间', dataIndex: 'timestamp' },
                { title: '关联信息', dataIndex: 'correlation' }
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
