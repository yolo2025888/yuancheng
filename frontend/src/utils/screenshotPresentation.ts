import type {
  ChangeMetrics,
  EmployeeRecord,
  EventSeverity,
  LinkedRiskRecord,
  ScreenshotListItem
} from '../types/models';

const severityWeight: Record<EventSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const exactTextMap: Record<string, string> = {
  unknown: '未知',
  development: '开发',
  documentation: '文档',
  meeting: '会议',
  idle: '空闲',
  locked: '锁屏',
  code_review_or_browser: '浏览/评审',
  'No linked risk events': '无关联风险',
  'No activity summary available.': '暂无活动摘要。',
  'No previous completed screenshot on this device screen.': '当前屏幕没有可用于对比的上一张截图。',
  'Unknown activity during local session with major screen change.': '本地会话出现明显画面变化，暂未识别具体活动。',
  'Unknown activity during local session with stable screen.': '本地会话画面稳定，暂未识别具体活动。',
  'Normal focused work.': '当前截图表现为正常工作。',
  'Streaming site detected during active shift.': '工作时段检测到高风险非工作活动。'
};

export function formatEmployeeLabel(employee: EmployeeRecord) {
  const employeeNo = employee.employeeNo ? `（${employee.employeeNo}）` : '';
  const department = employee.department && employee.department !== 'Unassigned' ? ` / ${employee.department}` : '';
  return `${employee.name}${employeeNo}${department}`;
}

export function localizeScreenshotText(value?: string | null) {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (exactTextMap[trimmed]) {
    return exactTextMap[trimmed];
  }
  if (trimmed.startsWith('Effective visual change detected')) {
    return trimmed.replace('Effective visual change detected', '检测到有效画面变化');
  }
  if (trimmed.startsWith('Frame stayed effectively unchanged')) {
    return trimmed.replace('Frame stayed effectively unchanged', '画面保持基本不变');
  }
  return trimmed;
}

export function formatActivityLabel(value?: string | null) {
  if (!value) {
    return '未知活动';
  }
  const normalized = value.trim().toLowerCase();
  if (exactTextMap[normalized]) {
    return exactTextMap[normalized];
  }
  if (normalized.includes('review') || normalized.includes('browser')) {
    return '浏览/评审';
  }
  if (normalized.includes('develop') || normalized.includes('code')) {
    return '开发';
  }
  if (normalized.includes('document')) {
    return '文档';
  }
  if (normalized.includes('meeting')) {
    return '会议';
  }
  if (normalized.includes('idle')) {
    return '空闲';
  }
  if (normalized.includes('lock')) {
    return '锁屏';
  }
  return value;
}

export function formatConfidenceLabel(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '置信度未知';
  }
  const normalized = value > 1 ? value : value * 100;
  return `置信度 ${normalized.toFixed(normalized >= 10 ? 0 : 1)}%`;
}

export function formatChangeMetricsTags(metrics?: ChangeMetrics | null) {
  if (!metrics) {
    return [];
  }

  const tags = [`变化等级 ${formatChangeLevel(metrics.changeLevel)}`];
  if (metrics.effectiveChange === true) {
    tags.push('有效变化');
  } else if (metrics.effectiveChange === false) {
    tags.push('无有效变化');
  } else {
    tags.push('变化待确认');
  }
  if (metrics.changedBlockRatio !== null && metrics.changedBlockRatio !== undefined) {
    tags.push(`变化块 ${(metrics.changedBlockRatio > 1 ? metrics.changedBlockRatio : metrics.changedBlockRatio * 100).toFixed(1)}%`);
  }
  if (metrics.similarity !== null && metrics.similarity !== undefined) {
    tags.push(`相似度 ${metrics.similarity.toFixed(3)}`);
  }
  if (metrics.distance !== null && metrics.distance !== undefined) {
    tags.push(`距离 ${metrics.distance.toFixed(Number.isInteger(metrics.distance) ? 0 : 2)}`);
  }
  return tags;
}

export function formatCounterLine(item: ScreenshotListItem) {
  return `键盘 ${item.keyboardCount} / 鼠标 ${item.mouseCount} / 风险 ${item.riskCount}`;
}

export function formatRiskSummary(item: ScreenshotListItem) {
  if (item.linkedRisks.length === 0) {
    return item.noChangeStreakTriggered ? '已触发无变化连续异常' : '无关联风险';
  }
  return item.linkedRisks.map((risk) => formatRiskTypeLabel(risk)).join('、');
}

export function formatRiskTypeLabel(risk: LinkedRiskRecord) {
  return localizeScreenshotText(risk.type) || risk.type;
}

export function formatSeverityLabel(severity: EventSeverity | 'none') {
  switch (severity) {
    case 'critical':
      return '严重';
    case 'high':
      return '高风险';
    case 'medium':
      return '中风险';
    case 'low':
      return '低风险';
    default:
      return '无风险';
  }
}

export function formatRetentionDecision(value?: string | null) {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'normal':
      return '正常';
    case 'needs_review':
      return '待复核';
    case 'high_risk':
      return '高风险';
    case 'ai_failed':
      return 'AI 失败保留';
    case 'skipped':
      return '跳过分析保留';
    case 'pending':
      return '待判定';
    default:
      return value ?? '未判定';
  }
}

export function formatFileRetentionStatus(value?: string | null) {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'full':
      return '完整保留';
    case 'metadata_only':
      return '仅保留元数据';
    case 'deleted':
      return '文件已删除';
    default:
      return value ?? '未知';
  }
}

export function resolveHighestRiskSeverity(item: ScreenshotListItem): EventSeverity | 'none' {
  if (item.linkedRisks.length === 0) {
    return item.noChangeStreakTriggered ? 'high' : 'none';
  }
  return [...item.linkedRisks].sort((left, right) => severityWeight[right.severity] - severityWeight[left.severity])[0]
    .severity;
}

export function isAbnormalScreenshot(item: ScreenshotListItem) {
  return Boolean(item.isAbnormal) || item.noChangeStreakTriggered || item.riskCount > 0;
}

export function compareScreenshotsDesc(left: ScreenshotListItem, right: ScreenshotListItem) {
  const leftScore = left.sortTimestamp ?? parseTimestamp(left.capturedAtRaw) ?? parseTimestamp(left.capturedAt) ?? 0;
  const rightScore = right.sortTimestamp ?? parseTimestamp(right.capturedAtRaw) ?? parseTimestamp(right.capturedAt) ?? 0;
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  return right.id.localeCompare(left.id);
}

export function formatCapturedAt(item: ScreenshotListItem, mode: 'full' | 'short' = 'full') {
  const raw = item.capturedAtRaw ?? item.capturedAt;
  const timestamp = parseTimestamp(raw);
  if (timestamp === null) {
    return item.capturedAt;
  }
  const date = new Date(timestamp);
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    year: mode === 'full' ? 'numeric' : undefined,
    month: mode === 'full' ? '2-digit' : undefined,
    day: mode === 'full' ? '2-digit' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(date).replace(/\//g, '-');
}

export function buildGalleryDateHint(items: ScreenshotListItem[]) {
  if (items.length === 0) {
    return '';
  }
  const first = formatCapturedAt(items[0], 'full');
  const last = formatCapturedAt(items[items.length - 1], 'full');
  return `${first} 至 ${last}`;
}

export function formatWindowTitle(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || '未返回窗口标题';
}

function formatChangeLevel(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case 'critical':
    case 'major':
    case 'high':
      return '高';
    case 'medium':
    case 'moderate':
      return '中';
    case 'minor':
    case 'low':
      return '低';
    case 'none':
      return '无';
    default:
      return '未知';
  }
}

function parseTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}
