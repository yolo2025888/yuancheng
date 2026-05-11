import { Card, Col, Row, Space, Timeline, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { KpiCard } from '../components/KpiCard';
import { PageSection } from '../components/PageSection';
import { adminApi } from '../services/adminApi';
import type { KpiMetric, TimelineSegment } from '../types/models';

const timelineColors = {
  working: 'green',
  meeting: 'blue',
  idle: 'gray',
  risk: 'red'
} as const;

export function TimelinePage() {
  const [kpis, setKpis] = useState<KpiMetric[]>([]);
  const [segments, setSegments] = useState<TimelineSegment[]>([]);

  useEffect(() => {
    adminApi.getTimeline().then((data) => {
      setKpis(data.kpis);
      setSegments(data.segments);
    });
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="员工时间线"
        description="按单个员工单日复盘会话轨迹，先提供 KPI + 时间轴结构，后续可接入缩略图网格与聚合状态条。"
      />
      <Row gutter={[16, 16]}>
        {kpis.map((metric) => (
          <Col xs={24} sm={12} xl={6} key={metric.key}>
            <KpiCard metric={metric} />
          </Col>
        ))}
      </Row>
      <Card bordered={false} className="panel-card">
        <Typography.Title level={5}>王晨 / 2026-05-11</Typography.Title>
        <Timeline
          mode="left"
          items={segments.map((segment) => ({
            color: timelineColors[segment.status],
            label: segment.time,
            children: (
              <Space direction="vertical" size={2}>
                <Typography.Text strong>{segment.label}</Typography.Text>
                <Typography.Text>{segment.detail}</Typography.Text>
              </Space>
            )
          }))}
        />
      </Card>
    </Space>
  );
}
