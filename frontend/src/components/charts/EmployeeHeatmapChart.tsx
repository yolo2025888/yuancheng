import type { HeatmapPoint } from '../../types/models';
import { EChartPanel } from './EChartPanel';

type EmployeeHeatmapChartProps = {
  data: HeatmapPoint[];
};

export function EmployeeHeatmapChart({
  data
}: EmployeeHeatmapChartProps) {
  const employees = Array.from(new Set(data.map((item) => item.employee)));
  const slots = Array.from(new Set(data.map((item) => item.slot)));

  const formatTooltip = (params: { data?: unknown }) => {
    const tuple = (params.data ?? []) as [number, number, number, string];
    const [slotIndex, employeeIndex, riskLevel, status] = tuple;

    return `${employees[employeeIndex]}<br/>${slots[slotIndex]}<br/>${status} / 级别 ${riskLevel}`;
  };

  return (
    <EChartPanel
      title="员工 x 时间热力图"
      option={{
        tooltip: {
          position: 'top',
          formatter: (params) => formatTooltip(params as { data?: unknown })
        },
        grid: { left: 90, right: 24, top: 20, bottom: 40 },
        xAxis: {
          type: 'category',
          data: slots,
          splitArea: { show: true },
          axisLine: { lineStyle: { color: '#cbd5e1' } }
        },
        yAxis: {
          type: 'category',
          data: employees,
          splitArea: { show: true },
          axisLine: { lineStyle: { color: '#cbd5e1' } }
        },
        visualMap: {
          min: 0,
          max: 4,
          calculable: false,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          inRange: {
            color: ['#dbeafe', '#93c5fd', '#67e8f9', '#fb923c', '#ef4444']
          }
        },
        series: [
          {
            type: 'heatmap',
            data: data.map((item) => [
              slots.indexOf(item.slot),
              employees.indexOf(item.employee),
              item.riskLevel,
              item.status
            ]),
            label: { show: false },
            emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(15,23,42,0.22)' } }
          }
        ]
      }}
      height={340}
    />
  );
}
