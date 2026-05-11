import { Card } from 'antd';
import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';

type EChartPanelProps = {
  title: string;
  option: echarts.EChartsOption;
  height?: number;
};

export function EChartPanel({
  title,
  option,
  height = 320
}: EChartPanelProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }

    const chart = echarts.init(chartRef.current);
    chart.setOption(option);

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });

    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [option]);

  return (
    <Card title={title} bordered={false} className="panel-card">
      <div ref={chartRef} style={{ height }} />
    </Card>
  );
}
