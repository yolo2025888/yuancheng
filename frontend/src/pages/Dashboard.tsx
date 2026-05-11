import { Col, Row, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { EventList } from '../components/EventList';
import { KpiCard } from '../components/KpiCard';
import { PageSection } from '../components/PageSection';
import { EmployeeHeatmapChart } from '../components/charts/EmployeeHeatmapChart';
import { WorkStatusStackedChart } from '../components/charts/WorkStatusStackedChart';
import { adminApi } from '../services/adminApi';
import { apiPlaceholderNote } from '../services/apiClient';
import type { EventRecord, HeatmapPoint, KpiMetric, StatusBucket } from '../types/models';

export function DashboardPage() {
  const [kpis, setKpis] = useState<KpiMetric[]>([]);
  const [workStatus, setWorkStatus] = useState<StatusBucket[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapPoint[]>([]);
  const [eventItems, setEventItems] = useState<EventRecord[]>([]);

  useEffect(() => {
    adminApi.getDashboardData().then((data) => {
      setKpis(data.kpis);
      setWorkStatus(data.workStatusSeries);
      setHeatmap(data.employeeHeatmap);
      setEventItems(data.events);
    });
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="总览仪表盘"
        description="面向主管、安全和系统管理员的统一巡检入口，优先展示在线态势、风险分布和待处理事件。"
        extra={<Typography.Text className="hint-text">{apiPlaceholderNote}</Typography.Text>}
      />
      <Row gutter={[16, 16]}>
        {kpis.map((metric) => (
          <Col xs={24} sm={12} xl={6} key={metric.key}>
            <KpiCard metric={metric} />
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <WorkStatusStackedChart data={workStatus} />
        </Col>
        <Col xs={24} xl={9}>
          <EventList items={eventItems} />
        </Col>
      </Row>
      <EmployeeHeatmapChart data={heatmap} />
    </Space>
  );
}
