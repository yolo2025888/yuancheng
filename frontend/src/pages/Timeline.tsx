import { Button, Card, Col, List, Row, Space, Timeline, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { KpiCard } from '../components/KpiCard';
import { PageSection } from '../components/PageSection';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, KpiMetric, ScreenshotListItem, TimelineSegment } from '../types/models';

const timelineColors = {
  working: 'green',
  meeting: 'blue',
  idle: 'gray',
  risk: 'red'
} as const;

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

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Timeline"
        description="Prefer live employee timeline data; if the backend cannot supply it, the mock timeline remains visible."
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
        <Typography.Title level={5}>
          {employeeLabel} / {selectedDate || 'n/a'}
        </Typography.Title>
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
                <Typography.Text strong>{item.capturedAt}</Typography.Text>
                <Typography.Text>{item.activityType || 'unknown activity'}</Typography.Text>
                <Typography.Text type="secondary">
                  {item.changeLevel} / keyboard {item.keyboardCount} / mouse {item.mouseCount}
                </Typography.Text>
                <Typography.Text type="secondary">{item.riskSummary}</Typography.Text>
              </div>
            </List.Item>
          )}
        />
      </Card>
    </Space>
  );
}
