import { Card, Col, List, Row, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { PageSection } from '../components/PageSection';
import { adminApi } from '../services/adminApi';
import type { ScreenshotComparison } from '../types/models';

export function ScreenshotDetailPage() {
  const [detail, setDetail] = useState<ScreenshotComparison | null>(null);

  useEffect(() => {
    adminApi.getScreenshotDetail().then(setDetail);
  }, []);

  if (!detail) {
    return null;
  }

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="截图详情"
        description="展示前后截图、差分指标和判定依据，用于解释连续无变化或截图异常的证据链。"
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card bordered={false} className="panel-card screenshot-card">
            <Typography.Text className="muted-label">
              {detail.previousImageLabel}
            </Typography.Text>
            <div className="screenshot-placeholder screenshot-previous">
              <span>上一张截图占位</span>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card bordered={false} className="panel-card screenshot-card">
            <Typography.Text className="muted-label">
              {detail.currentImageLabel}
            </Typography.Text>
            <div className="screenshot-placeholder screenshot-current">
              <span>当前截图占位</span>
            </div>
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card bordered={false} className="panel-card">
            <List
              dataSource={detail.metrics}
              renderItem={(metric) => (
                <List.Item>
                  <div className="metric-row">
                    <div>
                      <Typography.Text strong>{metric.label}</Typography.Text>
                      <Typography.Paragraph>{metric.hint}</Typography.Paragraph>
                    </div>
                    <Typography.Title level={4}>{metric.value}</Typography.Title>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card bordered={false} className="panel-card">
            <Typography.Title level={5}>判定依据</Typography.Title>
            <List
              dataSource={detail.reasoning}
              renderItem={(item) => (
                <List.Item>
                  <Typography.Text>{item}</Typography.Text>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
