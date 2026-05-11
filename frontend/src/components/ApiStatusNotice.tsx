import { Alert, Space, Tag, Typography } from 'antd';

import type { ApiStatus, BackendHealth } from '../types/models';

type ApiStatusNoticeProps = {
  status: ApiStatus;
  title?: string;
};

export function ApiStatusNotice({
  status,
  title = 'API status'
}: ApiStatusNoticeProps) {
  const tone =
    status.state === 'connected'
      ? 'success'
      : status.state === 'fallback'
        ? 'warning'
        : 'error';

  return (
    <Alert
      type={tone}
      showIcon
      className="api-status-alert"
      message={
        <Space size={8} wrap>
          <Typography.Text strong>{title}</Typography.Text>
          <Tag color={status.source === 'live' ? 'green' : 'gold'}>{status.label}</Tag>
          {status.endpoint ? <Typography.Text type="secondary">{status.endpoint}</Typography.Text> : null}
        </Space>
      }
      description={status.detail}
    />
  );
}

type BackendHealthNoticeProps = {
  health: BackendHealth;
};

export function BackendHealthNotice({ health }: BackendHealthNoticeProps) {
  const description = health.ok
    ? `${health.appName ?? 'backend'} / ${health.environment ?? 'unknown'}`
    : health.apiStatus.detail;

  return (
    <Alert
      type={health.ok ? 'success' : 'warning'}
      showIcon
      className="api-status-alert"
      message={`Backend health: ${health.ok ? 'ok' : 'unavailable'}`}
      description={description}
    />
  );
}
