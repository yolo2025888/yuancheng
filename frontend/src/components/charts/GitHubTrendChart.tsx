import { useI18n } from '../../i18n/I18nContext';
import { EChartPanel } from './EChartPanel';

type GitHubTrendChartProps = {
  data: readonly (readonly [string, number])[];
};

export function GitHubTrendChart({ data }: GitHubTrendChartProps) {
  const { t } = useI18n();

  return (
    <EChartPanel
      title={t('chart.githubTrend', 'GitHub Risk Trend')}
      option={{
        tooltip: { trigger: 'axis' },
        grid: { left: 24, right: 20, top: 24, bottom: 24, containLabel: true },
        xAxis: {
          type: 'category',
          data: data.map((item) => item[0]),
          boundaryGap: false
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: '#e2e8f0' } }
        },
        series: [
          {
            type: 'line',
            smooth: true,
            data: data.map((item) => item[1]),
            lineStyle: { color: '#dc2626', width: 3 },
            areaStyle: {
              color: 'rgba(220,38,38,0.12)'
            },
            itemStyle: { color: '#dc2626' }
          }
        ]
      }}
      height={280}
    />
  );
}
