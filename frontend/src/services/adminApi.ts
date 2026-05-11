import {
  auditLogs,
  dashboardKpis,
  devices,
  employeeHeatmap,
  employees,
  events,
  githubRisks,
  githubTrend,
  policies,
  realtimeStatus,
  screenshotComparison,
  workStatusSeries
} from '../mock/data';
import { apiClient, getErrorMessage } from './apiClient';
import type {
  ApiResult,
  ApiStatus,
  BackendHealth,
  ChangeMetrics,
  DeviceRecord,
  EmployeeRecord,
  EventRecord,
  EventSeverity,
  EventStatus,
  KpiMetric,
  LinkedRiskRecord,
  PolicyRecord,
  RealtimeStatusRecord,
  ScreenshotComparison,
  ScreenshotListItem,
  TimelineSegment
} from '../types/models';

type DashboardData = {
  kpis: KpiMetric[];
  workStatusSeries: typeof workStatusSeries;
  employeeHeatmap: typeof employeeHeatmap;
  events: EventRecord[];
  eventApiStatus: ApiStatus;
  backendHealth: BackendHealth;
};

type TimelineData = {
  kpis: KpiMetric[];
  segments: TimelineSegment[];
  screenshots: ScreenshotListItem[];
  apiStatus: ApiStatus;
  employeeId?: string;
  employeeLabel: string;
  selectedDate: string;
};

type RealtimeStatusData = {
  rows: RealtimeStatusRecord[];
  backendHealth: BackendHealth;
};

type EmployeeListData = ApiResult<EmployeeRecord[]>;
type DeviceListData = ApiResult<DeviceRecord[]>;
type PolicyListData = ApiResult<PolicyRecord[]>;

type EventApiItem = {
  id: string;
  employee_id: string;
  device_id: string;
  event_type: string;
  severity: string;
  start_at: string;
  end_at?: string | null;
  duration_seconds?: number | null;
  related_screenshot_id?: string | null;
  related_diff?: Record<string, unknown> | null;
  streak_count?: number | null;
  status: string;
  reason?: string | null;
  details_json?: Record<string, unknown> | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
  updated_at: string;
};

type EventApiListResponse = {
  items: EventApiItem[];
  total: number;
};

type TimelineApiItem = Record<string, unknown> & {
  time?: string;
  screenshot_id?: string;
  thumbnail_url?: string | null;
  thumb_uri?: string | null;
  image_url?: string | null;
  image_uri?: string | null;
  full_image_url?: string | null;
  activity_type?: string;
  change_level?: string;
  change?: Record<string, unknown> | null;
  diff?: Record<string, unknown> | null;
  keyboard_count?: number;
  mouse_count?: number;
  risk_events?: unknown[];
  events?: unknown[];
  details_json?: Record<string, unknown> | null;
  diff_metrics?: Record<string, unknown> | null;
  change_metrics?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

type TimelineApiResponse = {
  employee_id: string;
  date: string;
  items: TimelineApiItem[];
};

type EmployeeApiItem = Record<string, unknown> & {
  id?: string;
  name?: string;
  employee_no?: string;
  department?: string;
  manager_name?: string;
  github_username?: string;
  status?: string;
  role?: string;
  position?: string;
  title?: string;
  job_title?: string;
  post?: string;
};

type DeviceApiItem = Record<string, unknown> & {
  id?: string;
  hostname?: string;
  employee_name?: string;
  os_type?: string;
  agent_version?: string;
  last_heartbeat_at?: string | null;
  status?: string;
};

type PolicyApiItem = Record<string, unknown> & {
  id?: string;
  name?: string;
  version?: string;
  screenshot_interval_seconds?: number;
  no_change_threshold?: number;
  retention_days?: number;
  is_active?: boolean;
  rules_json?: Record<string, unknown>;
};

type HealthPayload = {
  status: string;
  app_name?: string;
  environment?: string;
};

type TimelineQuery = {
  employeeId?: string;
  date?: string;
};

type ScreenshotDetailQuery = TimelineQuery & {
  screenshotId?: string;
};

const today = getLocalDateString();

const liveStatus = (endpoint: string, detail: string): ApiStatus => ({
  source: 'live',
  state: 'connected',
  label: 'Live API',
  detail,
  endpoint
});

const fallbackStatus = (endpoint: string, detail: string): ApiStatus => ({
  source: 'mock',
  state: 'fallback',
  label: 'Mock fallback',
  detail,
  endpoint
});

const unavailableStatus = (endpoint: string, detail: string): ApiStatus => ({
  source: 'mock',
  state: 'unavailable',
  label: 'Backend unavailable',
  detail,
  endpoint
});

export const adminApi = {
  async getDashboardData(): Promise<DashboardData> {
    const [eventResult, backendHealth] = await Promise.all([this.getEvents(), this.getHealth()]);

    return {
      kpis: buildDashboardKpis(eventResult.data),
      workStatusSeries,
      employeeHeatmap,
      events: eventResult.data,
      eventApiStatus: eventResult.apiStatus,
      backendHealth
    };
  },

  async getHealth(): Promise<BackendHealth> {
    try {
      const payload = await apiClient<HealthPayload>('/health');
      return {
        ok: payload.status === 'ok',
        appName: payload.app_name,
        environment: payload.environment,
        apiStatus: liveStatus('/health', `${payload.status} from ${payload.app_name ?? 'backend'}`)
      };
    } catch (error) {
      return {
        ok: false,
        apiStatus: unavailableStatus('/health', getErrorMessage(error))
      };
    }
  },

  async getRealtimeStatus(): Promise<RealtimeStatusData> {
    const backendHealth = await this.getHealth();

    return {
      rows: realtimeStatus,
      backendHealth
    };
  },

  async getEmployees(): Promise<EmployeeListData> {
    try {
      const payload = await apiClient<EmployeeApiItem[] | { items: EmployeeApiItem[] }>('/api/employees');
      const items = extractItems(payload);

      if (!items) {
        throw new Error('Employees payload is not an array');
      }

      return {
        data: items.map(mapEmployeeRecord),
        apiStatus: liveStatus('/api/employees', `Loaded ${items.length} employee records`)
      };
    } catch (error) {
      return {
        data: employees,
        apiStatus: fallbackStatus('/api/employees', getErrorMessage(error))
      };
    }
  },

  async getDevices(): Promise<DeviceListData> {
    try {
      const payload = await apiClient<DeviceApiItem[] | { items: DeviceApiItem[] }>('/api/devices');
      const items = extractItems(payload);

      if (!items) {
        throw new Error('Devices payload is not an array');
      }

      return {
        data: items.map(mapDeviceRecord),
        apiStatus: liveStatus('/api/devices', `Loaded ${items.length} device records`)
      };
    } catch (error) {
      return {
        data: devices,
        apiStatus: fallbackStatus('/api/devices', getErrorMessage(error))
      };
    }
  },

  async getTimeline(query: TimelineQuery = {}): Promise<TimelineData> {
    const selectedDate = query.date ?? today;
    const discoveredEmployeeId = query.employeeId ?? (await discoverEmployeeId());
    const mockTimeline = buildMockTimeline(selectedDate);

    if (!discoveredEmployeeId) {
      return {
        kpis: buildTimelineKpis(mockTimeline.screenshots),
        segments: mockTimeline.segments,
        screenshots: mockTimeline.screenshots,
        apiStatus: fallbackStatus(
          '/api/employees/{employee_id}/timeline',
          'No employee_id could be discovered from live data'
        ),
        employeeLabel: mockTimeline.employeeLabel,
        selectedDate
      };
    }

    try {
      const payload = await apiClient<TimelineApiResponse>(
        `/api/employees/${discoveredEmployeeId}/timeline?date=${selectedDate}`
      );
      const screenshots = payload.items.map(mapScreenshotListItem);

      return {
        kpis: buildTimelineKpis(screenshots),
        segments: payload.items.map(mapTimelineSegment),
        screenshots,
        apiStatus: liveStatus(
          `/api/employees/${discoveredEmployeeId}/timeline`,
          `Loaded ${payload.items.length} screenshots for ${selectedDate}`
        ),
        employeeId: payload.employee_id,
        employeeLabel: shortenUuid(payload.employee_id),
        selectedDate: payload.date
      };
    } catch (error) {
      return {
        kpis: buildTimelineKpis(mockTimeline.screenshots),
        segments: mockTimeline.segments,
        screenshots: mockTimeline.screenshots,
        apiStatus: fallbackStatus(
          `/api/employees/${discoveredEmployeeId}/timeline`,
          getErrorMessage(error)
        ),
        employeeId: discoveredEmployeeId,
        employeeLabel: shortenUuid(discoveredEmployeeId),
        selectedDate
      };
    }
  },

  async getScreenshotList(query: TimelineQuery = {}): Promise<ApiResult<ScreenshotListItem[]>> {
    const timeline = await this.getTimeline(query);

    return {
      data: timeline.screenshots,
      apiStatus: timeline.apiStatus
    };
  },

  async getEvents(): Promise<ApiResult<EventRecord[]>> {
    try {
      const payload = await fetchEventsRaw();
      return {
        data: payload.items.map(mapEventRecord).sort(compareEvents),
        apiStatus: liveStatus('/api/events', `Loaded ${payload.total} events`)
      };
    } catch (error) {
      return {
        data: buildMockEventRecords().sort(compareEvents),
        apiStatus: fallbackStatus('/api/events', getErrorMessage(error))
      };
    }
  },

  async reviewEvent(
    eventId: string,
    status: EventStatus,
    reviewNote?: string
  ): Promise<{ apiStatus: ApiStatus; events?: EventRecord[] }> {
    const endpoint = `/api/events/${eventId}/review`;

    try {
      await apiClient(endpoint, {
        method: 'POST',
        body: {
          status,
          action: status,
          review_status: status,
          review_note: reviewNote ?? null
        }
      });

      const refreshed = await this.getEvents();
      return {
        apiStatus: liveStatus(endpoint, `Review updated to ${status}`),
        events: refreshed.data
      };
    } catch (error) {
      return {
        apiStatus: fallbackStatus(endpoint, `Review kept locally only: ${getErrorMessage(error)}`)
      };
    }
  },

  async getScreenshotDetail(query: ScreenshotDetailQuery = {}): Promise<ScreenshotComparison> {
    const timeline = await this.getTimeline(query);
    const screenshots = timeline.screenshots;
    const current =
      screenshots.find((item) => item.id === query.screenshotId) ?? screenshots[screenshots.length - 1];

    if (!current) {
      return {
        ...screenshotComparison,
        apiStatus: timeline.apiStatus
      };
    }

    const currentIndex = screenshots.findIndex((item) => item.id === current.id);
    const previous = currentIndex > 0 ? screenshots[currentIndex - 1] : undefined;

    return {
      currentImageLabel: `Current ${current.capturedAt}`,
      previousImageLabel: previous ? `Previous ${previous.capturedAt}` : 'No previous screenshot',
      currentImageUri: current.imageUri ?? current.thumbUri ?? null,
      currentThumbUri: current.thumbUri ?? null,
      previousImageUri: previous?.imageUri ?? previous?.thumbUri ?? null,
      previousThumbUri: previous?.thumbUri ?? null,
      metrics: buildScreenshotDetailMetrics(current),
      reasoning: buildScreenshotReasoning(current, previous),
      changeMetrics: current.changeMetrics,
      linkedRisks: current.linkedRisks,
      noChangeStreakTriggered: current.noChangeStreakTriggered,
      apiStatus: timeline.apiStatus
    };
  },

  async getPolicies(): Promise<PolicyListData> {
    try {
      const payload = await apiClient<PolicyApiItem[] | { items: PolicyApiItem[] }>('/api/policies');
      const items = extractItems(payload);

      if (!items) {
        throw new Error('Policies payload is not an array');
      }

      return {
        data: items.map(mapPolicyRecord),
        apiStatus: liveStatus('/api/policies', `Loaded ${items.length} policy records`)
      };
    } catch (error) {
      return {
        data: policies,
        apiStatus: fallbackStatus('/api/policies', getErrorMessage(error))
      };
    }
  },

  async getAuditLogs() {
    return Promise.resolve(auditLogs);
  },

  async getGitHubRisks() {
    return Promise.resolve({
      records: githubRisks,
      trend: githubTrend
    });
  }
};

async function fetchEventsRaw() {
  return apiClient<EventApiListResponse>(
    `/api/events?from=${today}T00:00:00Z&to=${today}T23:59:59Z`
  );
}

async function discoverEmployeeId() {
  try {
    const payload = await fetchEventsRaw();
    return payload.items[0]?.employee_id;
  } catch {
    return undefined;
  }
}

function extractItems<T>(payload: T[] | { items: T[] }) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return Array.isArray(payload.items) ? payload.items : undefined;
}

function mapEmployeeRecord(item: EmployeeApiItem, index: number): EmployeeRecord {
  const manager = asRecord(item.manager);
  const deviceList = readArray(item, ['devices', 'device_ids', 'bound_devices']);

  return {
    key: readString(item, ['id']) ?? String(index),
    employeeNo: readString(item, ['employee_no', 'employeeNo', 'code']) ?? undefined,
    name: readString(item, ['name', 'display_name', 'full_name']) ?? `Employee ${index + 1}`,
    department: readString(item, ['department', 'department_name', 'team']) ?? 'Unassigned',
    role: readString(item, ['role', 'job_role', 'primary_role', 'job_family']) ?? 'General',
    position:
      firstString(
        readString(item, ['position', 'job_title', 'title', 'post']),
        readString(manager, ['position'])
      ) ?? undefined,
    manager:
      firstString(
        readString(item, ['manager_name']),
        readString(manager, ['name', 'display_name']),
        readString(item, ['manager'])
      ) ?? 'Unassigned',
    status: normalizeListStatus(readString(item, ['status'])),
    devices:
      readNumber(item, ['active_device_count', 'devices', 'device_count', 'bound_device_count']) ??
      (Array.isArray(deviceList) ? deviceList.length : 0),
    todayRisk:
      readNumber(item, ['today_risk', 'risk_count', 'open_risk_count', 'todayRisk']) ?? 0,
    githubAccount:
      readString(item, ['github_username', 'github_account', 'github_login']) ?? '--',
    policyName:
      firstString(
        readString(item, ['policy_name', 'policy_template']),
        readString(asRecord(item.policy), ['name', 'policy_name']),
        readString(asRecord(item.policy_summary), ['name', 'policy_name'])
      ) ?? undefined
  };
}

function mapDeviceRecord(item: DeviceApiItem, index: number): DeviceRecord {
  const employee = asRecord(item.employee);
  const metadata = pickRecords(item, ['metadata', 'agent_metadata', 'activity', 'state']);
  const screenshot = pickRecords(item, ['last_screenshot', 'screenshot', 'latest_screenshot']);
  const lastSessionState = asRecord(item.last_session_state);
  const lastInputActivity = asRecord(item.last_input_activity);
  const lastForegroundWindow = asRecord(item.last_foreground_window);

  return {
    key: readString(item, ['id']) ?? String(index),
    deviceName: readString(item, ['hostname', 'device_name']) ?? `device-${index + 1}`,
    employee:
      firstString(
        readString(item, ['employee_name']),
        readString(employee, ['name', 'display_name']),
        readString(item, ['employee_id'])
      ) ?? 'Unknown',
    employeeNo:
      firstString(
        readString(item, ['employee_no']),
        readString(employee, ['employee_no', 'employeeNo', 'code'])
      ) ?? undefined,
    department:
      firstString(
        readString(item, ['department', 'employee_department']),
        readString(employee, ['department', 'department_name'])
      ) ?? undefined,
    role:
      firstString(
        readString(item, ['role', 'employee_role', 'job_role']),
        readString(employee, ['role', 'job_role', 'job_family'])
      ) ?? undefined,
    position:
      firstString(
        readString(item, ['position', 'employee_position', 'job_title', 'title']),
        readString(employee, ['position', 'job_title', 'title'])
      ) ?? undefined,
    os: readString(item, ['os_type', 'os', 'platform']) ?? 'Unknown',
    agentVersion: readString(item, ['agent_version', 'version']) ?? '--',
    lastHeartbeat: formatDateTime(readString(item, ['last_heartbeat_at', 'last_seen_at'])),
    status: normalizeDeviceStatus(readString(item, ['status'])),
    metadataLabels: buildDeviceMetadataLabels(
      item,
      metadata,
      screenshot,
      lastSessionState,
      lastInputActivity,
      lastForegroundWindow
    )
  };
}

function mapPolicyRecord(item: PolicyApiItem, index: number): PolicyRecord {
  const rules = asRecord(item.rules_json);
  const scope = asRecord(item.scope);
  const roles = collectStringList(
    readStringArray(item, ['roles', 'target_roles', 'job_roles']),
    readStringArray(scope, ['roles', 'target_roles', 'job_roles']),
    readStringArray(rules, ['roles', 'target_roles', 'job_roles'])
  );
  const positions = collectStringList(
    readStringArray(item, ['positions', 'target_positions', 'posts']),
    readStringArray(scope, ['positions', 'target_positions', 'posts']),
    readStringArray(rules, ['positions', 'target_positions', 'posts'])
  );
  const departments = collectStringList(
    readStringArray(item, ['departments', 'target_departments']),
    readStringArray(scope, ['departments', 'target_departments']),
    readStringArray(rules, ['departments', 'target_departments'])
  );
  const intervalSeconds =
    readNumber(item, ['screenshot_interval_seconds']) ??
    readNumber(rules, ['screenshot_interval_seconds', 'capture_interval_seconds']) ??
    10;
  const noChangeThreshold =
    readNumber(item, ['no_change_threshold']) ??
    readNumber(rules, ['no_change_threshold', 'steady_frame_threshold']) ??
    6;
  const retentionDays =
    readNumber(item, ['retention_days']) ?? readNumber(rules, ['retention_days', 'original_retention_days']) ?? 7;
  const itemHighRiskMinutes = readNumber(item, ['high_risk_duration_minutes']);
  const rulesHighRiskMinutes = readNumber(rules, ['high_risk_duration_minutes']);
  const highRiskWindowSeconds =
    readNumber(item, ['high_risk_duration_seconds']) ??
    readNumber(rules, ['high_risk_duration_seconds']) ??
    (itemHighRiskMinutes !== undefined ? itemHighRiskMinutes * 60 : undefined) ??
    (rulesHighRiskMinutes !== undefined ? rulesHighRiskMinutes * 60 : undefined) ??
    intervalSeconds * noChangeThreshold;

  return {
    key: readString(item, ['id']) ?? String(index),
    name: readString(item, ['name', 'policy_name', 'template_name']) ?? `Policy ${index + 1}`,
    version: readString(item, ['version']) ?? undefined,
    role: roles[0] ?? readString(item, ['role', 'job_role']) ?? 'All roles',
    positions: positions.length > 0 ? positions : undefined,
    departments: departments.length > 0 ? departments : undefined,
    status: normalizeListStatus(resolvePolicyStatus(item, rules)),
    assignedEmployees:
      readNumber(item, ['assigned_employees', 'assigned_employee_count', 'employee_count']) ?? undefined,
    screenshotInterval: `${intervalSeconds}s`,
    noChangeThreshold: `${noChangeThreshold} frames`,
    highRiskDuration: formatDurationSeconds(highRiskWindowSeconds),
    ocrEnabled:
      firstBooleanFromSources(
        [item, rules].filter((source): source is Record<string, unknown> => Boolean(source)),
        ['ocr_enabled', 'enable_ocr', 'ocr']
      ) ?? false,
    originalRetention: `${retentionDays} days`
  };
}

function mapEventRecord(item: EventApiItem): EventRecord {
  const details = asRecord(item.details_json);
  const changeMetrics = extractChangeMetrics(
    item,
    details,
    asRecord(item.related_diff),
    nestedRecord(details, 'screenshot_diff'),
    nestedRecord(details, 'related_diff')
  );
  const eventCode =
    firstString(
      item.event_type,
      readString(details, ['event_code', 'code', 'rule_code', 'risk_code'])
    ) ?? 'event';
  const noChangeStreakTriggered =
    isNoChangeEventCode(eventCode) ||
    isNoChangeEventCode(readString(details, ['event_type', 'rule_name'])) ||
    readBoolean(details, ['no_change_streak_triggered', 'streak_triggered']) === true;

  return {
    id: item.id,
    employee: shortenUuid(item.employee_id),
    department: readString(details, ['department', 'department_name']) ?? 'API',
    type: formatLabel(item.event_type),
    severity: normalizeSeverity(item.severity),
    status: normalizeEventStatus(item.status),
    startedAt: formatDateTime(item.start_at),
    duration: formatDurationSeconds(item.duration_seconds),
    summary:
      firstString(item.reason, changeMetrics.reason, summarizeDetails(details)) ??
      `Device ${shortenUuid(item.device_id)}`,
    eventCode,
    relatedScreenshotId:
      item.related_screenshot_id ?? readString(details, ['screenshot_id', 'related_screenshot_id']) ?? null,
    streakCount:
      item.streak_count ?? readNumber(details, ['streak_count', 'no_change_streak_count']) ?? null,
    noChangeStreakTriggered,
    changeMetrics,
    reviewedAt: item.reviewed_at ? formatDateTime(item.reviewed_at) : null,
    reviewNote: item.review_note ?? null
  };
}

function mapTimelineSegment(item: TimelineApiItem): TimelineSegment {
  const linkedRisks = extractLinkedRisks(item);
  const changeMetrics = extractChangeMetrics(
    item,
    asRecord(item.change),
    asRecord(item.diff),
    asRecord(item.details_json),
    asRecord(item.diff_metrics),
    asRecord(item.change_metrics),
    asRecord(item.metadata)
  );
  const noChangeStreakTriggered = linkedRisks.some((risk) => risk.noChangeStreakTriggered);

  return {
    time: item.time ?? '--',
    label: buildTimelineLabel(item, changeMetrics, noChangeStreakTriggered),
    detail: buildTimelineDetail(item, linkedRisks, changeMetrics),
    status: buildTimelineStatus(item, linkedRisks, changeMetrics),
    changeMetrics,
    linkedRiskCount: linkedRisks.length,
    noChangeStreakTriggered
  };
}

function mapScreenshotListItem(item: TimelineApiItem): ScreenshotListItem {
  const linkedRisks = extractLinkedRisks(item);
  const details = asRecord(item.details_json);
  const changeMetrics = extractChangeMetrics(
    item,
    asRecord(item.change),
    asRecord(item.diff),
    details,
    asRecord(item.diff_metrics),
    asRecord(item.change_metrics),
    asRecord(item.metadata)
  );
  const noChangeStreakTriggered = linkedRisks.some((risk) => risk.noChangeStreakTriggered);

  return {
    id: item.screenshot_id ?? `frame-${item.time ?? Date.now()}`,
    capturedAt: item.time ?? '--',
    thumbUri:
      firstString(item.thumbnail_url, item.thumb_uri, readString(details, ['thumbnail_url', 'thumb_uri'])) ??
      null,
    imageUri:
      firstString(
        item.image_uri,
        item.image_url,
        item.full_image_url,
        readString(details, ['image_url', 'full_image_url', 'image_uri'])
      ) ?? null,
    activityType: firstString(item.activity_type, readString(details, ['activity_type'])) ?? 'unknown',
    changeLevel: changeMetrics.changeLevel,
    keyboardCount: readNumber(item, ['keyboard_count']) ?? readNumber(details, ['keyboard_count']) ?? 0,
    mouseCount: readNumber(item, ['mouse_count']) ?? readNumber(details, ['mouse_count']) ?? 0,
    riskCount: linkedRisks.length,
    riskSummary:
      linkedRisks.map((risk) => risk.type).join(', ') ||
      firstString(changeMetrics.reason, 'No linked risk events') ||
      'No linked risk events',
    changeMetrics,
    linkedRisks,
    noChangeStreakTriggered
  };
}

function buildDashboardKpis(eventItems: EventRecord[]): KpiMetric[] {
  const noChangeCount = eventItems.filter((item) => item.noChangeStreakTriggered).length;
  const reviewableCount = eventItems.filter((item) => item.status === 'new' || item.status === 'reviewing').length;

  return dashboardKpis.map((metric) => {
    if (metric.key !== 'risk') {
      return metric;
    }

    return {
      ...metric,
      title: 'High-risk events',
      value: String(reviewableCount),
      delta: noChangeCount > 0 ? `${noChangeCount} no-change streak` : 'No no-change streak',
      tone: noChangeCount > 0 ? 'warning' : 'positive'
    };
  });
}

function buildTimelineKpis(screenshots: ScreenshotListItem[]): KpiMetric[] {
  if (screenshots.length === 0) {
    return [
      { key: 'frames', title: 'Timeline frames', value: '0', delta: 'no data', tone: 'default' },
      { key: 'effective', title: 'Effective changes', value: '0', delta: '0%', tone: 'default' },
      { key: 'no-change', title: 'No-change streak risks', value: '0', delta: 'clear', tone: 'positive' },
      { key: 'input', title: 'Aggregate input', value: '0', delta: 'keyboard 0 / mouse 0', tone: 'default' }
    ];
  }

  const effectiveChanges = screenshots.filter((item) => item.changeMetrics.effectiveChange === true).length;
  const noChangeRisks = screenshots.filter((item) => item.noChangeStreakTriggered).length;
  const keyboardCount = screenshots.reduce((sum, item) => sum + item.keyboardCount, 0);
  const mouseCount = screenshots.reduce((sum, item) => sum + item.mouseCount, 0);

  return [
    {
      key: 'frames',
      title: 'Timeline frames',
      value: String(screenshots.length),
      delta: 'live',
      tone: 'positive'
    },
    {
      key: 'effective',
      title: 'Effective changes',
      value: String(effectiveChanges),
      delta: `${Math.round((effectiveChanges / screenshots.length) * 100)}%`,
      tone: effectiveChanges > 0 ? 'positive' : 'default'
    },
    {
      key: 'no-change',
      title: 'No-change streak risks',
      value: String(noChangeRisks),
      delta: noChangeRisks > 0 ? 'review needed' : 'clear',
      tone: noChangeRisks > 0 ? 'warning' : 'positive'
    },
    {
      key: 'input',
      title: 'Aggregate input',
      value: String(keyboardCount + mouseCount),
      delta: `keyboard ${keyboardCount} / mouse ${mouseCount}`,
      tone: 'default'
    }
  ];
}

function buildMockTimeline(selectedDate: string) {
  const frames: ScreenshotListItem[] = [
    buildMockScreenshot({
      id: 'mock-1',
      time: `${selectedDate} 09:10`,
      activityType: 'Coding',
      keyboardCount: 28,
      mouseCount: 12,
      changeLevel: 'high',
      effectiveChange: true,
      changedBlockRatio: 0.24,
      similarity: 0.86,
      distance: 11,
      reason: 'Editor and terminal regions changed together.'
    }),
    buildMockScreenshot({
      id: 'mock-2',
      time: `${selectedDate} 10:00`,
      activityType: 'Code review',
      keyboardCount: 10,
      mouseCount: 16,
      changeLevel: 'medium',
      effectiveChange: true,
      changedBlockRatio: 0.15,
      similarity: 0.92,
      distance: 7,
      reason: 'Review comments and diff pane changed.'
    }),
    buildMockScreenshot({
      id: 'mock-3',
      time: `${selectedDate} 11:25`,
      activityType: 'Meeting',
      keyboardCount: 3,
      mouseCount: 4,
      changeLevel: 'low',
      effectiveChange: true,
      changedBlockRatio: 0.09,
      similarity: 0.96,
      distance: 4,
      reason: 'Meeting window controls and participant tiles changed.'
    }),
    buildMockScreenshot({
      id: 'mock-4',
      time: `${selectedDate} 14:05`,
      activityType: 'IDE foreground',
      keyboardCount: 1,
      mouseCount: 2,
      changeLevel: 'low',
      effectiveChange: false,
      changedBlockRatio: 0.031,
      similarity: 0.992,
      distance: 2,
      reason: 'Only cursor and clock regions changed across repeated captures.',
      linkedRisks: [
        {
          id: 'mock-risk-1',
          type: 'No-change streak triggered',
          severity: 'high',
          status: 'reviewing',
          reason: 'Repeated low-diff screenshots with near-zero aggregate input.',
          streakCount: 6,
          noChangeStreakTriggered: true
        }
      ]
    }),
    buildMockScreenshot({
      id: 'mock-5',
      time: `${selectedDate} 15:10`,
      activityType: 'Recovered work',
      keyboardCount: 18,
      mouseCount: 9,
      changeLevel: 'medium',
      effectiveChange: true,
      changedBlockRatio: 0.18,
      similarity: 0.9,
      distance: 8,
      reason: 'Terminal output and code editor resumed changing.'
    }),
    buildMockScreenshot({
      id: 'mock-6',
      time: `${selectedDate} 16:02`,
      activityType: 'Documentation',
      keyboardCount: 4,
      mouseCount: 7,
      changeLevel: 'low',
      effectiveChange: false,
      changedBlockRatio: 0.055,
      similarity: 0.984,
      distance: 3,
      reason: 'Document stayed open with only small viewport movement.'
    })
  ];

  return {
    employeeLabel: 'Mock employee',
    screenshots: frames,
    segments: frames.map(mapMockFrameToSegment)
  };
}

function buildMockScreenshot(input: {
  id: string;
  time: string;
  activityType: string;
  keyboardCount: number;
  mouseCount: number;
  changeLevel: string;
  effectiveChange: boolean;
  changedBlockRatio: number;
  similarity: number;
  distance: number;
  reason: string;
  linkedRisks?: LinkedRiskRecord[];
}): ScreenshotListItem {
  const linkedRisks = input.linkedRisks ?? [];
  const changeMetrics: ChangeMetrics = {
    changeLevel: input.changeLevel,
    effectiveChange: input.effectiveChange,
    changedBlockRatio: input.changedBlockRatio,
    similarity: input.similarity,
    distance: input.distance,
    reason: input.reason
  };

  return {
    id: input.id,
    capturedAt: input.time,
    thumbUri: null,
    imageUri: null,
    activityType: input.activityType,
    changeLevel: input.changeLevel,
    keyboardCount: input.keyboardCount,
    mouseCount: input.mouseCount,
    riskCount: linkedRisks.length,
    riskSummary: linkedRisks.map((risk) => risk.type).join(', ') || input.reason,
    changeMetrics,
    linkedRisks,
    noChangeStreakTriggered: linkedRisks.some((risk) => risk.noChangeStreakTriggered)
  };
}

function mapMockFrameToSegment(item: ScreenshotListItem): TimelineSegment {
  return {
    time: item.capturedAt.split(' ').pop() ?? item.capturedAt,
    label: item.noChangeStreakTriggered ? 'No-change streak triggered' : item.activityType,
    detail: buildScreenshotDetailLine(item),
    status: item.noChangeStreakTriggered
      ? 'risk'
      : item.changeMetrics.effectiveChange
        ? item.activityType.toLowerCase().includes('meeting')
          ? 'meeting'
          : 'working'
        : 'idle',
    changeMetrics: item.changeMetrics,
    linkedRiskCount: item.riskCount,
    noChangeStreakTriggered: item.noChangeStreakTriggered
  };
}

function buildMockEventRecords(): EventRecord[] {
  return events.map((item) => {
    if (item.id === 'EVT-1024') {
      return {
        ...item,
        eventCode: 'no_change_streak_triggered',
        relatedScreenshotId: 'mock-4',
        streakCount: 6,
        noChangeStreakTriggered: true,
        changeMetrics: {
          changeLevel: 'low',
          effectiveChange: false,
          changedBlockRatio: 0.031,
          similarity: 0.992,
          distance: 2,
          reason: 'Repeated low-diff screenshots with near-zero aggregate input.'
        }
      };
    }

    if (item.id === 'EVT-1023') {
      return {
        ...item,
        eventCode: 'unexpected_app_focus',
        changeMetrics: {
          changeLevel: 'medium',
          effectiveChange: true,
          changedBlockRatio: 0.17,
          similarity: 0.91,
          distance: 9,
          reason: 'Foreground application changed away from expected work tools.'
        }
      };
    }

    return item;
  });
}

function buildDeviceMetadataLabels(
  item: DeviceApiItem,
  ...sources: Array<Record<string, unknown> | undefined>
) {
  const labels: string[] = [];
  const remote =
    firstBooleanFromSources([item, ...sources].filter((source): source is Record<string, unknown> => Boolean(source)), [
      'is_remote_session',
      'is_rdp_session',
      'remote_session',
      'rdp',
      'is_rdp'
    ]) ?? false;
  const locked =
    firstBooleanFromSources([item, ...sources].filter((source): source is Record<string, unknown> => Boolean(source)), [
      'is_locked',
      'locked'
    ]) ?? false;
  const idleSeconds = readNumberFromSources(
    [item, ...sources].filter((source): source is Record<string, unknown> => Boolean(source)),
    ['idle_seconds', 'idleSeconds', 'user_idle_seconds']
  );
  const inputDesktop = firstStringFromSources(
    [item, ...sources].filter((source): source is Record<string, unknown> => Boolean(source)),
    ['input_desktop_name', 'input_desktop', 'input_desktop_state', 'desktop_state']
  );
  const sessionState = firstStringFromSources(
    [item, ...sources].filter((source): source is Record<string, unknown> => Boolean(source)),
    ['session_connect_state', 'session_state', 'session_type', 'desktop_session_state']
  );
  const windowSwitches = readNumberFromSources(
    [item, ...sources].filter((source): source is Record<string, unknown> => Boolean(source)),
    ['window_switches', 'window_switch_count', 'app_switches']
  );
  const mouseWheel = readNumberFromSources(
    [item, ...sources].filter((source): source is Record<string, unknown> => Boolean(source)),
    ['mouse_wheel', 'mouse_wheel_count', 'wheel_count']
  );

  if (remote) {
    labels.push('Remote session');
  }

  if (locked) {
    labels.push('Locked');
  }

  if (idleSeconds !== undefined) {
    labels.push(`Idle ${formatDurationSeconds(idleSeconds)}`);
  }

  if (inputDesktop) {
    labels.push(`Desktop ${formatLabel(inputDesktop)}`);
  }

  if (sessionState) {
    labels.push(`Session ${formatLabel(sessionState)}`);
  }

  if (windowSwitches !== undefined) {
    labels.push(`Switches ${windowSwitches}`);
  }

  if (mouseWheel !== undefined) {
    labels.push(`Wheel ${mouseWheel}`);
  }

  return labels;
}

function resolvePolicyStatus(item: PolicyApiItem, rules?: Record<string, unknown>) {
  const rawStatus = readString(item, ['status', 'state']) ?? readString(rules, ['status', 'state']);
  if (rawStatus) {
    return rawStatus;
  }

  if (item.is_active === true) {
    return 'active';
  }

  if (item.is_active === false) {
    return 'inactive';
  }

  return 'draft';
}

function buildTimelineStatus(
  item: TimelineApiItem,
  linkedRisks: LinkedRiskRecord[],
  changeMetrics: ChangeMetrics
): TimelineSegment['status'] {
  if (linkedRisks.length > 0) {
    return 'risk';
  }

  const activity = firstString(item.activity_type, readString(asRecord(item.details_json), ['activity_type'])) ?? '';
  if (activity.toLowerCase().includes('meeting')) {
    return 'meeting';
  }

  if (changeMetrics.effectiveChange === false) {
    return 'idle';
  }

  return 'working';
}

function buildTimelineLabel(
  item: TimelineApiItem,
  changeMetrics: ChangeMetrics,
  noChangeStreakTriggered: boolean
) {
  if (noChangeStreakTriggered) {
    return 'No-change streak triggered';
  }

  const activity = firstString(item.activity_type, readString(asRecord(item.details_json), ['activity_type']));
  if (activity && activity !== 'unknown') {
    return formatLabel(activity);
  }

  return `Change ${formatLabel(changeMetrics.changeLevel)}`;
}

function buildTimelineDetail(
  item: TimelineApiItem,
  linkedRisks: LinkedRiskRecord[],
  changeMetrics: ChangeMetrics
) {
  const keyboardCount =
    readNumber(item, ['keyboard_count']) ?? readNumber(asRecord(item.details_json), ['keyboard_count']) ?? 0;
  const mouseCount =
    readNumber(item, ['mouse_count']) ?? readNumber(asRecord(item.details_json), ['mouse_count']) ?? 0;
  const riskText =
    linkedRisks.length > 0 ? linkedRisks.map((risk) => risk.type).join(', ') : 'No linked risk events';

  return [
    `Keyboard ${keyboardCount}`,
    `Mouse ${mouseCount}`,
    `Changed blocks ${formatPercent(changeMetrics.changedBlockRatio) ?? '--'}`,
    `Similarity ${formatNumber(changeMetrics.similarity, 3) ?? '--'}`,
    riskText
  ].join(' / ');
}

function buildScreenshotDetailMetrics(item: ScreenshotListItem) {
  const metrics = [
    {
      label: 'Change level',
      value: formatLabel(item.changeMetrics.changeLevel),
      hint: 'Normalized from live or mock screenshot diff fields.'
    },
    {
      label: 'Effective change',
      value:
        item.changeMetrics.effectiveChange === null
          ? 'Unknown'
          : item.changeMetrics.effectiveChange
            ? 'Yes'
            : 'No',
      hint: 'Shows whether the capture should count as valid work-state change.'
    },
    {
      label: 'Changed block ratio',
      value: formatPercent(item.changeMetrics.changedBlockRatio) ?? '--',
      hint: 'Portion of blocks that changed between adjacent screenshots.'
    },
    {
      label: 'Similarity',
      value: formatNumber(item.changeMetrics.similarity, 3) ?? '--',
      hint: 'Higher values generally mean the screenshots are more alike.'
    },
    {
      label: 'Distance',
      value: formatNumber(item.changeMetrics.distance, 2) ?? '--',
      hint: 'Distance-style diff metric from the backend when available.'
    },
    {
      label: 'Keyboard / Mouse',
      value: `${item.keyboardCount} / ${item.mouseCount}`,
      hint: 'Aggregate counters only. No raw keystrokes or content are stored.'
    },
    {
      label: 'Reason',
      value: item.changeMetrics.reason || '--',
      hint: 'Backend-compatible reason text shown defensively when present.'
    }
  ];

  if (item.linkedRisks.length > 0) {
    metrics.push({
      label: 'Linked risks',
      value: String(item.linkedRisks.length),
      hint: item.linkedRisks.map((risk) => risk.type).join(', ')
    });
  }

  return metrics;
}

function buildScreenshotReasoning(current: ScreenshotListItem, previous?: ScreenshotListItem) {
  const notes = [
    `Screenshot ID: ${current.id}`,
    `Activity type: ${current.activityType || 'unknown'}`,
    previous
      ? `Compared against previous frame at ${previous.capturedAt}`
      : 'No previous frame is available from the current source.',
    current.noChangeStreakTriggered
      ? 'This frame is linked to a no-change streak risk and should be reviewed in context.'
      : 'No no-change streak risk is linked to this frame.'
  ];

  if (current.changeMetrics.reason) {
    notes.push(`Diff reason: ${current.changeMetrics.reason}`);
  }

  return notes;
}

function buildScreenshotDetailLine(item: ScreenshotListItem) {
  return [
    item.changeMetrics.reason,
    `changed blocks ${formatPercent(item.changeMetrics.changedBlockRatio) ?? '--'}`,
    `keyboard ${item.keyboardCount}`,
    `mouse ${item.mouseCount}`
  ].join(' / ');
}

function extractLinkedRisks(item: TimelineApiItem): LinkedRiskRecord[] {
  const candidates = Array.isArray(item.risk_events)
    ? item.risk_events
    : Array.isArray(item.events)
      ? item.events
      : [];

  return candidates
    .map((riskItem, index) => mapLinkedRisk(riskItem, index))
    .filter((risk): risk is LinkedRiskRecord => risk !== null);
}

function mapLinkedRisk(riskItem: unknown, index: number): LinkedRiskRecord | null {
  const record = asRecord(riskItem);
  if (!record) {
    return null;
  }

  const rawType =
    firstString(
      readString(record, ['event_type', 'type', 'rule_name', 'event_code', 'code']),
      `risk-${index + 1}`
    ) ?? `risk-${index + 1}`;
  const noChangeStreakTriggered =
    isNoChangeEventCode(rawType) ||
    readBoolean(record, ['no_change_streak_triggered', 'streak_triggered']) === true;

  return {
    id: readString(record, ['id']) ?? `risk-${index + 1}`,
    type: noChangeStreakTriggered ? 'No-change streak triggered' : formatLabel(rawType),
    severity: normalizeSeverity(readString(record, ['severity']) ?? 'medium'),
    status: normalizeEventStatus(readString(record, ['status']) ?? 'new'),
    reason:
      firstString(readString(record, ['reason', 'summary', 'description']), 'Linked risk from timeline') ??
      'Linked risk from timeline',
    streakCount: readNumber(record, ['streak_count', 'no_change_streak_count']) ?? null,
    noChangeStreakTriggered
  };
}

function extractChangeMetrics(...sources: Array<Record<string, unknown> | undefined>): ChangeMetrics {
  const relevant = sources.filter((source): source is Record<string, unknown> => Boolean(source));
  const level =
    firstStringFromSources(relevant, ['change_level', 'level']) ??
    deriveChangeLevel(
      readNumberFromSources(relevant, ['changed_block_ratio', 'change_block_ratio', 'diff_block_ratio']),
      readNumberFromSources(relevant, ['similarity', 'similarity_score', 'ssim']),
      readNumberFromSources(relevant, ['distance', 'phash_distance', 'hash_distance'])
    );
  const effectiveChange =
    firstBooleanFromSources(relevant, [
      'is_effective_change',
      'effective',
      'effective_change',
      'valid_change',
      'is_valid_change'
    ]) ?? null;

  return {
    changeLevel: level ?? 'unknown',
    effectiveChange,
    changedBlockRatio:
      normalizeRatio(
        readNumberFromSources(relevant, [
          'changed_block_ratio',
          'change_block_ratio',
          'diff_block_ratio'
        ])
      ) ?? null,
    similarity:
      readNumberFromSources(relevant, ['similarity', 'similarity_score', 'ssim_score', 'ssim', 'similarity_index']) ?? null,
    distance: readNumberFromSources(relevant, ['distance', 'phash_distance', 'hash_distance']) ?? null,
    reason:
      firstStringFromSources(relevant, ['reason', 'change_reason', 'diff_reason', 'summary', 'description']) ?? ''
  };
}

function compareEvents(left: EventRecord, right: EventRecord) {
  const leftPriority = (left.noChangeStreakTriggered ? 100 : 0) + severityWeight(left.severity);
  const rightPriority = (right.noChangeStreakTriggered ? 100 : 0) + severityWeight(right.severity);

  return rightPriority - leftPriority;
}

function severityWeight(value: EventSeverity) {
  switch (value) {
    case 'critical':
      return 40;
    case 'high':
      return 30;
    case 'medium':
      return 20;
    default:
      return 10;
  }
}

function normalizeListStatus(status?: string | null) {
  if (!status) {
    return undefined;
  }

  const normalized = status.trim().toLowerCase();
  if (normalized === 'enabled') {
    return 'active';
  }

  if (normalized === 'disabled') {
    return 'inactive';
  }

  return normalized;
}

function deriveChangeLevel(
  blockRatio?: number,
  similarity?: number,
  distance?: number
): string | undefined {
  if (blockRatio !== undefined) {
    const normalizedRatio = normalizeRatio(blockRatio) ?? blockRatio;

    if (normalizedRatio >= 0.2) {
      return 'high';
    }

    if (normalizedRatio >= 0.08) {
      return 'medium';
    }

    return 'low';
  }

  if (similarity !== undefined) {
    if (similarity >= 0.985) {
      return 'low';
    }

    if (similarity >= 0.93) {
      return 'medium';
    }

    return 'high';
  }

  if (distance !== undefined) {
    if (distance <= 2) {
      return 'low';
    }

    if (distance <= 7) {
      return 'medium';
    }

    return 'high';
  }

  return undefined;
}

function isNoChangeEventCode(value?: string | null) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes('no_change_streak_triggered') ||
    normalized.includes('continuous_no_change') ||
    normalized.includes('no_change') ||
    normalized.includes('streak_triggered')
  );
}

function normalizeDeviceStatus(status?: string) {
  if (status === 'online' || status === 'offline' || status === 'warning') {
    return status;
  }

  return 'warning';
}

function normalizeEventStatus(status: string): EventStatus {
  if (status === 'new' || status === 'reviewing' || status === 'confirmed' || status === 'ignored' || status === 'closed') {
    return status;
  }

  if (status === 'open') {
    return 'reviewing';
  }

  return 'new';
}

function normalizeSeverity(severity: string): EventSeverity {
  if (severity === 'low' || severity === 'medium' || severity === 'high' || severity === 'critical') {
    return severity;
  }

  return 'medium';
}

function normalizeRatio(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return undefined;
  }

  return value > 1 ? value / 100 : value;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '--';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatDurationSeconds(value?: number | null) {
  if (value === undefined || value === null) {
    return '--';
  }

  if (value < 60) {
    return `${value}s`;
  }

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function summarizeDetails(details?: Record<string, unknown>) {
  if (!details) {
    return '';
  }

  return Object.entries(details)
    .filter(([, value]) => !Array.isArray(value) && typeof value !== 'object')
    .slice(0, 3)
    .map(([key, value]) => `${formatLabel(key)}: ${String(value)}`)
    .join(' | ');
}

function shortenUuid(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function nestedRecord(source: Record<string, unknown> | undefined, key: string) {
  return source ? asRecord(source[key]) : undefined;
}

function pickRecords(
  source: Record<string, unknown> | undefined,
  keys: string[]
): Record<string, unknown> | undefined {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = asRecord(source[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function readString(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function readArray(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return undefined;
}

function readStringArray(source: Record<string, unknown> | undefined, keys: string[]) {
  const values = readArray(source, keys);
  if (!values) {
    return undefined;
  }

  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
}

function readNumber(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function readBoolean(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      if (value === 'true') {
        return true;
      }

      if (value === 'false') {
        return false;
      }
    }
  }

  return undefined;
}

function firstString(...values: Array<string | undefined | null>) {
  return values.find((value) => typeof value === 'string' && value.trim()) ?? undefined;
}

function collectStringList(...lists: Array<string[] | undefined>) {
  return Array.from(new Set(lists.flatMap((list) => list ?? []).filter(Boolean)));
}

function firstStringFromSources(sources: Record<string, unknown>[], keys: string[]) {
  for (const source of sources) {
    const value = readString(source, keys);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function readNumberFromSources(sources: Record<string, unknown>[], keys: string[]) {
  for (const source of sources) {
    const value = readNumber(source, keys);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function firstBooleanFromSources(sources: Record<string, unknown>[], keys: string[]) {
  for (const source of sources) {
    const value = readBoolean(source, keys);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function formatLabel(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatPercent(value?: number | null) {
  const normalized = normalizeRatio(value);
  if (normalized === undefined) {
    return null;
  }

  const percentage = normalized * 100;
  return `${percentage.toFixed(percentage >= 10 ? 0 : 1)}%`;
}

function formatNumber(value?: number | null, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }

  return value.toFixed(digits);
}
