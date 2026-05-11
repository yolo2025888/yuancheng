import { Tag } from 'antd';

type StatusTagProps = {
  value: string;
};

const statusColorMap: Record<string, string> = {
  在线: 'green',
  锁屏: 'gold',
  离线: 'default',
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
  critical: 'volcano'
};

const fallbackLabels: Record<string, string> = {
  normal: '正常',
  watch: '关注',
  high: '高风险',
  online: '在线',
  offline: '离线',
  warning: '告警',
  new: '未处理',
  reviewing: '复核中',
  confirmed: '已确认',
  ignored: '已忽略',
  closed: '已关闭',
  low: '低',
  medium: '中',
  critical: '严重'
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
