import { Space, Tag, Typography } from 'antd';

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
        <Tag color={changeLevelColor(metrics.changeLevel)}>{formatLabel(metrics.changeLevel)}</Tag>
        <Tag color={metrics.effectiveChange ? 'green' : 'default'}>
          {metrics.effectiveChange === null
            ? 'Effective change unknown'
            : metrics.effectiveChange
              ? 'Effective change'
              : 'No effective change'}
        </Tag>
        <Tag>
          Changed blocks {formatPercent(metrics.changedBlockRatio) ?? '--'}
        </Tag>
        {similarityText ? <Tag>Similarity {similarityText}</Tag> : null}
        {metrics.distance !== null && metrics.distance !== undefined ? (
          <Tag>Distance {metrics.distance.toFixed(Number.isInteger(metrics.distance) ? 0 : 2)}</Tag>
        ) : null}
        {noChangeStreakTriggered ? <Tag color="warning">No-change streak risk</Tag> : null}
      </Space>
      {showReason && metrics.reason ? (
        <Typography.Text type="secondary">{metrics.reason}</Typography.Text>
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
    return 'Unknown change level';
  }

  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
