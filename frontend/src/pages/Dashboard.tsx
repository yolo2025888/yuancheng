import { Card, Col, Row, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice, BackendHealthNotice } from '../components/ApiStatusNotice';
import { EventList } from '../components/EventList';
import { KpiCard } from '../components/KpiCard';
import { PageSection } from '../components/PageSection';
import { EmployeeHeatmapChart } from '../components/charts/EmployeeHeatmapChart';
import { WorkStatusStackedChart } from '../components/charts/WorkStatusStackedChart';
import { adminApi } from '../services/adminApi';
import type {
  AccessMatrixRecord,
  ApiStatus,
  BackendHealth,
  EventRecord,
  HeatmapPoint,
  KpiMetric,
  ReviewQueueRecord,
  RiskScoreRecord,
  StatusBucket
} from '../types/models';

export function DashboardPage() {
  const [kpis, setKpis] = useState<KpiMetric[]>([]);
  const [workStatus, setWorkStatus] = useState<StatusBucket[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapPoint[]>([]);
  const [riskScores, setRiskScores] = useState<RiskScoreRecord[]>([]);
  const [accessMatrix, setAccessMatrix] = useState<AccessMatrixRecord[]>([]);
  const [eventItems, setEventItems] = useState<EventRecord[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueRecord[]>([]);
  const [dashboardApiStatus, setDashboardApiStatus] = useState<ApiStatus | null>(null);
  const [riskApiStatus, setRiskApiStatus] = useState<ApiStatus | null>(null);
  const [accessApiStatus, setAccessApiStatus] = useState<ApiStatus | null>(null);
  const [eventApiStatus, setEventApiStatus] = useState<ApiStatus | null>(null);
  const [reviewQueueApiStatus, setReviewQueueApiStatus] = useState<ApiStatus | null>(null);
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);

  useEffect(() => {
    adminApi.getDashboardData().then((data) => {
      setKpis(data.kpis);
      setWorkStatus(data.workStatusSeries);
      setHeatmap(data.employeeHeatmap);
      setRiskScores(data.riskScores);
      setAccessMatrix(data.accessMatrix);
      setDashboardApiStatus(data.dashboardApiStatus);
      setRiskApiStatus(data.riskApiStatus);
      setAccessApiStatus(data.accessApiStatus);
      setEventItems(data.events);
      setEventApiStatus(data.eventApiStatus);
      setReviewQueue(data.reviewQueue);
      setReviewQueueApiStatus(data.reviewQueueApiStatus);
      setBackendHealth(data.backendHealth);
    });
  }, []);

  const summary = useMemo(() => {
    const highRiskEmployees = new Set(
      riskScores.filter((item) => item.riskLevel >= 3).map((item) => item.employee)
    );
    const modules = new Set(accessMatrix.flatMap((item) => item.modules));
    const reviewQueueCritical = reviewQueue.filter(
      (item) => item.severity === 'critical' || item.severity === 'high'
    );

    return {
      highRiskEmployees: highRiskEmployees.size,
      modules: modules.size,
      reviewQueueCritical: reviewQueueCritical.length
    };
  }, [accessMatrix, reviewQueue, riskScores]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Dashboard"
        description="Operational overview using dashboard summary, risk scoring, access-role, and event feeds with frontend fallback where APIs are still settling."
        extra={
          <Space size={[8, 8]} wrap>
            {dashboardApiStatus ? (
              <Tag color={dashboardApiStatus.source === 'live' ? 'green' : 'gold'}>
                Summary {dashboardApiStatus.label}
              </Tag>
            ) : null}
            {riskApiStatus ? (
              <Tag color={riskApiStatus.source === 'live' ? 'green' : 'gold'}>
                Risk {riskApiStatus.label}
              </Tag>
            ) : null}
            {accessApiStatus ? (
              <Tag color={accessApiStatus.source === 'live' ? 'green' : 'gold'}>
                Access {accessApiStatus.label}
              </Tag>
            ) : null}
            {eventApiStatus ? (
              <Tag color={eventApiStatus.source === 'live' ? 'green' : 'gold'}>
                Events {eventApiStatus.label}
              </Tag>
            ) : null}
            {reviewQueueApiStatus ? (
              <Tag color={reviewQueueApiStatus.source === 'live' ? 'green' : 'gold'}>
                Queue {reviewQueueApiStatus.label}
              </Tag>
            ) : null}
            <Tag color={summary.reviewQueueCritical > 0 ? 'volcano' : 'green'}>
              {reviewQueue.length} review items
            </Tag>
            <Tag color={summary.highRiskEmployees > 0 ? 'orange' : 'green'}>
              {summary.highRiskEmployees} employees on watch
            </Tag>
            <Tag color="blue">{summary.modules} access modules</Tag>
          </Space>
        }
      />
      {backendHealth ? <BackendHealthNotice health={backendHealth} /> : null}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          {dashboardApiStatus ? <ApiStatusNotice status={dashboardApiStatus} title="Dashboard summary API" /> : null}
        </Col>
        <Col xs={24} xl={8}>
          {riskApiStatus ? <ApiStatusNotice status={riskApiStatus} title="Risk score API" /> : null}
        </Col>
        <Col xs={24} xl={8}>
          {accessApiStatus ? <ApiStatusNotice status={accessApiStatus} title="Access matrix API" /> : null}
        </Col>
      </Row>
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
          <EventList
            items={eventItems}
            reviewQueue={reviewQueue}
            reviewQueueApiStatus={reviewQueueApiStatus}
          />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <EmployeeHeatmapChart data={heatmap} />
        </Col>
        <Col xs={24} xl={9}>
          <Card
            title="Access role snapshot"
            bordered={false}
            className="panel-card"
            extra={<Typography.Text type="secondary">{accessMatrix.length} roles</Typography.Text>}
          >
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={accessMatrix.slice(0, 5)}
              scroll={{ x: 720 }}
              columns={[
                {
                  title: 'Role',
                  width: 160,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>{record.role}</Typography.Text>
                      <Typography.Text type="secondary">{record.employeeCount} employees</Typography.Text>
                    </Space>
                  )
                },
                {
                  title: 'Modules / Actions',
                  width: 320,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space direction="vertical" size={6}>
                      <Space size={[4, 4]} wrap>
                        {record.modules.slice(0, 4).map((module) => (
                          <Tag key={module} color="geekblue">
                            {module}
                          </Tag>
                        ))}
                      </Space>
                      <Typography.Text type="secondary">
                        {record.actions.slice(0, 3).join(', ') || 'No explicit actions'}
                      </Typography.Text>
                    </Space>
                  )
                },
                {
                  title: 'Scope',
                  width: 220,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text type="secondary">
                        {record.positions.slice(0, 2).join(', ') || 'No positions mapped'}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {record.policyNames.slice(0, 2).join(', ') || 'No policy binding'}
                      </Typography.Text>
                    </Space>
                  )
                }
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
