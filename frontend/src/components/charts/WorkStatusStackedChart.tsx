import type { StatusBucket } from '../../types/models';
import { EChartPanel } from './EChartPanel';

type WorkStatusStackedChartProps = {
  data: StatusBucket[];
};

const statusColorMap = {
  coding: '#0f766e',
  review: '#2563eb',
  meeting: '#f59e0b',
  documentation: '#7c3aed',
  communication: '#0891b2',
  idle: '#f97316',
  locked: '#64748b'
};

export function WorkStatusStackedChart({
  data
}: WorkStatusStackedChartProps) {
  return (
    <EChartPanel
      title="工作状态堆叠图"
      option={{
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { top: 0, itemWidth: 12, textStyle: { color: '#334155' } },
        grid: { left: 16, right: 16, bottom: 8, top: 52, containLabel: true },
        xAxis: {
          type: 'category',
          data: data.map((item) => item.slot),
          axisLine: { lineStyle: { color: '#cbd5e1' } }
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: '#e2e8f0' } }
        },
        series: [
          ['coding', '编码'],
          ['review', '评审'],
          ['meeting', '会议'],
          ['documentation', '文档'],
          ['communication', '沟通'],
          ['idle', '静止'],
          ['locked', '锁屏']
        ].map(([key, label]) => ({
          name: label,
          type: 'bar',
          stack: 'status',
          barMaxWidth: 28,
          emphasis: { focus: 'series' },
          itemStyle: { color: statusColorMap[key as keyof typeof statusColorMap] },
          data: data.map((item) => item[key as keyof StatusBucket] as number)
        }))
      }}
      height={340}
    />
  );
}
