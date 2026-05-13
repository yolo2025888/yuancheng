import { Alert, Space, Tag, Typography } from 'antd';

import { useI18n } from '../i18n/I18nContext';
import type { ApiStatus, BackendHealth } from '../types/models';

type ApiStatusNoticeProps = {
  status: ApiStatus;
  title?: string;
};

export function ApiStatusNotice({
  status,
  title = 'API status'
}: ApiStatusNoticeProps) {
  const { t, text } = useI18n();
  const tone =
    status.state === 'connected'
      ? 'success'
      : status.state === 'fallback'
        ? 'warning'
        : 'error';
  const titleLabel = title === 'API status' ? t('api.status', 'API status') : title;

  return (
    <Alert
      type={tone}
      showIcon
      className="api-status-alert"
      message={
        <Space size={8} wrap>
          <Typography.Text strong>{titleLabel}</Typography.Text>
          <Tag color={status.source === 'live' ? 'green' : 'gold'}>{text(status.label)}</Tag>
          {status.endpoint ? <Typography.Text type="secondary">{status.endpoint}</Typography.Text> : null}
        </Space>
      }
      description={text(status.detail)}
    />
  );
}

type BackendHealthNoticeProps = {
  health: BackendHealth;
};

export function BackendHealthNotice({ health }: BackendHealthNoticeProps) {
  const { t, text } = useI18n();
  const description = health.ok
    ? `${health.appName ?? 'backend'} / ${health.environment ?? t('api.unknown', 'unknown')}`
    : text(health.apiStatus.detail);

  return (
    <Alert
      type={health.ok ? 'success' : 'warning'}
      showIcon
      className="api-status-alert"
      message={t('api.backendHealth', 'Backend health: {{status}}', {
        status: health.ok ? t('api.backendOk', 'ok') : t('api.backendUnavailable', 'unavailable')
      })}
      description={description}
    />
  );
}
