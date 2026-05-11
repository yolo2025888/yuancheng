import { Tag } from 'antd';

type StatusTagProps = {
  value: string;
};

const statusColorMap: Record<string, string> = {
  normal: 'green',
  watch: 'orange',
  high: 'red',
  online: 'green',
  offline: 'default',
  warning: 'orange',
  locked: 'gold',
  new: 'blue',
  reviewing: 'gold',
  reviewed: 'cyan',
  confirmed: 'red',
  ignored: 'default',
  closed: 'green',
  active: 'green',
  inactive: 'default',
  draft: 'purple',
  low: 'blue',
  medium: 'orange',
  highrisk: 'red',
  critical: 'volcano',
  no_change_streak: 'warning'
};

const fallbackLabels: Record<string, string> = {
  normal: 'Normal',
  watch: 'Watch',
  high: 'High risk',
  online: 'Online',
  offline: 'Offline',
  warning: 'Warning',
  locked: 'Locked',
  new: 'New',
  reviewing: 'Reviewing',
  reviewed: 'Reviewed',
  confirmed: 'Confirmed',
  ignored: 'Ignored',
  closed: 'Closed',
  active: 'Active',
  inactive: 'Inactive',
  draft: 'Draft',
  low: 'Low',
  medium: 'Medium',
  critical: 'Critical',
  no_change_streak: 'No-change streak'
};

export function StatusTag({ value }: StatusTagProps) {
  const normalized = value === 'high' ? 'high' : value.trim().toLowerCase();
  const colorKey = value === 'high' ? 'highrisk' : normalized;

  return (
    <Tag color={statusColorMap[colorKey] ?? 'default'}>
      {fallbackLabels[normalized] ?? formatStatusLabel(value)}
    </Tag>
  );
}

function formatStatusLabel(value: string) {
  return value
    .trim()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
