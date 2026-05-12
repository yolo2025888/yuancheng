import { Alert, Card, Col, Input, List, Row, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { ChangeMetricsSummary } from '../components/ChangeMetricsSummary';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { fetchApiAssetObjectUrl, resolveApiAssetUrl } from '../services/apiClient';
import { adminApi } from '../services/adminApi';
import type { ScreenshotComparison, ScreenshotListItem } from '../types/models';

function formatActivityApp(value?: string | null) {
  return value ? `App ${value}` : null;
}

export function ScreenshotDetailPage() {
  const [searchParams] = useSearchParams();
  const employeeIdParam = searchParams.get('employeeId') ?? undefined;
  const dateParam = searchParams.get('date') ?? undefined;
  const screenshotIdParam = searchParams.get('screenshotId') ?? undefined;
  const [detail, setDetail] = useState<ScreenshotComparison | null>(null);
  const [imageAccessReason, setImageAccessReason] = useState('');
  const normalizedImageAccessReason = imageAccessReason.trim();

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
      <Card bordered={false} className="panel-card">
        <Space direction="vertical" size={8} className="full-width">
          <Typography.Title level={5}>Screenshot access reason</Typography.Title>
          <Input.TextArea
            value={imageAccessReason}
            onChange={(event) => setImageAccessReason(event.target.value)}
            placeholder="Case ID, audit review, or incident reason"
            maxLength={240}
            showCount
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </Space>
      </Card>
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
              accessReason={normalizedImageAccessReason}
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
              accessReason={normalizedImageAccessReason}
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
              <Typography.Title level={5}>Activity</Typography.Title>
              <ActivitySummary current={detail.currentActivity} previous={detail.previousActivity} />
            </Card>
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

type ActivitySummaryProps = {
  current?: ScreenshotListItem;
  previous?: ScreenshotListItem;
};

function ActivitySummary({ current, previous }: ActivitySummaryProps) {
  const rows = [
    { label: 'Current', item: current },
    { label: 'Previous', item: previous }
  ].filter((row): row is { label: string; item: ScreenshotListItem } => Boolean(row.item));

  if (rows.length === 0) {
    return <Typography.Text type="secondary">No activity metadata.</Typography.Text>;
  }

  return (
    <List
      dataSource={rows}
      renderItem={(row) => (
        <List.Item>
          <Space direction="vertical" size={4} className="full-width">
            <Space size={8} wrap>
              <Typography.Text strong>{row.label}</Typography.Text>
              <Typography.Text>{row.item.activityType || 'unknown'}</Typography.Text>
              {formatActivityApp(row.item.activeApp) ? (
                <Typography.Text type="secondary">{formatActivityApp(row.item.activeApp)}</Typography.Text>
              ) : null}
              {formatConfidence(row.item.activityConfidence) ? (
                <Typography.Text type="secondary">{formatConfidence(row.item.activityConfidence)}</Typography.Text>
              ) : null}
            </Space>
            {row.item.activitySummary ? (
              <Typography.Text type="secondary">{row.item.activitySummary}</Typography.Text>
            ) : null}
          </Space>
        </List.Item>
      )}
    />
  );
}

function formatConfidence(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }
  const normalized = value > 1 ? value : value * 100;
  return `Confidence ${normalized.toFixed(normalized >= 10 ? 0 : 1)}%`;
}

type ScreenshotPreviewProps = {
  imageUri?: string | null;
  thumbUri?: string | null;
  accessReason: string;
  placeholderText: string;
  toneClassName: string;
};

function ScreenshotPreview({
  imageUri,
  thumbUri,
  accessReason,
  placeholderText,
  toneClassName
}: ScreenshotPreviewProps) {
  const assetUri = imageUri ?? thumbUri;
  const shouldFetchWithAuth = Boolean(assetUri?.startsWith('/api/'));
  const canFetchWithAuth = !shouldFetchWithAuth || accessReason.length > 0;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const src = shouldFetchWithAuth ? objectUrl : resolveApiAssetUrl(assetUri);

  useEffect(() => {
    setBroken(false);
    setObjectUrl(null);

    if (!assetUri || !shouldFetchWithAuth || !canFetchWithAuth) {
      return undefined;
    }

    let isCurrent = true;
    let nextObjectUrl: string | null = null;

    fetchApiAssetObjectUrl(assetUri, accessReason)
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
  }, [accessReason, assetUri, canFetchWithAuth, shouldFetchWithAuth]);

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
