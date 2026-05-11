export type KpiMetric = {
  key: string;
  title: string;
  value: string;
  delta: string;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
};

export type StatusBucket = {
  slot: string;
  coding: number;
  review: number;
  meeting: number;
  documentation: number;
  communication: number;
  idle: number;
  locked: number;
};

export type HeatmapPoint = {
  employee: string;
  slot: string;
  riskLevel: number;
  status: string;
};

export type EventRecord = {
  id: string;
  employee: string;
  department: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'reviewing' | 'confirmed' | 'ignored' | 'closed';
  startedAt: string;
  duration: string;
  summary: string;
};

export type RealtimeStatusRecord = {
  key: string;
  employee: string;
  department: string;
  role: string;
  device: string;
  currentStatus: string;
  app: string;
  activity: string;
  lastScreenshotAt: string;
  noChangeCount: number;
  riskLevel: 'normal' | 'watch' | 'high';
};

export type EmployeeRecord = {
  key: string;
  name: string;
  department: string;
  role: string;
  manager: string;
  devices: number;
  todayRisk: number;
  githubAccount: string;
};

export type DeviceRecord = {
  key: string;
  deviceName: string;
  employee: string;
  os: string;
  agentVersion: string;
  lastHeartbeat: string;
  status: 'online' | 'offline' | 'warning';
};

export type TimelineSegment = {
  time: string;
  label: string;
  detail: string;
  status: 'working' | 'meeting' | 'idle' | 'risk';
};

export type PolicyRecord = {
  key: string;
  role: string;
  screenshotInterval: string;
  noChangeThreshold: string;
  highRiskDuration: string;
  ocrEnabled: boolean;
  originalRetention: string;
};

export type AuditLogRecord = {
  key: string;
  operator: string;
  action: string;
  target: string;
  reason: string;
  timestamp: string;
  result: string;
};

export type GitHubRiskRecord = {
  key: string;
  employee: string;
  repository: string;
  action: string;
  riskRule: string;
  severity: 'medium' | 'high' | 'critical';
  timestamp: string;
  correlation: string;
};

export type ScreenshotComparison = {
  currentImageLabel: string;
  previousImageLabel: string;
  metrics: Array<{ label: string; value: string; hint: string }>;
  reasoning: string[];
};
