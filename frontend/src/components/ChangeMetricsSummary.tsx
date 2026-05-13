import { Space, Tag, Typography } from 'antd';

import { useI18n } from '../i18n/I18nContext';
import type { ChangeMetrics } from '../types/models';

type ChangeMetricsSummaryProps = {
  metrics?: ChangeMetrics | null;
  noChangeStreakTriggered?: boolean;
  showReason?: boolean;
};

export function ChangeMetricsSummary({
  metrics,
  noChangeStreakTriggered = false,
  showReason = true
}: ChangeMetricsSummaryProps) {
  const { t, text } = useI18n();

  if (!metrics) {
    return null;
  }

  const similarityText =
    metrics.similarity === null || metrics.similarity === undefined
      ? null
      : metrics.similarity <= 1
        ? metrics.similarity.toFixed(3)
        : metrics.similarity.toFixed(2);

  return (
    <Space direction="vertical" size={6} className="change-summary">
      <Space size={[6, 6]} wrap>
        <Tag color={changeLevelColor(metrics.changeLevel)}>{text(formatLabel(metrics.changeLevel))}</Tag>
        <Tag color={metrics.effectiveChange ? 'green' : 'default'}>
          {metrics.effectiveChange === null
            ? t('change.effectiveUnknown', 'Effective change unknown')
            : metrics.effectiveChange
              ? t('change.effective', 'Effective change')
              : t('change.noEffective', 'No effective change')}
        </Tag>
        <Tag>
          {t('change.changedBlocks', 'Changed blocks {{value}}', {
            value: formatPercent(metrics.changedBlockRatio) ?? '--'
          })}
        </Tag>
        {similarityText ? <Tag>{t('change.similarity', 'Similarity {{value}}', { value: similarityText })}</Tag> : null}
        {metrics.distance !== null && metrics.distance !== undefined ? (
          <Tag>
            {t('change.distance', 'Distance {{value}}', {
              value: metrics.distance.toFixed(Number.isInteger(metrics.distance) ? 0 : 2)
            })}
          </Tag>
        ) : null}
        {noChangeStreakTriggered ? <Tag color="warning">{t('change.noChangeRisk', 'No-change streak risk')}</Tag> : null}
      </Space>
      {showReason && metrics.reason ? (
        <Typography.Text type="secondary">{text(metrics.reason)}</Typography.Text>
      ) : null}
    </Space>
  );
}

function changeLevelColor(value: string) {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes('high') || normalized.includes('major') || normalized.includes('critical')) {
    return 'error';
  }

  if (normalized.includes('medium') || normalized.includes('moderate')) {
    return 'warning';
  }

  if (normalized.includes('low') || normalized.includes('minor')) {
    return 'processing';
  }

  if (normalized.includes('none') || normalized.includes('minimal')) {
    return 'default';
  }

  return 'blue';
}

function formatPercent(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }

  const normalized = value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(normalized >= 10 ? 0 : 1)}%`;
}

function formatLabel(value: string) {
  if (!value) {
    return '未知变化等级';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'unknown') {
    return '未知';
  }
  if (normalized === 'none') {
    return '无变化';
  }

  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
