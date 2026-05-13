import { Alert, Button, Card, Col, Empty, Input, List, Pagination, Row, Select, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, EmployeeRecord, ScreenshotListItem } from '../types/models';
import {
  formatActivityLabel,
  formatCapturedAt,
  formatChangeMetricsTags,
  formatConfidenceLabel,
  formatCounterLine,
  formatEmployeeLabel,
  formatFileRetentionStatus,
  formatRiskSummary,
  formatRetentionDecision,
  formatWindowTitle,
  isAbnormalScreenshot,
  localizeScreenshotText
} from '../utils/screenshotPresentation';

const ANOMALY_PAGE_SIZE = 6;
const TIMELINE_PAGE_SIZE = 12;

export function TimelinePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotListItem[]>([]);
  const [anomalies, setAnomalies] = useState<ScreenshotListItem[]>([]);
  const [anomalyTotal, setAnomalyTotal] = useState(0);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [department, setDepartment] = useState(searchParams.get('department') ?? 'all');
  const [employeeId, setEmployeeId] = useState<string | undefined>(searchParams.get('employeeId') ?? undefined);
  const [selectedDate, setSelectedDate] = useState(searchParams.get('date') ?? new Date().toISOString().slice(0, 10));
  const [timelinePage, setTimelinePage] = useState(Number(searchParams.get('page') ?? 1));
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [anomalyPage, setAnomalyPage] = useState(1);

  const loadEmployees = useCallback(async () => {
    const result = await adminApi.getEmployees();
    const activeEmployees = result.data.filter((item) => item.status !== 'deleted');
    setEmployees(activeEmployees);
    if (!employeeId && activeEmployees.length > 0) {
      setEmployeeId(activeEmployees[0].key);
    }
  }, [employeeId]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  const departmentOptions = useMemo(() => {
    const values = Array.from(
      new Set(
        employees
          .map((item) => item.department)
          .filter((item) => item && item !== 'Unassigned')
      )
    ).sort((left, right) => left.localeCompare(right, 'zh-CN'));
    return [{ value: 'all', label: '全部部门' }, ...values.map((item) => ({ value: item, label: item }))];
  }, [employees]);

  const employeeOptions = useMemo(() => {
    const source =
      department === 'all' ? employees : employees.filter((item) => item.department === department);
    return source.map((item) => ({
      value: item.key,
      label: formatEmployeeLabel(item)
    }));
  }, [department, employees]);

  useEffect(() => {
    if (!employeeId) {
      return;
    }
    if (!employeeOptions.some((item) => item.value === employeeId)) {
      setEmployeeId(employeeOptions[0]?.value);
    }
  }, [employeeId, employeeOptions]);

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    const [timelineResult, anomalyResult] = await Promise.all([
      adminApi.getTimeline({
        employeeId,
        department: department === 'all' ? undefined : department,
        date: selectedDate,
        page: timelinePage,
        pageSize: TIMELINE_PAGE_SIZE
      }),
      adminApi.getTimeline({
        employeeId,
        department: department === 'all' ? undefined : department,
        date: selectedDate,
        abnormalOnly: true,
        page: anomalyPage,
        pageSize: ANOMALY_PAGE_SIZE
      })
    ]);
    setScreenshots(timelineResult.screenshots);
    setTimelineTotal(timelineResult.total);
    setAnomalies(anomalyResult.screenshots);
    setAnomalyTotal(anomalyResult.total);
    setApiStatus(normalizeTimelineStatus(timelineResult.apiStatus, timelineResult.total, selectedDate));
    setLoading(false);
  }, [anomalyPage, department, employeeId, selectedDate, timelinePage]);

  useEffect(() => {
    if (!employeeId && department === 'all') {
      return;
    }
    void loadTimeline();
  }, [employeeId, department, selectedDate, timelinePage, anomalyPage, loadTimeline]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (department !== 'all') {
      params.set('department', department);
    }
    if (employeeId) {
      params.set('employeeId', employeeId);
    }
    params.set('date', selectedDate);
    params.set('page', String(timelinePage));
    setSearchParams(params, { replace: true });
  }, [department, employeeId, selectedDate, setSearchParams, timelinePage]);

  const currentEmployee = useMemo(
    () => employees.find((item) => item.key === employeeId),
    [employeeId, employees]
  );

  const summary = useMemo(() => {
    const effective = screenshots.filter((item) => item.changeMetrics.effectiveChange === true).length;
    const inputCount = screenshots.reduce((sum, item) => sum + item.keyboardCount + item.mouseCount, 0);
    return {
      visible: screenshots.length,
      total: timelineTotal,
      anomalies: anomalyTotal,
      effective,
      inputCount
    };
  }, [anomalyTotal, screenshots, timelineTotal]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="时间线"
        description="按部门、员工和日期查看截图时间线。左侧优先展示异常，右侧保留完整倒序记录。"
        extra={
          <Button size="small" onClick={() => void loadTimeline()}>
            刷新
          </Button>
        }
      />

      {apiStatus ? <ApiStatusNotice status={apiStatus} title="时间线接口" /> : null}

      <Card bordered={false} className="panel-card">
        <div className="gallery-toolbar">
          <Select
            value={department}
            options={departmentOptions}
            onChange={(value) => {
              setDepartment(value);
              setTimelinePage(1);
              setAnomalyPage(1);
            }}
            className="gallery-toolbar__field"
            placeholder="选择部门"
          />
          <Select
            value={employeeId}
            options={employeeOptions}
            onChange={(value) => {
              setEmployeeId(value);
              setTimelinePage(1);
              setAnomalyPage(1);
            }}
            className="gallery-toolbar__field gallery-toolbar__field--wide"
            placeholder="选择员工"
            showSearch
            optionFilterProp="label"
          />
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => {
              setSelectedDate(event.target.value);
              setTimelinePage(1);
              setAnomalyPage(1);
            }}
            className="gallery-toolbar__field"
          />
        </div>
        <Typography.Text type="secondary">
          {currentEmployee ? `${formatEmployeeLabel(currentEmployee)} / ` : ''}{selectedDate}
        </Typography.Text>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card bordered={false} className="panel-card timeline-summary-card">
            <Typography.Text type="secondary">总条数</Typography.Text>
            <Typography.Title level={3}>{summary.total}</Typography.Title>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bordered={false} className="panel-card timeline-summary-card">
            <Typography.Text type="secondary">当前页</Typography.Text>
            <Typography.Title level={3}>{summary.visible}</Typography.Title>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bordered={false} className="panel-card timeline-summary-card">
            <Typography.Text type="secondary">异常数</Typography.Text>
            <Typography.Title level={3}>{summary.anomalies}</Typography.Title>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card bordered={false} className="panel-card timeline-summary-card">
            <Typography.Text type="secondary">聚合输入</Typography.Text>
            <Typography.Title level={3}>{summary.inputCount}</Typography.Title>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} align="top">
        <Col xs={24} xxl={8}>
          <Card
            bordered={false}
            className="panel-card timeline-column-card"
            title="异常置顶"
            extra={<Typography.Text type="secondary">{anomalyTotal} 条</Typography.Text>}
          >
            {anomalies.length === 0 ? (
              <Alert type="success" showIcon message="当前日期没有异常截图" />
            ) : (
              <Space direction="vertical" size={16} className="full-width">
                <List
                  dataSource={anomalies}
                  renderItem={(item) => (
                    <List.Item className="timeline-list-item">
                      <TimelineEntry item={item} selectedDate={selectedDate} compact />
                    </List.Item>
                  )}
                />
                <Pagination
                  current={anomalyPage}
                  pageSize={ANOMALY_PAGE_SIZE}
                  total={anomalyTotal}
                  onChange={setAnomalyPage}
                  hideOnSinglePage
                  showSizeChanger={false}
                  size="small"
                />
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} xxl={16}>
          <Card
            bordered={false}
            className="panel-card timeline-column-card"
            title="完整时间线"
            extra={<Typography.Text type="secondary">倒序 / 第 {timelinePage} 页</Typography.Text>}
          >
            {screenshots.length === 0 ? (
              <Empty description={loading ? '正在加载时间线…' : '当前日期没有截图'} />
            ) : (
              <Space direction="vertical" size={16} className="full-width">
                <List
                  dataSource={screenshots}
                  renderItem={(item) => (
                    <List.Item className="timeline-list-item">
                      <TimelineEntry item={item} selectedDate={selectedDate} />
                    </List.Item>
                  )}
                />
                <Pagination
                  current={timelinePage}
                  pageSize={TIMELINE_PAGE_SIZE}
                  total={timelineTotal}
                  onChange={setTimelinePage}
                  showSizeChanger={false}
                />
              </Space>
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function TimelineEntry({
  item,
  selectedDate,
  compact = false
}: {
  item: ScreenshotListItem;
  selectedDate: string;
  compact?: boolean;
}) {
  const detailQuery = buildDetailQuery(item.id, item.employeeId, item.capturedDate ?? selectedDate);

  return (
    <div className={compact ? 'timeline-entry timeline-entry--compact' : 'timeline-entry'}>
      <Space size={[8, 8]} wrap>
        <Typography.Text strong>{formatCapturedAt(item, item.capturedAtRaw ? 'full' : 'short')}</Typography.Text>
        <Tag color="blue">{formatActivityLabel(item.activityType)}</Tag>
        {item.noChangeStreakTriggered ? <Tag color="orange">无变化连续异常</Tag> : null}
        {item.riskCount > 0 ? <Tag color="red">风险 {item.riskCount}</Tag> : <Tag>无风险</Tag>}
        {item.retentionDecision ? <Tag>{`保留：${formatRetentionDecision(item.retentionDecision)}`}</Tag> : null}
        {item.fileRetentionStatus ? <Tag>{`文件：${formatFileRetentionStatus(item.fileRetentionStatus)}`}</Tag> : null}
        {formatChangeMetricsTags(item.changeMetrics).slice(0, compact ? 2 : 4).map((label) => (
          <Tag key={label}>{label}</Tag>
        ))}
      </Space>
      <Typography.Text>{item.employeeName ?? '未返回员工姓名'}</Typography.Text>
      <Typography.Text type="secondary">{item.department ?? '未返回部门'}</Typography.Text>
      <Typography.Text type="secondary">{item.activeApp ? `应用：${item.activeApp}` : '应用：未返回'}</Typography.Text>
      <Typography.Text type="secondary">{formatConfidenceLabel(item.activityConfidence)}</Typography.Text>
      <Typography.Text type="secondary">{formatCounterLine(item)}</Typography.Text>
      <Typography.Text type="secondary">窗口：{formatWindowTitle(item.windowTitle)}</Typography.Text>
      <Typography.Text type="secondary">{formatRiskSummary(item)}</Typography.Text>
      {item.activitySummary ? (
        <Typography.Text type="secondary">{localizeScreenshotText(item.activitySummary)}</Typography.Text>
      ) : null}
      {item.changeMetrics.reason ? (
        <Typography.Text type="secondary">差异说明：{localizeScreenshotText(item.changeMetrics.reason)}</Typography.Text>
      ) : null}
      <Link to={`/screenshots/detail?${detailQuery.toString()}`}>查看详情</Link>
    </div>
  );
}

function normalizeTimelineStatus(status: ApiStatus, total: number, selectedDate: string): ApiStatus {
  if (status.source === 'live') {
    return {
      ...status,
      label: '实时接口',
      detail: `${selectedDate} 共返回 ${total} 条时间线记录。`
    };
  }

  return {
    ...status,
    label: '接口不可用',
    detail: `未能加载 ${selectedDate} 的时间线：${status.detail}`
  };
}

function buildDetailQuery(screenshotId: string, employeeId?: string, date?: string) {
  const params = new URLSearchParams();
  params.set('screenshotId', screenshotId);
  if (employeeId) {
    params.set('employeeId', employeeId);
  }
  if (date) {
    params.set('date', date);
  }
  return params;
}
