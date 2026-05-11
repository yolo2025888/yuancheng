export type KpiMetric = {
  key: string;
  title: string;
  value: string;
  delta: string;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
};

export type ApiStatus = {
  source: 'live' | 'mock';
  state: 'connected' | 'fallback' | 'unavailable';
  label: string;
  detail: string;
  endpoint?: string;
};

export type AuthStorageMode = 'local' | 'session';

export type AuthIdentity = {
  id?: string;
  username: string;
  displayName: string;
  email?: string;
  roleId?: string;
  roleName?: string;
  permissionKeys: string[];
  permissionsResolved: boolean;
};

export type AuthSessionSeed = {
  token: string;
  user: AuthIdentity;
  source: 'live' | 'local-dev';
};

export type StoredAuthSession = AuthSessionSeed & {
  storageMode: AuthStorageMode;
};

export type ApiResult<T> = {
  data: T;
  apiStatus: ApiStatus;
};

export type EmployeeImportSummary = {
  totalCount?: number;
  createdCount?: number;
  updatedCount?: number;
  skippedCount?: number;
  warnings: string[];
  detail?: string;
};

export type BackendHealth = {
  ok: boolean;
  appName?: string;
  environment?: string;
  apiStatus: ApiStatus;
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

export type RiskScoreRecord = {
  key: string;
  employee: string;
  employeeNo?: string;
  department: string;
  role: string;
  position?: string;
  slot: string;
  score: number;
  riskLevel: number;
  status: string;
  eventCount: number;
  policyName?: string;
};

export type AccessMatrixRecord = {
  key: string;
  role: string;
  modules: string[];
  actions: string[];
  departments: string[];
  positions: string[];
  employees: string[];
  employeeCount: number;
  policyNames: string[];
};

export type EventSeverity = 'low' | 'medium' | 'high' | 'critical';

export type EventStatus =
  | 'new'
  | 'reviewing'
  | 'reviewed'
  | 'confirmed'
  | 'ignored'
  | 'closed'
  | (string & {});

export type ChangeMetrics = {
  changeLevel: string;
  effectiveChange: boolean | null;
  changedBlockRatio: number | null;
  similarity: number | null;
  distance: number | null;
  reason: string;
};

export type LinkedRiskRecord = {
  id: string;
  type: string;
  severity: EventSeverity;
  status: EventStatus;
  reason: string;
  streakCount: number | null;
  noChangeStreakTriggered: boolean;
};

export type EventRecord = {
  id: string;
  employee: string;
  department: string;
  type: string;
  severity: EventSeverity;
  status: EventStatus;
  startedAt: string;
  duration: string;
  summary: string;
  eventCode?: string;
  relatedScreenshotId?: string | null;
  streakCount?: number | null;
  noChangeStreakTriggered?: boolean;
  changeMetrics?: ChangeMetrics | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewerName?: string | null;
  reviewerUsername?: string | null;
};

export type ReviewQueueRecord = {
  id: string;
  severity: EventSeverity;
  type: string;
  itemType?: string;
  employee: string;
  department?: string;
  status: string;
  ageLabel: string;
  ageMinutes?: number | null;
  reason: string;
  queuedAt?: string | null;
  isActionable?: boolean;
  linkedEventId?: string;
  linkedScreenshotId?: string | null;
  deviceHostname?: string | null;
  eventType?: string | null;
  source: 'review_queue' | 'events' | 'risk';
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
  employeeNo?: string;
  department: string;
  role: string;
  position?: string;
  manager: string;
  status?: string;
  devices: number;
  todayRisk: number;
  githubAccount: string;
  policyName?: string;
};

export type DeviceRecord = {
  key: string;
  deviceName: string;
  employee: string;
  employeeNo?: string;
  department?: string;
  role?: string;
  position?: string;
  os: string;
  agentVersion: string;
  lastHeartbeat: string;
  status: 'online' | 'offline' | 'warning';
  metadataLabels?: string[];
  hasAgentToken?: boolean;
  agentTokenRevokedAt?: string | null;
  agentTokenExpiresAt?: string | null;
  agentTokenLastUsedAt?: string | null;
};

export type TimelineSegment = {
  time: string;
  label: string;
  detail: string;
  status: 'working' | 'meeting' | 'idle' | 'risk';
  activityType?: string;
  activeApp?: string | null;
  activityConfidence?: number | null;
  activitySummary?: string | null;
  changeMetrics?: ChangeMetrics | null;
  linkedRiskCount?: number;
  noChangeStreakTriggered?: boolean;
};

export type ScreenshotListItem = {
  id: string;
  capturedAt: string;
  thumbUri?: string | null;
  imageUri?: string | null;
  activityType: string;
  activeApp?: string | null;
  activityConfidence?: number | null;
  activitySummary?: string | null;
  activityEvidence?: Record<string, unknown>;
  changeLevel: string;
  keyboardCount: number;
  mouseCount: number;
  riskCount: number;
  riskSummary: string;
  changeMetrics: ChangeMetrics;
  linkedRisks: LinkedRiskRecord[];
  noChangeStreakTriggered: boolean;
};

export type PolicyRecord = {
  key: string;
  name: string;
  version?: string;
  role: string;
  roles: string[];
  positions: string[];
  departments: string[];
  status?: string;
  isActive: boolean;
  assignedEmployees?: number;
  screenshotIntervalSeconds: number;
  screenshotInterval: string;
  noChangeThresholdFrames: number;
  noChangeThreshold: string;
  highRiskDurationSeconds: number;
  highRiskDuration: string;
  ocrEnabled: boolean;
  retentionDays: number;
  originalRetention: string;
};

export type PolicyMutationInput = {
  name: string;
  version?: string;
  screenshotIntervalSeconds: number;
  noChangeThresholdFrames: number;
  retentionDays: number;
  roles: string[];
  departments: string[];
  positions: string[];
};

export type AuditLogRecord = {
  key: string;
  operator: string;
  action: string;
  target: string;
  scope?: string;
  metadataSummary?: string;
  reason: string;
  timestamp: string;
  result: string;
};

export type AttendanceRecord = {
  key: string;
  employee: string;
  employeeNo?: string;
  department?: string;
  userName: string;
  machineName?: string;
  eventType: 'clock_in' | 'clock_out' | (string & {});
  eventLabel: string;
  occurredAt: string;
  workDate?: string;
  anomalyStatus: 'normal' | 'late' | 'early_leave' | (string & {});
  anomalyLabel: string;
  anomalyReasons: string[];
  reviewStatus: AttendanceReviewStatus;
  reviewNote?: string;
  source: string;
};

export type AttendanceRuleSummary = {
  key: string;
  name: string;
  lateThreshold: string;
  earlyLeaveThreshold: string;
  timezone?: string;
  sourceLabel?: string;
};

export type AttendanceRuleUpdateInput = {
  name?: string;
  clockInLateAfter: string;
  clockOutEarlyBefore: string;
};

export type AttendanceReviewStatus =
  | 'pending'
  | 'reviewed'
  | 'confirmed'
  | 'ignored'
  | (string & {});

export type GitHubRiskRecord = {
  key: string;
  employee: string;
  repository: string;
  action: string;
  riskRule: string;
  severity: EventSeverity;
  timestamp: string;
  correlation: string;
  detailsJson?: Record<string, unknown>;
  occurredAt?: string;
};

export type ScreenshotComparison = {
  currentImageLabel: string;
  previousImageLabel: string;
  currentImageUri?: string | null;
  currentThumbUri?: string | null;
  previousImageUri?: string | null;
  previousThumbUri?: string | null;
  metrics: Array<{ label: string; value: string; hint: string }>;
  reasoning: string[];
  changeMetrics?: ChangeMetrics | null;
  linkedRisks?: LinkedRiskRecord[];
  noChangeStreakTriggered?: boolean;
  currentActivity?: ScreenshotListItem;
  previousActivity?: ScreenshotListItem;
  apiStatus?: ApiStatus;
};
