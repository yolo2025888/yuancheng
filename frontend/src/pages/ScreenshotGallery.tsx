import { Button, Card, Checkbox, Empty, Input, List, Select, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ProtectedScreenshotImage } from '../components/ProtectedScreenshotImage';
import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, EmployeeRecord, EventSeverity, ScreenshotListItem } from '../types/models';
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
  formatSeverityLabel,
  formatWindowTitle,
  isAbnormalScreenshot,
  localizeScreenshotText,
  resolveHighestRiskSeverity
} from '../utils/screenshotPresentation';

const PAGE_SIZE = 24;

type RiskFilter = 'all' | 'high_risk' | 'needs_review' | 'high' | 'medium' | 'low';

export function ScreenshotGalleryPage() {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [rows, setRows] = useState<ScreenshotListItem[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [department, setDepartment] = useState<string>('all');
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [accessReason, setAccessReason] = useState('');

  const loadEmployees = useCallback(async () => {
    const result = await adminApi.getEmployees();
    setEmployees(result.data.filter((item) => item.status !== 'deleted'));
  }, []);

  const loadGallery = useCallback(async () => {
    setLoading(true);
    const result = await adminApi.getScreenshotGallery({
      employeeId,
      department: department === 'all' ? undefined : department,
      riskLevel: riskFilter === 'all' ? undefined : riskFilter,
      abnormalOnly: onlyAbnormal,
      page,
      pageSize: PAGE_SIZE
    });
    setRows(result.data);
    setTotal(result.total);
    setApiStatus(normalizeGalleryStatus(result.apiStatus, result.data.length, result.total));
    setLoading(false);
  }, [department, employeeId, onlyAbnormal, page, riskFilter]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    void loadGallery();
  }, [loadGallery]);

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
      setEmployeeId(undefined);
    }
  }, [employeeId, employeeOptions]);

  useEffect(() => {
    setPage(1);
  }, [department, employeeId, onlyAbnormal, riskFilter]);

  const summary = useMemo(() => {
    const abnormalCount = rows.filter(isAbnormalScreenshot).length;
    const highRiskCount = rows.filter((item) => {
      const severity = resolveHighestRiskSeverity(item);
      return severity === 'critical' || severity === 'high';
    }).length;
    return { abnormalCount, highRiskCount };
  }, [rows]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="截图库"
        description="按时间倒序查看截图，支持部门、员工、风险和仅异常筛选。"
        extra={
          <Space size={[8, 8]} wrap>
            <Tag color="blue">当前页 {rows.length} 张</Tag>
            <Tag color={summary.abnormalCount > 0 ? 'orange' : 'green'}>异常 {summary.abnormalCount} 张</Tag>
            <Tag color={summary.highRiskCount > 0 ? 'red' : 'default'}>高风险 {summary.highRiskCount} 张</Tag>
            <Button size="small" onClick={() => void loadGallery()}>
              刷新
            </Button>
          </Space>
        }
      />

      {apiStatus ? <ApiStatusNotice status={apiStatus} title="截图库接口" /> : null}

      <Card bordered={false} className="panel-card">
        <div className="gallery-toolbar">
          <Select
            value={department}
            options={departmentOptions}
            onChange={setDepartment}
            className="gallery-toolbar__field"
            placeholder="选择部门"
          />
          <Select
            allowClear
            value={employeeId}
            options={employeeOptions}
            onChange={setEmployeeId}
            className="gallery-toolbar__field gallery-toolbar__field--wide"
            placeholder="选择员工"
            showSearch
            optionFilterProp="label"
          />
          <Select
            value={riskFilter}
            onChange={setRiskFilter}
            className="gallery-toolbar__field"
            options={[
              { value: 'all', label: '全部风险' },
              { value: 'high_risk', label: '高风险截图' },
              { value: 'needs_review', label: '待复核截图' },
              { value: 'high', label: 'AI 高风险' },
              { value: 'medium', label: 'AI 中风险' },
              { value: 'low', label: 'AI 低风险' }
            ]}
          />
          <Checkbox checked={onlyAbnormal} onChange={(event) => setOnlyAbnormal(event.target.checked)}>
            仅异常
          </Checkbox>
          <Input
            value={accessReason}
            onChange={(event) => setAccessReason(event.target.value)}
            placeholder="填写截图查看原因后加载原图"
            className="gallery-toolbar__field gallery-toolbar__field--wide"
            maxLength={200}
          />
        </div>
        <Typography.Text type="secondary">
          共 {total} 张截图，当前第 {page} 页。
        </Typography.Text>
      </Card>

      <Card bordered={false} className="panel-card">
        {rows.length === 0 ? (
          <Empty description={loading ? '正在加载截图…' : '当前筛选条件下没有截图'} />
        ) : (
          <List
            loading={loading}
            dataSource={rows}
            grid={{ gutter: 16, xs: 1, sm: 1, lg: 2, xl: 3 }}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              onChange: setPage,
              showSizeChanger: false
            }}
            renderItem={(item) => {
              const severity = resolveHighestRiskSeverity(item);
              const detailQuery = buildDetailQuery(item.id, item.employeeId, item.capturedDate);
              return (
                <List.Item>
                  <Card
                    bordered={false}
                    className="gallery-shot"
                    title={formatCapturedAt(item, 'full')}
                    extra={<Tag color={severityColor(severity)}>{formatSeverityLabel(severity)}</Tag>}
                    actions={[
                      <Link key="detail" to={`/screenshots/detail?${detailQuery.toString()}`}>
                        查看详情
                      </Link>
                    ]}
                  >
                    <Space direction="vertical" size={12} className="full-width">
                      <ProtectedScreenshotImage
                        imageUri={item.imageUri}
                        thumbUri={item.thumbUri}
                        accessReason={accessReason}
                        alt={`截图 ${item.id}`}
                        minHeight={240}
                        className="gallery-shot__image"
                      />
                      <div className="gallery-shot__meta">
                        <Typography.Text strong>{item.employeeName ?? '未返回员工姓名'}</Typography.Text>
                        <Typography.Text type="secondary">
                          {item.employeeNo ?? '无工号'}{item.department ? ` / ${item.department}` : ''}
                        </Typography.Text>
                        <Typography.Text>{formatActivityLabel(item.activityType)}</Typography.Text>
                        <Typography.Text type="secondary">
                          {item.activeApp ? `应用：${item.activeApp}` : '应用：未返回'}
                        </Typography.Text>
                        <Typography.Text type="secondary">{formatConfidenceLabel(item.activityConfidence)}</Typography.Text>
                        <Typography.Text type="secondary">{formatCounterLine(item)}</Typography.Text>
                        <Typography.Text type="secondary">窗口：{formatWindowTitle(item.windowTitle)}</Typography.Text>
                        <Typography.Text type="secondary">{formatRiskSummary(item)}</Typography.Text>
                        {item.activitySummary ? (
                          <Typography.Text type="secondary">{localizeScreenshotText(item.activitySummary)}</Typography.Text>
                        ) : null}
                        <Space size={[6, 6]} wrap>
                          {item.retentionDecision ? <Tag>{`保留：${formatRetentionDecision(item.retentionDecision)}`}</Tag> : null}
                          {item.fileRetentionStatus ? <Tag>{`文件：${formatFileRetentionStatus(item.fileRetentionStatus)}`}</Tag> : null}
                          {item.noChangeStreakTriggered ? <Tag color="orange">无变化连续异常</Tag> : null}
                          {formatChangeMetricsTags(item.changeMetrics).map((label) => (
                            <Tag key={label}>{label}</Tag>
                          ))}
                        </Space>
                      </div>
                    </Space>
                  </Card>
                </List.Item>
              );
            }}
          />
        )}
      </Card>
    </Space>
  );
}

function normalizeGalleryStatus(status: ApiStatus, currentCount: number, total: number): ApiStatus {
  if (status.source === 'live') {
    return {
      ...status,
      label: '实时接口',
      detail: `当前页加载 ${currentCount} 张，共 ${total} 张。`
    };
  }

  return {
    ...status,
    label: '接口不可用',
    detail: `截图库未能返回可用数据：${status.detail}`
  };
}

function severityColor(severity: EventSeverity | 'none') {
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

function buildDetailQuery(screenshotId: string, employeeId?: string, date?: string | null) {
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
