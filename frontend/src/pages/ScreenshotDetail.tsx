import { Alert, Card, Col, List, Row, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { ChangeMetricsSummary } from '../components/ChangeMetricsSummary';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { fetchApiAssetObjectUrl, resolveApiAssetUrl } from '../services/apiClient';
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
        description="Screenshot diff fields are rendered defensively so live and mock sources keep working while backend payload names settle."
      />
      {detail.apiStatus ? <ApiStatusNotice status={detail.apiStatus} title="Screenshot source" /> : null}
      {detail.noChangeStreakTriggered ? (
        <Alert
          showIcon
          type="warning"
          message="No-change streak risk linked to this screenshot"
          description="Review this frame against aggregate keyboard and mouse counts plus the surrounding timeline. No raw keystrokes or private content are shown."
        />
      ) : null}
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
          <Space direction="vertical" size={16} className="full-width">
            <Card bordered={false} className="panel-card">
              <Typography.Title level={5}>Diff summary</Typography.Title>
              <ChangeMetricsSummary
                metrics={detail.changeMetrics}
                noChangeStreakTriggered={detail.noChangeStreakTriggered}
              />
            </Card>
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
          </Space>
        </Col>
        <Col xs={24} xl={10}>
          <Space direction="vertical" size={16} className="full-width">
            <Card bordered={false} className="panel-card">
              <Typography.Title level={5}>Linked risks</Typography.Title>
              {detail.linkedRisks && detail.linkedRisks.length > 0 ? (
                <List
                  dataSource={detail.linkedRisks}
                  renderItem={(item) => (
                    <List.Item>
                      <Space direction="vertical" size={4}>
                        <Space size={8} wrap>
                          <Typography.Text strong>{item.type}</Typography.Text>
                          <StatusTag value={item.severity} />
                          <StatusTag value={item.status} />
                        </Space>
                        <Typography.Text type="secondary">{item.reason}</Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Typography.Text type="secondary">No linked risk events.</Typography.Text>
              )}
            </Card>
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
          </Space>
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
  const assetUri = imageUri ?? thumbUri;
  const shouldFetchWithAuth = Boolean(assetUri?.startsWith('/api/'));
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const src = shouldFetchWithAuth ? objectUrl : resolveApiAssetUrl(assetUri);

  useEffect(() => {
    setBroken(false);
    setObjectUrl(null);

    if (!assetUri || !shouldFetchWithAuth) {
      return undefined;
    }

    let isCurrent = true;
    let nextObjectUrl: string | null = null;

    fetchApiAssetObjectUrl(assetUri)
      .then((url) => {
        if (!isCurrent) {
          URL.revokeObjectURL(url);
          return;
        }

        nextObjectUrl = url;
        setObjectUrl(url);
      })
      .catch(() => {
        if (isCurrent) {
          setBroken(true);
        }
      });

    return () => {
      isCurrent = false;
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [assetUri, shouldFetchWithAuth]);

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
