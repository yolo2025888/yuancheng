import { Card, Space, Typography } from 'antd';

import type { KpiMetric } from '../types/models';

type KpiCardProps = {
  metric: KpiMetric;
};

export function KpiCard({ metric }: KpiCardProps) {
  const toneClass = metric.tone ? `kpi-delta-${metric.tone}` : '';

  return (
    <Card className="panel-card kpi-card" bordered={false}>
      <Space direction="vertical" size={8}>
        <Typography.Text className="muted-label">{metric.title}</Typography.Text>
        <Typography.Title level={2}>{metric.value}</Typography.Title>
        <Typography.Text className={`kpi-delta ${toneClass}`}>
          {metric.delta}
        </Typography.Text>
      </Space>
    </Card>
  );
}
