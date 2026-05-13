import { Alert, Card, Col, Empty, Input, List, Row, Space, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  ProtectedScreenshotImage,
  type ProtectedScreenshotImageState
} from '../components/ProtectedScreenshotImage';
import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { adminApi } from '../services/adminApi';
import type { ScreenshotAiAnalysis, ScreenshotComparison, ScreenshotListItem } from '../types/models';
import {
  formatActivityLabel,
  formatCapturedAt,
  formatChangeMetricsTags,
  formatConfidenceLabel,
  formatCounterLine,
  formatFileRetentionStatus,
  formatRiskSummary,
  formatRetentionDecision,
  formatSeverityLabel,
  formatWindowTitle,
  localizeScreenshotText,
  resolveHighestRiskSeverity
} from '../utils/screenshotPresentation';

export function ScreenshotDetailPage() {
  const [searchParams] = useSearchParams();
  const employeeId = searchParams.get('employeeId') || undefined;
  const date = searchParams.get('date') || undefined;
  const screenshotId = searchParams.get('screenshotId') || undefined;
  const [detail, setDetail] = useState<ScreenshotComparison | null>(null);
  const [accessReason, setAccessReason] = useState('');
  const [currentState, setCurrentState] = useState<ProtectedScreenshotImageState>('idle');
  const [previousState, setPreviousState] = useState<ProtectedScreenshotImageState>('idle');

  useEffect(() => {
    let cancelled = false;

    const loadDetail = async () => {
      const result = await adminApi.getScreenshotDetail({
        employeeId,
        date,
        screenshotId
      });
      if (!cancelled) {
        setDetail(result);
      }
    };

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [date, employeeId, screenshotId]);

  const current = detail?.currentActivity;
  const previous = detail?.previousActivity;
  const riskSeverity = useMemo(() => (current ? resolveHighestRiskSeverity(current) : 'none'), [current]);
  const aiNotice = useMemo(() => buildAiNotice(detail?.aiAnalysis), [detail?.aiAnalysis]);

  if (!detail) {
    return (
      <Space direction="vertical" size={20} className="page-stack">
        <PageSection title="截图详情" description="正在加载截图详情…" />
        <Card bordered={false} className="panel-card">
          <Empty description="正在加载截图详情…" />
        </Card>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="截图详情"
        description="查看当前截图、上一张截图、风险上下文和 AI 分析结果。"
      />

      {detail.apiStatus ? <ApiStatusNotice status={detail.apiStatus} title="截图详情接口" /> : null}

      <Card bordered={false} className="panel-card">
        <Space direction="vertical" size={12} className="full-width">
          <Typography.Text strong>截图查看原因</Typography.Text>
          <Input.TextArea
            value={accessReason}
            onChange={(event) => setAccessReason(event.target.value)}
            placeholder="填写工单号、审计编号或复核原因后加载原图"
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={240}
            showCount
          />
          <Typography.Text type="secondary">
            原图和缩略图接口都要求提供非空原因；未填写时页面仍会展示元数据和风险信息。
          </Typography.Text>
        </Space>
      </Card>

      {!accessReason.trim() ? (
        <Alert
          type="info"
          showIcon
          message="填写查看原因后可加载原图"
          description="现在可以先查看活动摘要、差异指标和关联风险。"
        />
      ) : null}

      {currentState === 'retention_deleted' ? (
        <Alert
          type="warning"
          showIcon
          message="当前截图文件已被保留策略删除"
          description="元数据、风险事件和 AI 结论仍然保留，可继续用于复核。"
        />
      ) : null}

      {previousState === 'retention_deleted' ? (
        <Alert
          type="warning"
          showIcon
          message="上一张截图文件已被保留策略删除"
          description="本页仍会显示上一张截图的时间与行为元数据，但无法再读取文件本身。"
        />
      ) : null}

      {current?.noChangeStreakTriggered ? (
        <Alert
          type="warning"
          showIcon
          message="该截图触发了无变化连续异常"
          description="请结合上一张截图和关联风险一起复核，不建议只看单帧。"
        />
      ) : null}

      {aiNotice ? (
        <Alert type={aiNotice.type} showIcon message={aiNotice.message} description={aiNotice.description} />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card
            bordered={false}
            className="panel-card screenshot-stage-card"
            title="当前截图"
            extra={current ? formatCapturedAt(current, current.capturedAtRaw ? 'full' : 'short') : detail.currentImageLabel}
          >
            <ProtectedScreenshotImage
              imageUri={detail.currentImageUri}
              thumbUri={detail.currentThumbUri}
              accessReason={accessReason}
              alt="当前截图"
              minHeight={560}
              onStateChange={setCurrentState}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Space direction="vertical" size={16} className="full-width">
            <Card
              bordered={false}
              className="panel-card screenshot-stage-card"
              title="上一张截图"
              extra={previous ? formatCapturedAt(previous, previous.capturedAtRaw ? 'full' : 'short') : '无'}
            >
              <ProtectedScreenshotImage
                imageUri={detail.previousImageUri}
                thumbUri={detail.previousThumbUri}
                accessReason={accessReason}
                alt="上一张截图"
                minHeight={280}
                onStateChange={setPreviousState}
              />
            </Card>

            <Card bordered={false} className="panel-card">
              <Space direction="vertical" size={10} className="full-width">
                <Typography.Text strong>截图概览</Typography.Text>
                <Tag color={severityColor(riskSeverity)}>{formatSeverityLabel(riskSeverity)}</Tag>
                {current?.retentionDecision ? <Tag>{`保留：${formatRetentionDecision(current.retentionDecision)}`}</Tag> : null}
                {current?.fileRetentionStatus ? <Tag>{`文件：${formatFileRetentionStatus(current.fileRetentionStatus)}`}</Tag> : null}
                {(current ? formatChangeMetricsTags(current.changeMetrics) : []).map((label) => (
                  <Tag key={label}>{label}</Tag>
                ))}
                {current ? (
                  <>
                    <Typography.Text>{formatActivityLabel(current.activityType)}</Typography.Text>
                    <Typography.Text type="secondary">{formatConfidenceLabel(current.activityConfidence)}</Typography.Text>
                    <Typography.Text type="secondary">{formatCounterLine(current)}</Typography.Text>
                    <Typography.Text type="secondary">窗口：{formatWindowTitle(current.windowTitle)}</Typography.Text>
                    <Typography.Text type="secondary">{formatRiskSummary(current)}</Typography.Text>
                  </>
                ) : null}
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card bordered={false} className="panel-card">
            <Typography.Title level={5}>活动与差异</Typography.Title>
            <Space direction="vertical" size={12} className="full-width">
              <ActivityBlock title="当前截图" item={current} />
              <ActivityBlock title="上一张截图" item={previous} />
              {detail.changeMetrics?.reason ? (
                <Alert
                  type="info"
                  showIcon
                  message="差异说明"
                  description={localizeScreenshotText(detail.changeMetrics.reason)}
                />
              ) : null}
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card bordered={false} className="panel-card">
            <Typography.Title level={5}>关联风险</Typography.Title>
            {detail.linkedRisks && detail.linkedRisks.length > 0 ? (
              <List
                dataSource={detail.linkedRisks}
                renderItem={(risk) => (
                  <List.Item>
                    <Space direction="vertical" size={4}>
                      <Space size={[8, 8]} wrap>
                        <Typography.Text strong>{localizeScreenshotText(risk.type)}</Typography.Text>
                        <Tag color={severityColor(risk.severity)}>{formatSeverityLabel(risk.severity)}</Tag>
                        <Tag>{risk.status}</Tag>
                      </Space>
                      <Typography.Text type="secondary">{localizeScreenshotText(risk.reason)}</Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="当前截图没有关联风险" />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card bordered={false} className="panel-card">
            <Typography.Title level={5}>AI 分析</Typography.Title>
            <AiAnalysisBlock analysis={detail.aiAnalysis} />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card bordered={false} className="panel-card">
            <Typography.Title level={5}>复核提示</Typography.Title>
            <List
              dataSource={buildReasoning(detail)}
              renderItem={(item) => (
                <List.Item>
                  <Typography.Text>{item}</Typography.Text>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function ActivityBlock({ title, item }: { title: string; item?: ScreenshotListItem }) {
  if (!item) {
    return <Alert type="info" showIcon message={`${title}没有可用元数据`} />;
  }

  return (
    <div className="detail-activity-block">
      <Typography.Text strong>{title}</Typography.Text>
      <Typography.Text>{formatActivityLabel(item.activityType)}</Typography.Text>
      <Typography.Text type="secondary">{item.activeApp ? `应用：${item.activeApp}` : '应用：未返回'}</Typography.Text>
      <Typography.Text type="secondary">{formatConfidenceLabel(item.activityConfidence)}</Typography.Text>
      <Typography.Text type="secondary">{formatCounterLine(item)}</Typography.Text>
      <Typography.Text type="secondary">窗口：{formatWindowTitle(item.windowTitle)}</Typography.Text>
      {item.activitySummary ? (
        <Typography.Text type="secondary">{localizeScreenshotText(item.activitySummary)}</Typography.Text>
      ) : null}
    </div>
  );
}

function AiAnalysisBlock({ analysis }: { analysis?: ScreenshotAiAnalysis }) {
  if (!analysis) {
    return <Typography.Text type="secondary">当前截图没有返回 AI 分析元数据。</Typography.Text>;
  }

  return (
    <Space direction="vertical" size={12} className="full-width">
      <Space size={[8, 8]} wrap>
        <Tag color={analysisStatusColor(analysis.status)}>{analysisStatusLabel(analysis.status)}</Tag>
        {analysis.provider ? <Tag>{`服务商：${analysis.provider}`}</Tag> : null}
        {analysis.model ? <Tag>{`模型：${analysis.model}`}</Tag> : null}
        {analysis.riskLevel ? <Tag>{`风险：${analysis.riskLevel}`}</Tag> : null}
        {analysis.confidence !== null && analysis.confidence !== undefined ? (
          <Tag>{formatConfidenceLabel(analysis.confidence)}</Tag>
        ) : null}
      </Space>
      {analysis.summary ? (
        <Typography.Text type="secondary">{localizeScreenshotText(analysis.summary)}</Typography.Text>
      ) : (
        <Typography.Text type="secondary">AI 未返回自然语言摘要。</Typography.Text>
      )}
      {analysis.error ? (
        <Alert type="error" showIcon message="AI 分析失败" description={localizeScreenshotText(analysis.error)} />
      ) : null}
      {analysis.findings.length > 0 ? (
        <List
          size="small"
          dataSource={analysis.findings}
          renderItem={(item) => (
            <List.Item>
              <Typography.Text>{localizeScreenshotText(item)}</Typography.Text>
            </List.Item>
          )}
        />
      ) : null}
    </Space>
  );
}

function buildAiNotice(analysis?: ScreenshotAiAnalysis) {
  if (!analysis) {
    return null;
  }

  if (analysis.status === 'failed') {
    return {
      type: 'error' as const,
      message: 'AI 分析失败',
      description: '请先参考页面中的活动、差异和关联风险元数据进行人工复核。'
    };
  }

  if (analysis.status === 'processing' || analysis.status === 'pending') {
    return {
      type: 'info' as const,
      message: 'AI 分析仍在处理中',
      description: '当前页面已经展示规则侧元数据，可以稍后刷新查看完整 AI 结果。'
    };
  }

  if (analysis.status === 'skipped') {
    return {
      type: 'warning' as const,
      message: 'AI 分析被跳过',
      description: '本次复核主要依赖活动、差异和关联风险，不包含模型侧结论。'
    };
  }

  return {
    type: 'success' as const,
    message: 'AI 分析已完成',
    description: '可以将 AI 摘要与规则证据对照查看，再决定是否继续升级处理。'
  };
}

function buildReasoning(detail: ScreenshotComparison) {
  const current = detail.currentActivity;
  const lines = [
    current ? `截图时间：${formatCapturedAt(current, current.capturedAtRaw ? 'full' : 'short')}` : null,
    current ? `活动类型：${formatActivityLabel(current.activityType)}` : null,
    current ? `活动置信度：${formatConfidenceLabel(current.activityConfidence)}` : null,
    current ? `聚合输入：${formatCounterLine(current)}` : null,
    current?.activitySummary ? `活动摘要：${localizeScreenshotText(current.activitySummary)}` : null,
    detail.changeMetrics?.reason ? `差异说明：${localizeScreenshotText(detail.changeMetrics.reason)}` : null,
    current?.retentionDecision ? `保留决策：${formatRetentionDecision(current.retentionDecision)}` : null,
    current?.fileRetentionStatus ? `文件状态：${formatFileRetentionStatus(current.fileRetentionStatus)}` : null
  ].filter((item): item is string => Boolean(item));

  return lines.length > 0 ? lines : ['当前截图只有最小元数据，没有更多复核提示。'];
}

function analysisStatusColor(status: string) {
  switch (status) {
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'processing':
      return 'blue';
    case 'skipped':
      return 'gold';
    default:
      return 'default';
  }
}

function analysisStatusLabel(status: string) {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'processing':
      return '处理中';
    case 'skipped':
      return '已跳过';
    case 'pending':
      return '待处理';
    default:
      return status;
  }
}

function severityColor(severity: string) {
  switch (severity) {
    case 'critical':
      return 'volcano';
    case 'high':
      return 'red';
    case 'medium':
      return 'orange';
    case 'low':
      return 'blue';
    default:
      return 'default';
  }
}
