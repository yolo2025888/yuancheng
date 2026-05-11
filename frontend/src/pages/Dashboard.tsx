import { Col, Row, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { BackendHealthNotice } from '../components/ApiStatusNotice';
import { EventList } from '../components/EventList';
import { KpiCard } from '../components/KpiCard';
import { PageSection } from '../components/PageSection';
import { EmployeeHeatmapChart } from '../components/charts/EmployeeHeatmapChart';
import { WorkStatusStackedChart } from '../components/charts/WorkStatusStackedChart';
import { adminApi } from '../services/adminApi';
import type {
  ApiStatus,
  BackendHealth,
  EventRecord,
  HeatmapPoint,
  KpiMetric,
  StatusBucket
} from '../types/models';

export function DashboardPage() {
  const [kpis, setKpis] = useState<KpiMetric[]>([]);
  const [workStatus, setWorkStatus] = useState<StatusBucket[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapPoint[]>([]);
  const [eventItems, setEventItems] = useState<EventRecord[]>([]);
  const [eventApiStatus, setEventApiStatus] = useState<ApiStatus | null>(null);
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);

  useEffect(() => {
    adminApi.getDashboardData().then((data) => {
      setKpis(data.kpis);
      setWorkStatus(data.workStatusSeries);
      setHeatmap(data.employeeHeatmap);
      setEventItems(data.events);
      setEventApiStatus(data.eventApiStatus);
      setBackendHealth(data.backendHealth);
    });
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Dashboard"
        description="MVP-1 overview with real backend health and event ingestion status."
        extra={
          eventApiStatus ? (
            <Typography.Text className="hint-text">{eventApiStatus.label}</Typography.Text>
          ) : null
        }
      />
      {backendHealth ? <BackendHealthNotice health={backendHealth} /> : null}
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
