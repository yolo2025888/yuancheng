import { Alert, Button, Card, Col, List, Row, Space, Timeline, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { ChangeMetricsSummary } from '../components/ChangeMetricsSummary';
import { KpiCard } from '../components/KpiCard';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, KpiMetric, ScreenshotListItem, TimelineSegment } from '../types/models';

const timelineColors = {
  working: 'green',
  meeting: 'blue',
  idle: 'gray',
  risk: 'red'
} as const;

function formatActivityApp(value?: string | null) {
  return value ? `App ${value}` : null;
}

function formatConfidence(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }
  const normalized = value > 1 ? value : value * 100;
  return `Confidence ${normalized.toFixed(normalized >= 10 ? 0 : 1)}%`;
}

export function TimelinePage() {
  const [searchParams] = useSearchParams();
  const employeeIdParam = searchParams.get('employeeId') ?? undefined;
  const dateParam = searchParams.get('date') ?? undefined;
  const [kpis, setKpis] = useState<KpiMetric[]>([]);
  const [segments, setSegments] = useState<TimelineSegment[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotListItem[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [employeeLabel, setEmployeeLabel] = useState('Unknown employee');
  const [selectedDate, setSelectedDate] = useState('');

  useEffect(() => {
    adminApi
      .getTimeline({
        employeeId: employeeIdParam,
        date: dateParam
      })
      .then((data) => {
        setKpis(data.kpis);
        setSegments(data.segments);
        setScreenshots(data.screenshots);
        setApiStatus(data.apiStatus);
        setEmployeeId(data.employeeId);
        setEmployeeLabel(data.employeeLabel);
        setSelectedDate(data.selectedDate);
      });
  }, [dateParam, employeeIdParam]);

  const noChangeSegments = segments.filter((segment) => segment.noChangeStreakTriggered).length;

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Timeline"
        description="Timeline frames stay live when possible and fall back to compatible mock data when screenshot diff fields are still stabilizing."
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Timeline API" /> : null}
      <Row gutter={[16, 16]}>
        {kpis.map((metric) => (
          <Col xs={24} sm={12} xl={6} key={metric.key}>
            <KpiCard metric={metric} />
          </Col>
        ))}
      </Row>
      <Card bordered={false} className="panel-card">
        <Space direction="vertical" size={12} className="full-width">
          <div>
            <Typography.Title level={5}>
              {employeeLabel} / {selectedDate || 'n/a'}
            </Typography.Title>
            {noChangeSegments > 0 ? (
              <Alert
                showIcon
                type="warning"
                className="embedded-alert"
                message={`${noChangeSegments} timeline node(s) triggered a no-change streak risk`}
                description="These labels are driven by compatible event parsing and remain visible even while backend diff fields are being finalized."
              />
            ) : null}
          </div>
          <Timeline
            mode="left"
            items={segments.map((segment) => ({
              color: timelineColors[segment.status],
              label: segment.time,
              children: (
                <Space direction="vertical" size={6} className="full-width">
                  <Space size={8} wrap>
                    <Typography.Text strong>{segment.label}</Typography.Text>
                    {formatActivityApp(segment.activeApp) ? (
                      <Typography.Text type="secondary">{formatActivityApp(segment.activeApp)}</Typography.Text>
                    ) : null}
                    {formatConfidence(segment.activityConfidence) ? (
                      <Typography.Text type="secondary">{formatConfidence(segment.activityConfidence)}</Typography.Text>
                    ) : null}
                    {segment.noChangeStreakTriggered ? <StatusTag value="no_change_streak" /> : null}
                  </Space>
                  {segment.activitySummary ? (
                    <Typography.Text type="secondary">{segment.activitySummary}</Typography.Text>
                  ) : null}
                  <Typography.Text>{segment.detail}</Typography.Text>
                  <ChangeMetricsSummary
                    metrics={segment.changeMetrics}
                    noChangeStreakTriggered={segment.noChangeStreakTriggered}
                  />
                </Space>
              )
            }))}
          />
        </Space>
      </Card>
      <Card
        bordered={false}
        className="panel-card"
        title="Screenshots"
        extra={
          screenshots.length > 0 ? (
            <Typography.Text type="secondary">{screenshots.length} item(s)</Typography.Text>
          ) : null
        }
      >
        <List
          dataSource={screenshots}
          locale={{ emptyText: 'No screenshots returned by the current source.' }}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Link
                  key={item.id}
                  to={`/screenshot-detail?employeeId=${employeeId ?? ''}&date=${selectedDate}&screenshotId=${item.id}`}
                >
                  <Button type="link">Open detail</Button>
                </Link>
              ]}
            >
              <div className="timeline-shot-row">
                <Space size={8} wrap>
                  <Typography.Text strong>{item.capturedAt}</Typography.Text>
                  <Typography.Text>{item.activityType || 'unknown activity'}</Typography.Text>
                  {formatActivityApp(item.activeApp) ? (
                    <Typography.Text type="secondary">{formatActivityApp(item.activeApp)}</Typography.Text>
                  ) : null}
                  {formatConfidence(item.activityConfidence) ? (
                    <Typography.Text type="secondary">{formatConfidence(item.activityConfidence)}</Typography.Text>
                  ) : null}
                  {item.noChangeStreakTriggered ? <StatusTag value="no_change_streak" /> : null}
                </Space>
                {item.activitySummary ? (
                  <Typography.Text type="secondary">{item.activitySummary}</Typography.Text>
                ) : null}
                <Typography.Text type="secondary">
                  Keyboard {item.keyboardCount} / Mouse {item.mouseCount} / Linked risks {item.riskCount}
                </Typography.Text>
                <ChangeMetricsSummary
                  metrics={item.changeMetrics}
                  noChangeStreakTriggered={item.noChangeStreakTriggered}
                />
                <Typography.Text type="secondary">{item.riskSummary}</Typography.Text>
              </div>
            </List.Item>
          )}
        />
      </Card>
    </Space>
  );
}
