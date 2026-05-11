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
  new: 'blue',
  reviewing: 'gold',
  confirmed: 'red',
  ignored: 'default',
  closed: 'green',
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
  new: 'New',
  reviewing: 'Reviewing',
  confirmed: 'Confirmed',
  ignored: 'Ignored',
  closed: 'Closed',
  low: 'Low',
  medium: 'Medium',
  critical: 'Critical',
  no_change_streak: 'No-change streak'
};

export function StatusTag({ value }: StatusTagProps) {
  const normalized = value === 'high' ? 'high' : value;
  const colorKey = value === 'high' ? 'highrisk' : normalized;

  return (
    <Tag color={statusColorMap[colorKey] ?? 'default'}>
      {fallbackLabels[normalized] ?? value}
    </Tag>
  );
}
