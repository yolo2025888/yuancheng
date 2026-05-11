import { Card, Col, List, Row, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { resolveApiAssetUrl } from '../services/apiClient';
import { adminApi } from '../services/adminApi';
import type { ScreenshotComparison } from '../types/models';

export function ScreenshotDetailPage() {
  const [searchParams] = useSearchParams();
  const employeeIdParam = searchParams.get('employeeId') ?? undefined;
  const dateParam = searchParams.get('date') ?? undefined;
  const screenshotIdParam = searchParams.get('screenshotId') ?? undefined;
  const [detail, setDetail] = useState<ScreenshotComparison | null>(null);

  useEffect(() => {
    adminApi
      .getScreenshotDetail({
        employeeId: employeeIdParam,
        date: dateParam,
        screenshotId: screenshotIdParam
      })
      .then(setDetail);
  }, [dateParam, employeeIdParam, screenshotIdParam]);

  if (!detail) {
    return null;
  }

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Screenshot Detail"
        description="Display live screenshot URIs when the backend can provide them, otherwise keep clear placeholders."
      />
      {detail.apiStatus ? <ApiStatusNotice status={detail.apiStatus} title="Screenshot source" /> : null}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card bordered={false} className="panel-card screenshot-card">
            <Typography.Text className="muted-label">{detail.previousImageLabel}</Typography.Text>
            <ScreenshotPreview
              imageUri={detail.previousImageUri}
              thumbUri={detail.previousThumbUri}
              placeholderText="Previous screenshot placeholder"
              toneClassName="screenshot-previous"
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card bordered={false} className="panel-card screenshot-card">
            <Typography.Text className="muted-label">{detail.currentImageLabel}</Typography.Text>
            <ScreenshotPreview
              imageUri={detail.currentImageUri}
              thumbUri={detail.currentThumbUri}
              placeholderText="Current screenshot placeholder"
              toneClassName="screenshot-current"
            />
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
            <Typography.Title level={5}>Reasoning</Typography.Title>
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

type ScreenshotPreviewProps = {
  imageUri?: string | null;
  thumbUri?: string | null;
  placeholderText: string;
  toneClassName: string;
};

function ScreenshotPreview({
  imageUri,
  thumbUri,
  placeholderText,
  toneClassName
}: ScreenshotPreviewProps) {
  const [broken, setBroken] = useState(false);
  const src = resolveApiAssetUrl(imageUri ?? thumbUri);

  if (!src || broken) {
    return (
      <div className={`screenshot-placeholder ${toneClassName}`}>
        <span>{placeholderText}</span>
      </div>
    );
  }

  return (
    <div className={`screenshot-image-shell ${toneClassName}`}>
      <img
        src={src}
        alt={placeholderText}
        className="screenshot-image"
        onError={() => setBroken(true)}
      />
    </div>
  );
}
