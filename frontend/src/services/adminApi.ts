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
  timelineKpis,
  timelineSegments,
  workStatusSeries
} from '../mock/data';
import { apiClient, getErrorMessage } from './apiClient';
import type {
  ApiResult,
  ApiStatus,
  BackendHealth,
  DeviceRecord,
  EventRecord,
  KpiMetric,
  RealtimeStatusRecord,
  ScreenshotComparison,
  ScreenshotListItem,
  TimelineSegment
} from '../types/models';

type DashboardData = {
  kpis: typeof dashboardKpis;
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

type DeviceListData = ApiResult<DeviceRecord[]>;

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
  streak_count: number;
  status: string;
  reason?: string | null;
  details_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type EventApiListResponse = {
  items: EventApiItem[];
  total: number;
};

type TimelineApiRiskEvent = {
  id: string;
  event_type: string;
  severity: string;
  status: string;
};

type TimelineApiItem = {
  time: string;
  screenshot_id: string;
  thumbnail_url?: string | null;
  activity_type: string;
  change_level: string;
  keyboard_count: number;
  mouse_count: number;
  risk_events: TimelineApiRiskEvent[];
};

type TimelineApiResponse = {
  employee_id: string;
  date: string;
  items: TimelineApiItem[];
};

type DeviceApiItem = {
  id?: string;
  hostname?: string;
  employee_name?: string;
  os_type?: string;
  agent_version?: string;
  last_heartbeat_at?: string | null;
  status?: string;
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
    const [eventResult, backendHealth] = await Promise.all([
      this.getEvents(),
      this.getHealth()
    ]);

    return {
      kpis: dashboardKpis,
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

  async getEmployees() {
    return Promise.resolve(employees);
  },

  async getDevices(): Promise<DeviceListData> {
    try {
      const payload = await apiClient<DeviceApiItem[] | { items: DeviceApiItem[] }>('/api/devices');
      const items = Array.isArray(payload) ? payload : payload.items;

      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Devices payload is empty');
      }

      return {
        data: items.map((item, index) => ({
          key: item.id ?? String(index),
          deviceName: item.hostname ?? `device-${index + 1}`,
          employee: item.employee_name ?? 'Unknown',
          os: item.os_type ?? 'Unknown',
          agentVersion: item.agent_version ?? '--',
          lastHeartbeat: formatDateTime(item.last_heartbeat_at),
          status: normalizeDeviceStatus(item.status)
        })),
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

    if (!discoveredEmployeeId) {
      return {
        kpis: timelineKpis,
        segments: timelineSegments,
        screenshots: buildMockScreenshotList(),
        apiStatus: fallbackStatus(
          '/api/employees/{employee_id}/timeline',
          'No employee_id could be discovered from live data'
        ),
        employeeLabel: 'Mock employee',
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
        kpis: timelineKpis,
        segments: timelineSegments,
        screenshots: buildMockScreenshotList(),
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
        data: payload.items.map(mapEventRecord),
        apiStatus: liveStatus('/api/events', `Loaded ${payload.total} events`)
      };
    } catch (error) {
      return {
        data: events,
        apiStatus: fallbackStatus('/api/events', getErrorMessage(error))
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
      metrics: [
        {
          label: 'Change level',
          value: current.changeLevel,
          hint: 'Derived from the employee timeline API'
        },
        {
          label: 'Keyboard / Mouse',
          value: `${current.keyboardCount} / ${current.mouseCount}`,
          hint: 'Input counters captured for this screenshot'
        },
        {
          label: 'Risk events',
          value: String(current.riskCount),
          hint: current.riskSummary || 'No linked risk events'
        }
      ],
      reasoning: [
        `Screenshot ID: ${current.id}`,
        `Activity type: ${current.activityType || 'unknown'}`,
        previous
          ? `Compared against previous frame at ${previous.capturedAt}`
          : 'No previous frame is available from the live API'
      ],
      apiStatus: timeline.apiStatus
    };
  },

  async getPolicies() {
    return Promise.resolve(policies);
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

function mapEventRecord(item: EventApiItem, index: number): EventRecord {
  return {
    id: item.id,
    employee: shortenUuid(item.employee_id),
    department: 'API',
    type: item.event_type,
    severity: normalizeSeverity(item.severity),
    status: normalizeEventStatus(item.status),
    startedAt: formatDateTime(item.start_at),
    duration: formatDurationSeconds(item.duration_seconds),
    summary: item.reason || summarizeDetails(item.details_json) || `Device ${shortenUuid(item.device_id)}`,
  };
}

function mapTimelineSegment(item: TimelineApiItem): TimelineSegment {
  return {
    time: item.time,
    label: buildTimelineLabel(item),
    detail: buildTimelineDetail(item),
    status: buildTimelineStatus(item)
  };
}

function mapScreenshotListItem(item: TimelineApiItem): ScreenshotListItem {
  return {
    id: item.screenshot_id,
    capturedAt: item.time,
    thumbUri: item.thumbnail_url ?? null,
    imageUri: null,
    activityType: item.activity_type,
    changeLevel: item.change_level,
    keyboardCount: item.keyboard_count,
    mouseCount: item.mouse_count,
    riskCount: item.risk_events.length,
    riskSummary:
      item.risk_events.map((riskEvent) => `${riskEvent.event_type} (${riskEvent.severity})`).join(', ') ||
      'No linked risk events'
  };
}

function buildTimelineKpis(screenshots: ScreenshotListItem[]): KpiMetric[] {
  if (screenshots.length === 0) {
    return [
      { key: 'frames', title: 'Timeline frames', value: '0', delta: 'live', tone: 'default' },
      { key: 'risk', title: 'Risk frames', value: '0', delta: 'live', tone: 'default' },
      { key: 'keyboard', title: 'Keyboard', value: '0', delta: 'live', tone: 'default' },
      { key: 'mouse', title: 'Mouse', value: '0', delta: 'live', tone: 'default' }
    ];
  }

  const riskFrames = screenshots.filter((item) => item.riskCount > 0).length;
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
      key: 'risk',
      title: 'Risk frames',
      value: String(riskFrames),
      delta: `${Math.round((riskFrames / screenshots.length) * 100)}%`,
      tone: riskFrames > 0 ? 'warning' : 'positive'
    },
    {
      key: 'keyboard',
      title: 'Keyboard',
      value: String(keyboardCount),
      delta: 'captured',
      tone: 'default'
    },
    {
      key: 'mouse',
      title: 'Mouse',
      value: String(mouseCount),
      delta: 'captured',
      tone: 'default'
    }
  ];
}

function buildMockScreenshotList(): ScreenshotListItem[] {
  return timelineSegments.map((segment, index) => ({
    id: `mock-${index + 1}`,
    capturedAt: segment.time,
    thumbUri: null,
    imageUri: null,
    activityType: segment.label,
    changeLevel: segment.status === 'risk' ? 'high' : 'unknown',
    keyboardCount: 0,
    mouseCount: 0,
    riskCount: segment.status === 'risk' ? 1 : 0,
    riskSummary: segment.detail
  }));
}

function buildTimelineStatus(item: TimelineApiItem): TimelineSegment['status'] {
  if (item.risk_events.length > 0) {
    return 'risk';
  }

  const activity = item.activity_type.toLowerCase();
  if (activity.includes('meeting')) {
    return 'meeting';
  }

  if (item.keyboard_count === 0 && item.mouse_count === 0) {
    return 'idle';
  }

  return 'working';
}

function buildTimelineLabel(item: TimelineApiItem) {
  if (item.activity_type && item.activity_type !== 'unknown') {
    return item.activity_type;
  }

  return `Change ${item.change_level}`;
}

function buildTimelineDetail(item: TimelineApiItem) {
  const riskText = item.risk_events.length > 0 ? `${item.risk_events.length} linked risk events` : 'No linked risk events';
  return `Keyboard ${item.keyboard_count}, Mouse ${item.mouse_count}, ${riskText}`;
}

function shortenUuid(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
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

function summarizeDetails(details: Record<string, unknown>) {
  const entries = Object.entries(details);

  if (entries.length === 0) {
    return '';
  }

  return entries
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' | ');
}

function normalizeDeviceStatus(status?: string) {
  if (status === 'online' || status === 'offline' || status === 'warning') {
    return status;
  }

  return 'warning';
}

function normalizeEventStatus(status: string): EventRecord['status'] {
  if (status === 'new' || status === 'reviewing' || status === 'confirmed' || status === 'ignored' || status === 'closed') {
    return status;
  }

  if (status === 'open') {
    return 'reviewing';
  }

  return 'new';
}

function normalizeSeverity(severity: string): EventRecord['severity'] {
  if (severity === 'low' || severity === 'medium' || severity === 'high' || severity === 'critical') {
    return severity;
  }

  return 'medium';
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
