import {
  auditLogs,
  attendanceRecords,
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
import { ApiClientError, apiClient, getErrorMessage } from './apiClient';
import type {
  AccessMatrixRecord,
  AttendanceRecord,
  AttendanceRuleSummary,
  AttendanceRuleUpdateInput,
  AttendanceReviewStatus,
  AuthIdentity,
  AuthSessionSeed,
  ApiResult,
  ApiStatus,
  AuditLogRecord,
  BackendHealth,
  ChangeMetrics,
  DeviceRecord,
  EmployeeRecord,
  EmployeeImportSummary,
  EventRecord,
  EventSeverity,
  EventStatus,
  HeatmapPoint,
  KpiMetric,
  LinkedRiskRecord,
  PolicyMutationInput,
  PolicyRecord,
  RealtimeStatusRecord,
  RiskScoreRecord,
  ScreenshotComparison,
  ScreenshotListItem,
  StatusBucket,
  TimelineSegment
} from '../types/models';

type DashboardData = {
  kpis: KpiMetric[];
  workStatusSeries: StatusBucket[];
  employeeHeatmap: HeatmapPoint[];
  riskScores: RiskScoreRecord[];
  accessMatrix: AccessMatrixRecord[];
  dashboardApiStatus: ApiStatus;
  riskApiStatus: ApiStatus;
  accessApiStatus: ApiStatus;
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
type DeviceTokenIssueResult = {
  apiStatus: ApiStatus;
  deviceId?: string;
  token?: string;
  errorCode?: 'forbidden' | 'not_found' | 'unavailable';
};
type DeviceTokenRevokeResult = {
  apiStatus: ApiStatus;
  deviceId?: string;
  revokedAt?: string;
  errorCode?: 'forbidden' | 'not_found' | 'unavailable';
};
type PolicyListData = ApiResult<PolicyRecord[]>;
type AuditLogListData = ApiResult<AuditLogRecord[]>;
type AttendanceListData = ApiResult<AttendanceRecord[]>;
type AttendanceRuleSummaryData = ApiResult<AttendanceRuleSummary>;
type AttendanceRuleMutationResult = {
  apiStatus: ApiStatus;
  data?: AttendanceRuleSummary;
  errorCode?: 'forbidden' | 'not_found' | 'invalid' | 'unavailable';
};
type AttendanceReviewResult = { apiStatus: ApiStatus; records?: AttendanceRecord[] };
type DashboardSummaryData = ApiResult<{
  kpis: KpiMetric[];
  workStatusSeries: StatusBucket[];
}>;
type RiskScoreListData = ApiResult<RiskScoreRecord[]>;
type AccessMatrixListData = ApiResult<AccessMatrixRecord[]>;
type PolicyMutationResult = { apiStatus: ApiStatus; data?: PolicyRecord[] };
type AuthResult<T> = {
  data?: T;
  apiStatus: ApiStatus;
  unauthorized?: boolean;
};
type EmployeeImportMutationResult = {
  data?: EmployeeImportSummary;
  apiStatus: ApiStatus;
};
type EmployeeExportResult = {
  blob?: Blob;
  filename?: string;
  apiStatus: ApiStatus;
};
type PolicyStateAction = 'activate' | 'deactivate' | 'set_active';
type PolicyMutationAttempt = {
  path: string;
  method: 'POST' | 'PUT';
  body?: unknown;
};

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

type AuditLogApiItem = Record<string, unknown> & {
  id?: string;
  operator?: string;
  action?: string;
  target?: string;
  reason?: string;
  result?: string;
  timestamp?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
  details_json?: Record<string, unknown>;
};

type AttendanceApiItem = Record<string, unknown> & {
  id?: string;
  employee_name?: string | null;
  employee_no?: string | null;
  department?: string | null;
  user_name?: string;
  machine_name?: string | null;
  event_type?: string;
  occurred_at?: string;
  work_date?: string | null;
  anomaly_status?: string;
  anomaly_reasons?: string[];
  review_status?: string;
  review_note?: string | null;
  source?: string;
};

type HealthPayload = {
  status: string;
  app_name?: string;
  environment?: string;
};

type AuthLoginPayload = Record<string, unknown>;
type AuthMePayload = Record<string, unknown>;

type TimelineQuery = {
  employeeId?: string;
  date?: string;
};

type ScreenshotDetailQuery = TimelineQuery & {
  screenshotId?: string;
};

const today = getLocalDateString();
const defaultAttendanceRuleSummary: AttendanceRuleSummary = {
  key: 'default-attendance-rule',
  name: 'Default attendance rule',
  lateThreshold: '09:30',
  earlyLeaveThreshold: '18:00',
  timezone: 'Local time',
  sourceLabel: 'Fallback defaults'
};

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
  async login(identifier: string, password: string): Promise<AuthResult<AuthSessionSeed>> {
    const endpoint = '/api/auth/login';

    try {
      const payload = await apiClient<AuthLoginPayload>(endpoint, {
        method: 'POST',
        auth: 'omit',
        body: {
          username: identifier,
          identifier,
          email: identifier,
          password
        }
      });
      const token = extractAuthToken(payload);
      const user = mapAuthIdentity(payload, identifier);

      if (!token || !user) {
        throw new Error('Login response did not contain a usable bearer token and user profile');
      }

      return {
        data: {
          token,
          user,
          source: 'live'
        },
        apiStatus: liveStatus(endpoint, `Authenticated as ${user.displayName}`)
      };
    } catch (error) {
      const message = getErrorMessage(error);
      const status = readErrorStatus(error);

      return {
        apiStatus: unavailableStatus(endpoint, message),
        unauthorized: status === 401 || status === 403
      };
    }
  },

  async getCurrentUser(): Promise<AuthResult<AuthIdentity>> {
    const endpoints = ['/api/auth/me', '/api/me'];
    let lastError: unknown;

    for (const endpoint of endpoints) {
      try {
        const payload = await apiClient<AuthMePayload>(endpoint);
        const user = mapAuthIdentity(payload);

        if (!user) {
          throw new Error('Current user response did not contain a usable profile');
        }

        return {
          data: user,
          apiStatus: liveStatus(endpoint, `Loaded ${user.displayName}`)
        };
      } catch (error) {
        lastError = error;

        if (readErrorStatus(error) === 401 || readErrorStatus(error) === 403) {
          return {
            apiStatus: unavailableStatus(endpoint, getErrorMessage(error)),
            unauthorized: true
          };
        }
      }
    }

    return {
      apiStatus: unavailableStatus(endpoints[0], getErrorMessage(lastError))
    };
  },

  async getDashboardData(): Promise<DashboardData> {
    const [eventResult, backendHealth] = await Promise.all([this.getEvents(), this.getHealth()]);
    const [summaryResult, riskResult, accessResult] = await Promise.all([
      this.getDashboardSummary(eventResult.data),
      this.getRiskScores(),
      this.getAccessMatrix()
    ]);

    return {
      kpis: summaryResult.data.kpis,
      workStatusSeries: summaryResult.data.workStatusSeries,
      employeeHeatmap: buildHeatmapFromRiskScores(riskResult.data),
      riskScores: sortRiskScores(riskResult.data),
      accessMatrix: accessResult.data,
      dashboardApiStatus: summaryResult.apiStatus,
      riskApiStatus: riskResult.apiStatus,
      accessApiStatus: accessResult.apiStatus,
      events: eventResult.data,
      eventApiStatus: eventResult.apiStatus,
      backendHealth
    };
  },

  async getDashboardSummary(fallbackEvents: EventRecord[] = []): Promise<DashboardSummaryData> {
    const endpoint = '/api/dashboard/summary';

    try {
      const payload = await apiClient<unknown>(endpoint);
      const root = unwrapPrimaryRecord(payload);
      const kpis = mapDashboardSummaryKpis(root, fallbackEvents);
      const liveSeries = extractStatusBuckets(root);

      return {
        data: {
          kpis,
          workStatusSeries: liveSeries.length > 0 ? liveSeries : workStatusSeries
        },
        apiStatus: liveStatus(endpoint, 'Dashboard summary loaded')
      };
    } catch (error) {
      return {
        data: {
          kpis: buildDashboardKpis(fallbackEvents),
          workStatusSeries
        },
        apiStatus: fallbackStatus(endpoint, getErrorMessage(error))
      };
    }
  },

  async getRiskScores(): Promise<RiskScoreListData> {
    const endpoint = '/api/risk/scores';

    try {
      const payload = await apiClient<unknown>(endpoint);
      const scores = mapRiskScoreRecords(payload);

      return {
        data: sortRiskScores(scores),
        apiStatus: liveStatus(endpoint, `Loaded ${scores.length} risk score rows`)
      };
    } catch (error) {
      const fallbackScores = buildMockRiskScores();

      return {
        data: fallbackScores,
        apiStatus: fallbackStatus(endpoint, getErrorMessage(error))
      };
    }
  },

  async getAccessMatrix(): Promise<AccessMatrixListData> {
    const endpoints = ['/api/access/matrix', '/api/access-matrix'];
    let lastError: unknown;

    for (const endpoint of endpoints) {
      try {
        const payload = await apiClient<unknown>(endpoint);
        const records = mapAccessMatrixRecords(payload);

        if (records.length === 0) {
          throw new Error('Access matrix payload did not contain usable role rows');
        }

        return {
          data: sortAccessMatrix(records),
          apiStatus: liveStatus(endpoint, `Loaded ${records.length} access-role rows`)
        };
      } catch (error) {
        lastError = error;
      }
    }

    const fallbackRecords = buildMockAccessMatrix();
    return {
      data: fallbackRecords,
      apiStatus: fallbackStatus(endpoints[0], getErrorMessage(lastError))
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

  async exportEmployees(): Promise<EmployeeExportResult> {
    const endpoint = '/api/admin/export/employees';

    try {
      const response = await apiClient<Response>(endpoint, {
        responseType: 'response'
      });
      const blob = await response.blob();
      const filename = extractDownloadFilename(response.headers.get('content-disposition'));

      return {
        blob,
        filename,
        apiStatus: liveStatus(endpoint, 'Employee CSV export prepared')
      };
    } catch (error) {
      return {
        apiStatus: unavailableStatus(endpoint, `Employee CSV export unavailable: ${getErrorMessage(error)}`)
      };
    }
  },

  async importEmployees(source: string | Blob): Promise<EmployeeImportMutationResult> {
    const endpoint = '/api/admin/import/employees';
    const attempts = buildEmployeeImportAttempts(source);
    const csvText = typeof source === 'string' ? source : '';
    let lastError: unknown = new Error('No employee import payload was configured');

    for (const attempt of attempts) {
      try {
        const payload = await apiClient<unknown>(endpoint, {
          method: 'POST',
          body: attempt.body,
          headers: attempt.headers
        });
        const summary = mapEmployeeImportSummary(payload, csvText);

        return {
          data: summary,
          apiStatus: liveStatus(endpoint, summary.detail ?? 'Employee CSV import completed')
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      apiStatus: unavailableStatus(endpoint, `Employee CSV import unavailable: ${getErrorMessage(lastError)}`)
    };
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
      const status = readErrorStatus(error);

      if (status === 401 || status === 403) {
        return {
          data: [],
          apiStatus: {
            source: 'mock',
            state: 'unavailable',
            label: 'Access denied',
            detail: `Device list access denied: ${getErrorMessage(error)}`,
            endpoint: '/api/devices'
          }
        };
      }

      return {
        data: devices,
        apiStatus: fallbackStatus('/api/devices', getErrorMessage(error))
      };
    }
  },

  async issueDeviceAgentToken(deviceId: string): Promise<DeviceTokenIssueResult> {
    const endpoint = `/api/devices/${deviceId}/agent-token`;

    try {
      const payload = await apiClient<unknown>(endpoint, { method: 'POST' });
      const record = asRecord(payload);
      const token = readString(record, ['token']);
      const resolvedDeviceId = readString(record, ['device_id', 'deviceId']) ?? deviceId;

      if (!token) {
        throw new Error('Device token response did not include a token');
      }

      return {
        deviceId: resolvedDeviceId,
        token,
        apiStatus: liveStatus(endpoint, 'Issued a device-scoped agent token')
      };
    } catch (error) {
      const status = readErrorStatus(error);

      if (status === 401 || status === 403) {
        return {
          apiStatus: {
            source: 'mock',
            state: 'unavailable',
            label: 'Access denied',
            detail: `Device token issue denied: ${getErrorMessage(error)}`,
            endpoint
          },
          errorCode: 'forbidden'
        };
      }

      if (status === 404) {
        return {
          apiStatus: {
            source: 'mock',
            state: 'unavailable',
            label: 'Device not found',
            detail: `Device token issue failed: ${getErrorMessage(error)}`,
            endpoint
          },
          errorCode: 'not_found'
        };
      }

      return {
        apiStatus: unavailableStatus(endpoint, `Device token issue failed: ${getErrorMessage(error)}`),
        errorCode: 'unavailable'
      };
    }
  },

  async revokeDeviceAgentToken(deviceId: string): Promise<DeviceTokenRevokeResult> {
    const endpoint = `/api/devices/${deviceId}/agent-token/revoke`;

    try {
      const payload = await apiClient<unknown>(endpoint, { method: 'POST' });
      const record = asRecord(payload);
      const revokedAt = readString(record, ['revoked_at', 'revokedAt']);

      if (!revokedAt) {
        throw new Error('Device token revoke response did not include revoked_at');
      }

      return {
        deviceId: readString(record, ['device_id', 'deviceId']) ?? deviceId,
        revokedAt,
        apiStatus: liveStatus(endpoint, 'Revoked the device-scoped agent token')
      };
    } catch (error) {
      const status = readErrorStatus(error);

      if (status === 401 || status === 403) {
        return {
          apiStatus: {
            source: 'mock',
            state: 'unavailable',
            label: 'Access denied',
            detail: `Device token revoke denied: ${getErrorMessage(error)}`,
            endpoint
          },
          errorCode: 'forbidden'
        };
      }

      if (status === 404) {
        return {
          apiStatus: {
            source: 'mock',
            state: 'unavailable',
            label: 'Device not found',
            detail: `Device token revoke failed: ${getErrorMessage(error)}`,
            endpoint
          },
          errorCode: 'not_found'
        };
      }

      return {
        apiStatus: unavailableStatus(endpoint, `Device token revoke failed: ${getErrorMessage(error)}`),
        errorCode: 'unavailable'
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
        apiStatus:
          refreshed.apiStatus.source === 'live'
            ? liveStatus(endpoint, `Review updated to ${status}`)
            : fallbackStatus(endpoint, `Review updated but event refresh used fallback data`),
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

  async savePolicy(policy: PolicyMutationInput, policyId?: string): Promise<PolicyMutationResult> {
    const payload = buildPolicyPayload(policy);
    const attempts: PolicyMutationAttempt[] = policyId
      ? [
          {
            path: `/api/policies/${policyId}`,
            method: 'PUT',
            body: payload
          },
          {
            path: `/api/policies/${policyId}`,
            method: 'POST',
            body: payload
          }
        ]
      : [
          {
            path: '/api/policies',
            method: 'POST',
            body: payload
          }
        ];

    return attemptPolicyMutation(
      attempts,
      policyId ? `Saved policy ${policy.name}` : `Created policy ${policy.name}`
    );
  },

  async updatePolicyState(policyId: string, action: PolicyStateAction): Promise<PolicyMutationResult> {
    const activeBody = { is_active: true, status: 'active', set_active: action === 'set_active' };
    const inactiveBody = { is_active: false, status: 'inactive' };
    const attempts: PolicyMutationAttempt[] =
      action === 'deactivate'
        ? [
            { path: `/api/policies/${policyId}/activation`, method: 'POST', body: inactiveBody },
            { path: `/api/policies/${policyId}/deactivate`, method: 'POST' },
            { path: `/api/policies/${policyId}`, method: 'PUT', body: inactiveBody }
          ]
        : action === 'activate'
          ? [
              { path: `/api/policies/${policyId}/activation`, method: 'POST', body: activeBody },
              { path: `/api/policies/${policyId}/activate`, method: 'POST' },
              { path: `/api/policies/${policyId}`, method: 'PUT', body: activeBody }
            ]
          : [
              { path: `/api/policies/${policyId}/activation`, method: 'POST', body: activeBody },
              { path: `/api/policies/${policyId}/set-active`, method: 'POST' },
              { path: `/api/policies/${policyId}/activate`, method: 'POST' },
              { path: `/api/policies/${policyId}`, method: 'PUT', body: activeBody }
            ];

    return attemptPolicyMutation(
      attempts,
      `${formatLabel(action)} applied to policy ${shortenUuid(policyId)}`
    );
  },

  async getAuditLogs(): Promise<AuditLogListData> {
    try {
      const payload = await apiClient<AuditLogApiItem[] | { items: AuditLogApiItem[] }>('/api/audit-logs');
      const items = extractItems(payload);

      if (!items) {
        throw new Error('Audit log payload is not an array');
      }

      return {
        data: [...items].sort(compareAuditLogItems).map(mapAuditLogRecord),
        apiStatus: liveStatus('/api/audit-logs', `Loaded ${items.length} audit log records`)
      };
    } catch (error) {
      return {
        data: auditLogs,
        apiStatus: fallbackStatus('/api/audit-logs', getErrorMessage(error))
      };
    }
  },

  async getAttendance(): Promise<AttendanceListData> {
    const endpoint = '/api/attendance';

    try {
      const payload = await apiClient<AttendanceApiItem[] | { items: AttendanceApiItem[] }>(endpoint);
      const items = extractItems(payload);

      if (!items) {
        throw new Error('Attendance payload is not an array');
      }

      return {
        data: items.map(mapAttendanceRecord),
        apiStatus: liveStatus(endpoint, `Loaded ${items.length} attendance records`)
      };
    } catch (error) {
      if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
        return {
          data: [],
          apiStatus: {
            source: 'mock',
            state: 'unavailable',
            label: 'Access denied',
            detail: `Attendance access denied: ${getErrorMessage(error)}`,
            endpoint,
          }
        };
      }

      return {
        data: attendanceRecords,
        apiStatus: fallbackStatus(endpoint, getErrorMessage(error))
      };
    }
  },

  async getAttendanceRules(): Promise<AttendanceRuleSummaryData> {
    const endpoints = [
      '/api/attendance/rules/default',
      '/api/attendance/rules',
      '/api/attendance/settings',
      '/api/attendance/policy'
    ];
    let lastError: unknown;

    for (const endpoint of endpoints) {
      try {
        const payload = await apiClient<unknown>(endpoint);
        const rule = mapAttendanceRuleSummary(payload);

        return {
          data: rule,
          apiStatus: liveStatus(endpoint, `Loaded ${rule.name}`)
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      data: defaultAttendanceRuleSummary,
      apiStatus: fallbackStatus(
        endpoints[0],
        `Using default attendance thresholds: ${getErrorMessage(lastError)}`
      )
    };
  },

  async updateAttendanceRule(rule: AttendanceRuleUpdateInput): Promise<AttendanceRuleMutationResult> {
    const endpoint = '/api/attendance/rules/default';

    try {
      const payload = await apiClient<unknown>(endpoint, {
        method: 'PUT',
        body: {
          ...(rule.name ? { name: rule.name } : {}),
          clock_in_late_after: normalizeTimeValue(rule.clockInLateAfter),
          clock_out_early_before: normalizeTimeValue(rule.clockOutEarlyBefore)
        }
      });
      const summary = mapAttendanceRuleSummary(payload);

      return {
        data: summary,
        apiStatus: liveStatus(endpoint, `Updated ${summary.name}`)
      };
    } catch (error) {
      const status = readErrorStatus(error);

      if (status === 401 || status === 403) {
        return {
          apiStatus: {
            source: 'mock',
            state: 'unavailable',
            label: 'Access denied',
            detail: `Attendance rule update denied: ${getErrorMessage(error)}`,
            endpoint
          },
          errorCode: 'forbidden'
        };
      }

      if (status === 404) {
        return {
          apiStatus: {
            source: 'mock',
            state: 'unavailable',
            label: 'Endpoint unavailable',
            detail: 'Default attendance rule update API is not available on this backend.',
            endpoint
          },
          errorCode: 'not_found'
        };
      }

      if (status === 400 || status === 422) {
        return {
          apiStatus: {
            source: 'mock',
            state: 'unavailable',
            label: 'Validation failed',
            detail: `Attendance rule update rejected: ${getErrorMessage(error)}`,
            endpoint
          },
          errorCode: 'invalid'
        };
      }

      return {
        apiStatus: {
          source: 'mock',
          state: 'unavailable',
          label: 'Save failed',
          detail: `Attendance rule was not saved: ${getErrorMessage(error)}`,
          endpoint
        },
        errorCode: 'unavailable'
      };
    }
  },

  async reviewAttendance(
    recordId: string,
    reviewStatus: AttendanceReviewStatus,
    reviewNote?: string
  ): Promise<AttendanceReviewResult> {
    const endpoint = `/api/attendance/${recordId}/review`;

    try {
      await apiClient(endpoint, {
        method: 'POST',
        body: {
          review_status: reviewStatus,
          review_note: reviewNote ?? null
        }
      });

      const refreshed = await this.getAttendance();
      return {
        apiStatus:
          refreshed.apiStatus.source === 'live'
            ? liveStatus(endpoint, `Attendance review updated to ${formatLabel(reviewStatus)}`)
            : fallbackStatus(endpoint, 'Review updated but attendance refresh used fallback data'),
        records: refreshed.data
      };
    } catch (error) {
      return {
        apiStatus: fallbackStatus(endpoint, `Attendance review was not saved: ${getErrorMessage(error)}`)
      };
    }
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

async function attemptPolicyMutation(
  attempts: PolicyMutationAttempt[],
  successDetail: string
): Promise<PolicyMutationResult> {
  let lastError: unknown = new Error('No mutation attempt was configured');

  for (const attempt of attempts) {
    try {
      await apiClient(attempt.path, {
        method: attempt.method,
        body: attempt.body
      });

      const refreshed = await adminApi.getPolicies();
      return {
        data: refreshed.data,
        apiStatus:
          refreshed.apiStatus.source === 'live'
            ? liveStatus(attempt.path, successDetail)
            : fallbackStatus(attempt.path, `${successDetail}; list refresh used fallback data`)
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    apiStatus: fallbackStatus(
      attempts[0]?.path ?? '/api/policies',
      `Saved locally only: ${getErrorMessage(lastError)}`
    )
  };
}

function buildPolicyPayload(policy: PolicyMutationInput) {
  const roles = dedupeLabels(policy.roles);
  const departments = dedupeLabels(policy.departments);
  const positions = dedupeLabels(policy.positions);

    return {
    name: policy.name,
    version: policy.version?.trim() || 'draft',
    screenshot_interval_seconds: policy.screenshotIntervalSeconds,
    no_change_threshold: policy.noChangeThresholdFrames,
    retention_days: policy.retentionDays,
    roles,
    departments,
    positions,
    scope: {
      roles,
      departments,
      positions
    },
    rules_json: {
      target_roles: roles,
      target_departments: departments,
      target_positions: positions,
      screenshot_interval_seconds: policy.screenshotIntervalSeconds,
      no_change_threshold: policy.noChangeThresholdFrames,
      retention_days: policy.retentionDays
    }
  };
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
    hasAgentToken: readBoolean(item, ['has_agent_token', 'hasAgentToken']) ?? false,
    agentTokenRevokedAt: formatOptionalDateTime(readString(item, ['agent_token_revoked_at', 'agentTokenRevokedAt'])),
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
    roles: roles.length > 0 ? roles : ['All roles'],
    positions,
    departments,
    status: normalizeListStatus(resolvePolicyStatus(item, rules)),
    isActive: item.is_active === true || resolvePolicyStatus(item, rules) === 'active',
    assignedEmployees:
      readNumber(item, ['assigned_employees', 'assigned_employee_count', 'employee_count']) ?? undefined,
    screenshotIntervalSeconds: intervalSeconds,
    screenshotInterval: `${intervalSeconds}s`,
    noChangeThresholdFrames: noChangeThreshold,
    noChangeThreshold: `${noChangeThreshold} frames`,
    highRiskDurationSeconds: highRiskWindowSeconds,
    highRiskDuration: formatDurationSeconds(highRiskWindowSeconds),
    ocrEnabled:
      firstBooleanFromSources(
        [item, rules].filter((source): source is Record<string, unknown> => Boolean(source)),
        ['ocr_enabled', 'enable_ocr', 'ocr']
      ) ?? false,
    retentionDays,
    originalRetention: `${retentionDays} days`
  };
}

function mapAuditLogRecord(item: AuditLogApiItem, index: number): AuditLogRecord {
  const details = pickRecords(item, ['details_json', 'metadata', 'context', 'payload']);
  const targetRecord = pickRecords(item, ['target', 'resource', 'entity']);
  const scope = firstString(
    readString(item, ['scope', 'entity_type', 'target_type', 'category']),
    readString(targetRecord, ['type', 'entity_type', 'resource_type'])
  );
  const target = firstString(
    readString(item, ['target', 'target_name', 'resource_name', 'entity_name']),
    readString(targetRecord, ['name', 'title']),
    readString(item, ['event_id', 'policy_name', 'policy_id', 'session_id'])
  );

  return {
    key: readString(item, ['id']) ?? String(index),
    operator:
      firstString(
        readString(item, ['operator', 'actor_name', 'user_name', 'admin_name', 'reviewer_name']),
        readString(pickRecords(item, ['operator_info', 'actor', 'user']), ['name', 'display_name'])
      ) ?? 'System',
    action:
      firstString(readString(item, ['action', 'operation', 'activity', 'event', 'type']), 'Unknown action') ??
      'Unknown action',
    target: target ?? 'Unspecified target',
    scope: scope ? formatLabel(scope) : undefined,
    metadataSummary: buildAuditMetadataSummary(item, details),
    reason:
      firstString(
        readString(item, ['reason', 'note', 'description', 'message', 'review_note']),
        readString(details, ['reason', 'note', 'description', 'message'])
      ) ?? '--',
    timestamp: formatDateTime(
      firstString(
        readString(item, ['timestamp', 'occurred_at', 'created_at', 'updated_at']),
        readString(details, ['timestamp', 'occurred_at'])
      )
    ),
    result:
      firstString(
        readString(item, ['result', 'status', 'outcome']),
        readString(details, ['result', 'status', 'outcome'])
      ) ?? 'logged'
  };
}

function mapAttendanceRecord(item: AttendanceApiItem, index: number): AttendanceRecord {
  const eventType = readString(item, ['event_type']) ?? 'clock_in';
  const anomalyStatus = readString(item, ['anomaly_status']) ?? 'normal';
  return {
    key: readString(item, ['id']) ?? String(index),
    employee:
      firstString(
        readString(item, ['employee_name', 'name']),
        readString(item, ['user_name'])
      ) ?? 'Unknown employee',
    employeeNo: readString(item, ['employee_no']) ?? undefined,
    department: readString(item, ['department']) ?? undefined,
    userName: readString(item, ['user_name']) ?? '--',
    machineName: readString(item, ['machine_name']) ?? undefined,
    eventType,
    eventLabel: formatLabel(eventType),
    occurredAt: formatDateTime(readString(item, ['occurred_at'])),
    workDate: readString(item, ['work_date']) ?? undefined,
    anomalyStatus,
    anomalyLabel: formatLabel(anomalyStatus),
    anomalyReasons: Array.isArray(item.anomaly_reasons) ? item.anomaly_reasons : [],
    reviewStatus: readString(item, ['review_status']) ?? 'pending',
    reviewNote: readString(item, ['review_note']) ?? undefined,
    source: readString(item, ['source']) ?? 'launcher'
  };
}

function mapAttendanceRuleSummary(payload: unknown): AttendanceRuleSummary {
  const root = unwrapPrimaryRecord(payload);
  const record =
    pickRecords(root, [
      'attendance',
      'attendance_rule',
      'attendance_rules',
      'rule',
      'rules',
      'rules_json',
      'schedule',
      'shift'
    ]) ?? root;
  const lateThreshold =
    normalizeTimeValue(
      firstString(
        readString(record, ['late_threshold', 'late_after', 'clock_in_late_after', 'clock_in_cutoff']),
        readString(root, ['late_threshold', 'late_after', 'clock_in_late_after', 'clock_in_cutoff'])
      )
    ) ?? defaultAttendanceRuleSummary.lateThreshold;
  const earlyLeaveThreshold =
    normalizeTimeValue(
      firstString(
        readString(record, [
          'early_leave_threshold',
          'early_leave_before',
          'clock_out_early_before',
          'clock_out_cutoff'
        ]),
        readString(root, [
          'early_leave_threshold',
          'early_leave_before',
          'clock_out_early_before',
          'clock_out_cutoff'
        ])
      )
    ) ?? defaultAttendanceRuleSummary.earlyLeaveThreshold;
  const name =
    firstString(
      readString(record, ['name', 'rule_name', 'title']),
      readString(root, ['name', 'rule_name', 'title']),
      defaultAttendanceRuleSummary.name
    ) ?? defaultAttendanceRuleSummary.name;

  return {
    key: readString(record, ['id', 'key']) ?? readString(root, ['id', 'key']) ?? 'live-attendance-rule',
    name,
    lateThreshold,
    earlyLeaveThreshold,
    timezone:
      firstString(
        readString(record, ['timezone', 'time_zone', 'tz']),
        readString(root, ['timezone', 'time_zone', 'tz'])
      ) ?? defaultAttendanceRuleSummary.timezone,
    sourceLabel: 'Backend rule'
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

function mapDashboardSummaryKpis(
  root: Record<string, unknown> | undefined,
  fallbackEvents: EventRecord[]
): KpiMetric[] {
  if (!root) {
    return buildDashboardKpis(fallbackEvents);
  }

  const countSources = collectRecordSources(
    root,
    pickRecords(root, ['summary', 'counts', 'metrics', 'totals', 'overview']),
    pickRecords(root, ['data', 'stats', 'dashboard'])
  );
  const fallbackKpis = buildDashboardKpis(fallbackEvents);
  const onlineDevices = readNumberFromSources(countSources, [
    'online_devices',
    'online_device_count',
    'onlineDevices',
    'devices_online'
  ]);
  const totalDevices = readNumberFromSources(countSources, ['total_devices', 'device_count', 'totalDevices']);
  const activeEmployees = readNumberFromSources(countSources, [
    'active_employees',
    'active_employee_count',
    'activeEmployees',
    'employees_active'
  ]);
  const totalEmployees = readNumberFromSources(countSources, [
    'total_employees',
    'employee_count',
    'totalEmployees'
  ]);
  const highRiskEvents = readNumberFromSources(countSources, [
    'high_risk_events',
    'unresolved_high_risk_event_count',
    'open_risk_count',
    'risk_event_count',
    'highRiskEvents'
  ]);
  const reviewQueue = readNumberFromSources(countSources, [
    'review_queue',
    'open_event_count',
    'reviewing_events',
    'pending_reviews',
    'pending_review_count'
  ]);
  const githubRiskEvents = readNumberFromSources(countSources, [
    'github_risk_events',
    'github_event_count',
    'github_flagged_events',
    'githubRisks'
  ]);
  const watchEmployees = readNumberFromSources(countSources, [
    'watch_employees',
    'watchlist_employees',
    'employees_at_watch',
    'watch_count'
  ]);

  return [
    {
      key: 'online',
      title: 'Online devices',
      value: String(onlineDevices ?? fallbackNumericKpi(fallbackKpis, 'online')),
      delta:
        totalDevices !== undefined
          ? `of ${totalDevices} devices`
          : fallbackDeltaKpi(fallbackKpis, 'online'),
      tone: 'positive'
    },
    {
      key: 'active',
      title: 'Active employees',
      value: String(activeEmployees ?? totalEmployees ?? fallbackNumericKpi(fallbackKpis, 'active')),
      delta:
        totalEmployees !== undefined
          ? `of ${totalEmployees} employees`
          : fallbackDeltaKpi(fallbackKpis, 'active'),
      tone: 'positive'
    },
    {
      key: 'risk',
      title: 'High-risk events',
      value: String(highRiskEvents ?? fallbackNumericKpi(fallbackKpis, 'risk')),
      delta:
        reviewQueue !== undefined
          ? `${reviewQueue} in review`
          : watchEmployees !== undefined
            ? `${watchEmployees} watchlist`
            : fallbackDeltaKpi(fallbackKpis, 'risk'),
      tone: (highRiskEvents ?? 0) > 0 ? 'warning' : 'positive'
    },
    {
      key: 'github',
      title: 'GitHub risk events',
      value: String(githubRiskEvents ?? 0),
      delta:
        githubRiskEvents === undefined
          ? 'Not connected'
          : watchEmployees !== undefined
          ? `${watchEmployees} employees flagged`
          : fallbackDeltaKpi(fallbackKpis, 'github'),
      tone: (githubRiskEvents ?? 0) > 0 ? 'danger' : 'default'
    }
  ];
}

function extractStatusBuckets(root: Record<string, unknown> | undefined): StatusBucket[] {
  if (!root) {
    return [];
  }

  const directItems =
    extractUnknownItems(
      root.activity_distribution ??
        root.activityDistribution ??
        root.work_status_series ??
        root.status_buckets ??
        root.series
    ) ?? extractUnknownItems(root, ['activity_distribution', 'activityDistribution', 'work_status_series', 'series']);

  if (directItems && directItems.length > 0) {
    return directItems
      .map((item: unknown, index: number) => mapStatusBucket(item, index))
      .filter((bucket: StatusBucket | null): bucket is StatusBucket => bucket !== null);
  }

  const distributionRecord = pickRecords(root, [
    'activity_distribution',
    'activityDistribution',
    'status_distribution'
  ]);
  if (distributionRecord) {
    return Object.entries(distributionRecord)
      .map(([slot, value], index) => mapStatusBucket({ slot, ...(asRecord(value) ?? {}) }, index))
      .filter((bucket): bucket is StatusBucket => bucket !== null);
  }

  return [];
}

function mapStatusBucket(item: unknown, index: number): StatusBucket | null {
  const record = asRecord(item);
  if (!record) {
    return null;
  }

  const counts = pickRecords(record, ['counts', 'distribution', 'status_counts']);
  const sources = collectRecordSources(record, counts);
  const values: StatusBucket = {
    slot:
      firstString(
        readString(record, ['slot', 'time', 'label', 'hour']),
        readString(counts, ['slot', 'time', 'label', 'hour'])
      ) ?? `${String(index + 1).padStart(2, '0')}:00`,
    coding: readNumberFromSources(sources, ['coding', 'code', 'development']) ?? 0,
    review: readNumberFromSources(sources, ['review', 'code_review', 'pr_review']) ?? 0,
    meeting: readNumberFromSources(sources, ['meeting', 'meetings']) ?? 0,
    documentation: readNumberFromSources(sources, ['documentation', 'docs', 'writing']) ?? 0,
    communication: readNumberFromSources(sources, ['communication', 'chat', 'messaging', 'collaboration']) ?? 0,
    idle: readNumberFromSources(sources, ['idle', 'inactive']) ?? 0,
    locked: readNumberFromSources(sources, ['locked', 'lock_screen', 'away']) ?? 0
  };

  const total =
    values.coding +
    values.review +
    values.meeting +
    values.documentation +
    values.communication +
    values.idle +
    values.locked;

  return total > 0 ? values : null;
}

function mapRiskScoreRecords(payload: unknown): RiskScoreRecord[] {
  const items = extractUnknownItems(payload, ['items', 'rows', 'records', 'scores', 'employees', 'results', 'data']);
  if (!items || items.length === 0) {
    return [];
  }

  return items.flatMap((item: unknown, index: number) => expandRiskScoreRecord(item, index));
}

function expandRiskScoreRecord(item: unknown, index: number): RiskScoreRecord[] {
  const record = asRecord(item);
  if (!record) {
    return [];
  }

  const slotItems = extractUnknownItems(record, ['history', 'slots', 'timeline', 'buckets']);
  if (slotItems && slotItems.length > 0) {
    const expanded = slotItems
      .map((slotItem: unknown, slotIndex: number) => mapRiskScoreRecord(slotItem, index, slotIndex, record))
      .filter((entry: RiskScoreRecord | null): entry is RiskScoreRecord => entry !== null);

    if (expanded.length > 0) {
      return expanded;
    }
  }

  const mapped = mapRiskScoreRecord(record, index);
  return mapped ? [mapped] : [];
}

function mapRiskScoreRecord(
  item: unknown,
  index: number,
  slotIndex = 0,
  parent?: Record<string, unknown>
): RiskScoreRecord | null {
  const record = asRecord(item);
  if (!record) {
    return null;
  }

  const employee = pickRecords(record, ['employee', 'employee_summary']) ?? pickRecords(parent, ['employee']);
  const policy = pickRecords(record, ['policy', 'policy_summary']) ?? pickRecords(parent, ['policy', 'policy_summary']);
  const employeeName =
    firstString(
      readString(record, ['employee_name', 'employee', 'name', 'display_name']),
      readString(employee, ['name', 'display_name', 'employee_name']),
      readString(parent, ['employee_name'])
    ) ?? `Employee ${index + 1}`;
  const scoreValue = normalizeRiskScoreValue(
    readNumber(record, ['score', 'risk_score', 'riskScore', 'current_score', 'value']) ??
      readNumber(parent, ['score', 'risk_score', 'riskScore'])
  );
  const riskLevel = normalizeRiskLevel(
    readNumber(record, ['risk_level', 'riskLevel', 'level']) ??
      readNumber(parent, ['risk_level', 'riskLevel', 'level']),
    scoreValue,
    firstString(readString(record, ['status', 'band', 'state']), readString(parent, ['status', 'band', 'state']))
  );

  return {
    key:
      firstString(
        readString(record, ['id', 'key']),
        readString(parent, ['id', 'key'])
      ) ?? `${employeeName}-${index + 1}-${slotIndex + 1}`,
    employee: employeeName,
    employeeNo:
      firstString(
        readString(record, ['employee_no', 'employeeNo']),
        readString(employee, ['employee_no', 'employeeNo', 'code'])
      ) ?? undefined,
    department:
      firstString(
        readString(record, ['department', 'department_name']),
        readString(employee, ['department', 'department_name']),
        readString(parent, ['department'])
      ) ?? 'Unassigned',
    role:
      firstString(
        readString(record, ['role', 'job_role', 'employee_role']),
        readString(employee, ['role', 'job_role', 'job_family']),
        readString(parent, ['role', 'job_role'])
      ) ?? 'General',
    position:
      firstString(
        readString(record, ['position', 'job_title', 'title']),
        readString(employee, ['position', 'job_title', 'title']),
        readString(parent, ['position', 'job_title'])
      ) ?? undefined,
    slot:
      firstString(
        readString(record, ['slot', 'time_slot', 'time', 'label', 'hour']),
        readString(parent, ['slot', 'time_slot'])
      ) ?? 'Current',
    score: scoreValue,
    riskLevel,
    status:
      firstString(
        readString(record, ['status', 'band', 'state']),
        readString(parent, ['status', 'band', 'state']),
        riskStatusLabel(riskLevel)
      ) ?? 'Normal',
    eventCount:
      readNumber(record, ['event_count', 'risk_count', 'open_risk_count', 'count']) ??
      readNumber(parent, ['event_count', 'risk_count', 'open_risk_count', 'count']) ??
      0,
    policyName:
      firstString(
        readString(record, ['policy_name']),
        readString(policy, ['name', 'policy_name']),
        readString(parent, ['policy_name'])
      ) ?? undefined
  };
}

function buildHeatmapFromRiskScores(scores: RiskScoreRecord[]): HeatmapPoint[] {
  if (scores.length === 0) {
    return [];
  }

  const merged = new Map<string, HeatmapPoint>();

  for (const item of scores) {
    const key = `${item.employee}::${item.slot}`;
    const next: HeatmapPoint = {
      employee: item.employee,
      slot: item.slot,
      riskLevel: item.riskLevel,
      status: `${formatLabel(item.status)} / score ${Math.round(item.score)}`
    };
    const current = merged.get(key);

    if (!current || current.riskLevel <= next.riskLevel) {
      merged.set(key, next);
    }
  }

  return Array.from(merged.values());
}

function buildMockRiskScores(): RiskScoreRecord[] {
  return employeeHeatmap.map((point, index) => {
    const employeeRecord = employees.find((item) => item.name === point.employee);

    return {
      key: `mock-risk-score-${index + 1}`,
      employee: point.employee,
      employeeNo: employeeRecord?.employeeNo,
      department: employeeRecord?.department ?? 'Unassigned',
      role: employeeRecord?.role ?? 'General',
      position: employeeRecord?.position,
      slot: point.slot,
      score: point.riskLevel * 25,
      riskLevel: point.riskLevel,
      status: point.status,
      eventCount: employeeRecord?.todayRisk ?? 0,
      policyName: employeeRecord?.policyName
    };
  });
}

function mapAccessMatrixRecords(payload: unknown): AccessMatrixRecord[] {
  const items = extractUnknownItems(payload, ['items', 'rows', 'records', 'roles', 'matrix', 'data']);
  if (items && items.length > 0) {
    return items
      .map((item: unknown, index: number) => mapAccessMatrixRecord(item, index))
      .filter((record: AccessMatrixRecord | null): record is AccessMatrixRecord => record !== null);
  }

  const root = unwrapPrimaryRecord(payload);
  if (!root) {
    return [];
  }

  return Object.entries(root)
    .map(([role, value], index) => mapAccessMatrixRecord({ role, ...(asRecord(value) ?? {}) }, index))
    .filter((record): record is AccessMatrixRecord => record !== null);
}

function mapAccessMatrixRecord(item: unknown, index: number): AccessMatrixRecord | null {
  const record = asRecord(item);
  if (!record) {
    return null;
  }

  const roleRecord = asRecord(record.role);
  const permissionItems = extractUnknownItems(record, ['permissions', 'grants', 'access', 'permission_matrix']);
  const permissionKeys = readStringArray(record, ['permission_keys', 'permissionKeys']) ?? [];
  const employeeItems = readArray(record, ['employees', 'members', 'employee_list']);
  const policyItems = readArray(record, ['policies', 'policy_list']);
  const modules = dedupeLabels(
    collectStringList(
      readStringArray(record, ['modules', 'allowed_modules', 'views']),
      permissionItems ? extractPermissionModules(permissionItems) : undefined,
      modulesFromPermissionKeys(permissionKeys)
    )
  );
  const actions = dedupeLabels(
    collectStringList(
      readStringArray(record, ['actions', 'allowed_actions']),
      permissionItems ? extractPermissionActions(permissionItems) : undefined,
      actionsFromPermissionKeys(permissionKeys)
    )
  );
  const employeesList = dedupeLabels(
    collectStringList(
      readStringArray(record, ['employees', 'employee_names', 'members']),
      employeeItems ? extractFieldList(employeeItems, ['name', 'display_name', 'employee_name']) : undefined
    )
  );
  const departments = dedupeLabels(
    collectStringList(
      readStringArray(record, ['departments', 'target_departments']),
      employeeItems ? extractFieldList(employeeItems, ['department', 'department_name']) : undefined
    )
  );
  const positions = dedupeLabels(
    collectStringList(
      readStringArray(record, ['positions', 'target_positions']),
      employeeItems ? extractFieldList(employeeItems, ['position', 'job_title', 'title']) : undefined
    )
  );
  const policyNames = dedupeLabels(
    collectStringList(
      readStringArray(record, ['policy_names']),
      policyItems ? extractFieldList(policyItems, ['name', 'policy_name']) : undefined
    )
  );
  const role =
    firstString(readString(record, ['role', 'job_role', 'name', 'label']), readString(roleRecord, ['name', 'label'])) ??
    `Role ${index + 1}`;

  return {
    key: readString(record, ['id', 'key']) ?? `${role}-${index + 1}`,
    role,
    modules,
    actions,
    departments,
    positions,
    employees: employeesList,
    employeeCount:
      readNumber(record, ['employee_count', 'assigned_employee_count', 'member_count']) ?? employeesList.length,
    policyNames
  };
}

function buildMockAccessMatrix(): AccessMatrixRecord[] {
  const roles = Array.from(new Set([...employees.map((item) => item.role), ...policies.flatMap((item) => item.roles)]));

  return roles.map((role, index) => {
    const relatedEmployees = employees.filter((item) => item.role === role);
    const relatedPolicies = policies.filter((item) => item.roles.includes(role) || item.role === role);

    return {
      key: `mock-access-${index + 1}`,
      role,
      modules: buildDefaultModulesForRole(role),
      actions: buildDefaultActionsForRole(role),
      departments: dedupeLabels([
        ...relatedEmployees.map((item) => item.department),
        ...relatedPolicies.flatMap((item) => item.departments)
      ]),
      positions: dedupeLabels([
        ...relatedEmployees.map((item) => item.position ?? ''),
        ...relatedPolicies.flatMap((item) => item.positions)
      ]),
      employees: relatedEmployees.map((item) => item.name),
      employeeCount: relatedEmployees.length,
      policyNames: dedupeLabels(relatedPolicies.map((item) => item.name))
    };
  });
}

function buildDefaultModulesForRole(role: string) {
  const normalized = role.toLowerCase();
  const modules = ['Dashboard', 'Employees', 'Timeline', 'Events'];

  if (normalized.includes('operation') || normalized.includes('sre')) {
    modules.push('Realtime Status', 'Devices');
  }

  if (normalized.includes('security')) {
    modules.push('Screenshot Detail', 'GitHub Risk', 'Audit Logs');
  }

  if (normalized.includes('quality')) {
    modules.push('Policies', 'Audit Logs');
  }

  if (normalized.includes('engineering')) {
    modules.push('Screenshot Detail');
  }

  return dedupeLabels(modules);
}

function buildDefaultActionsForRole(role: string) {
  const normalized = role.toLowerCase();
  const actions = ['View', 'Filter', 'Review'];

  if (normalized.includes('operation') || normalized.includes('sre')) {
    actions.push('Acknowledge', 'Assign Policy');
  }

  if (normalized.includes('security')) {
    actions.push('Export', 'Escalate');
  }

  if (normalized.includes('quality')) {
    actions.push('Adjust Policy');
  }

  return dedupeLabels(actions);
}

function extractPermissionModules(items: unknown[]) {
  return items
    .flatMap((item) => {
      const record = asRecord(item);
      if (!record) {
        return [];
      }

      const permission = readString(record, ['permission']);
      const explicitModule = readString(record, ['module', 'resource', 'name']);
      const parsedModule = permission?.includes('.') ? permission.split('.')[0] : undefined;

      return [explicitModule, parsedModule].filter((value): value is string => Boolean(value));
    })
    .map(formatLabel);
}

function extractPermissionActions(items: unknown[]) {
  return items
    .flatMap((item) => {
      const record = asRecord(item);
      if (!record) {
        return [];
      }

      const explicitAction = readString(record, ['action', 'verb']);
      const permission = readString(record, ['permission']);
      const parsedAction = permission?.includes('.') ? permission.split('.').slice(1).join('.') : undefined;
      const actionList = readStringArray(record, ['actions', 'verbs']);

      return [explicitAction, parsedAction, ...(actionList ?? [])].filter(
        (value): value is string => Boolean(value)
      );
    })
    .map(formatLabel);
}

function mapAuthIdentity(payload: unknown, fallbackIdentifier?: string): AuthIdentity | null {
  const root = unwrapPrimaryRecord(payload) ?? asRecord(payload);
  const record =
    pickRecords(root, ['user', 'account', 'profile', 'me']) ??
    pickRecords(asRecord(root?.data), ['user', 'account', 'profile']) ??
    root;

  if (!record) {
    return null;
  }

  const roleRecord =
    asRecord(record.role) ??
    asRecord(record.role_info) ??
    asRecord(record.role_details);
  const permissionSources = [
    record.permissions,
    record.permission_keys,
    record.permissionKeys,
    record.grants,
    roleRecord?.permissions,
    roleRecord?.permission_keys,
    roleRecord?.permissionKeys
  ];
  const permissionKeys = dedupeLabels(
    permissionSources.flatMap((source) => extractPermissionKeys(source))
  ).map((permissionKey) => permissionKey.toLowerCase());
  const permissionsResolved = permissionSources.some((source) => source !== undefined);
  const username =
    firstString(
      readString(record, ['username', 'login', 'name']),
      fallbackIdentifier
    ) ?? 'admin';
  const displayName =
    firstString(
      readString(record, ['display_name', 'displayName', 'full_name', 'name']),
      readString(roleRecord, ['display_name', 'displayName']),
      username
    ) ?? username;
  const roleName =
    firstString(
      readString(record, ['role_name', 'roleName']),
      readString(roleRecord, ['name', 'label']),
      typeof record.role === 'string' ? record.role : undefined
    ) ?? undefined;

  return {
    id: readString(record, ['id', 'user_id']) ?? undefined,
    username,
    displayName,
    email: readString(record, ['email']) ?? undefined,
    roleId: readString(record, ['role_id']) ?? readString(roleRecord, ['id']) ?? undefined,
    roleName,
    permissionKeys,
    permissionsResolved
  };
}

function extractAuthToken(payload: unknown) {
  const root = unwrapPrimaryRecord(payload) ?? asRecord(payload);
  const record =
    pickRecords(root, ['data', 'session', 'tokens', 'auth']) ??
    root;

  return firstString(
    readString(asRecord(payload), ['access_token', 'token', 'bearer_token']),
    readString(record, ['access_token', 'token', 'bearer_token']),
    readString(asRecord(record?.access), ['token'])
  );
}

function extractPermissionKeys(source: unknown): string[] {
  if (!source) {
    return [];
  }

  if (Array.isArray(source)) {
    return source.flatMap((item) => {
      if (typeof item === 'string') {
        return item.trim() ? [item.trim()] : [];
      }

      const record = asRecord(item);
      if (!record) {
        return [];
      }

      const nestedActions = readStringArray(record, ['actions', 'verbs']) ?? [];
      const permission = readString(record, ['key', 'permission', 'name']);
      const moduleName = readString(record, ['module', 'resource']);
      const action = readString(record, ['action', 'verb']);

      if (permission) {
        return [permission];
      }

      if (moduleName && action) {
        return [`${moduleName}.${action}`];
      }

      if (moduleName && nestedActions.length > 0) {
        return nestedActions.map((value) => `${moduleName}.${value}`);
      }

      return [];
    });
  }

  const record = asRecord(source);
  if (!record) {
    return [];
  }

  return [
    ...(readStringArray(record, ['permission_keys', 'permissionKeys']) ?? []),
    ...extractPermissionKeys(record.permissions),
    ...extractPermissionKeys(record.grants)
  ];
}

function buildEmployeeImportAttempts(source: string | Blob) {
  if (typeof source !== 'string') {
    const formData = new FormData();
    formData.append('file', source, source instanceof File ? source.name : 'employees.csv');
    return [{ body: formData }];
  }

  const csvText = source;
  const formData = new FormData();
  formData.append('file', new Blob([csvText], { type: 'text/csv;charset=utf-8' }), 'employees.csv');
  formData.append('csv_text', csvText);

  return [
    {
      body: formData
    },
    {
      body: {
        csv_text: csvText
      }
    },
    {
      body: {
        csv: csvText
      }
    },
    {
      body: csvText,
      headers: {
        'Content-Type': 'text/csv'
      }
    }
  ];
}

function mapEmployeeImportSummary(payload: unknown, csvText: string): EmployeeImportSummary {
  const root = unwrapPrimaryRecord(payload) ?? asRecord(payload) ?? {};
  const warnings =
    extractFieldList(
      extractUnknownItems(root, ['warnings', 'issues', 'errors', 'messages']) ?? [],
      ['message', 'detail', 'reason']
    ) ??
    [];
  const totalCount =
    readNumber(root, ['total', 'total_count', 'processed_count']) ??
    Math.max(csvText.split(/\r?\n/).filter((line) => line.trim()).length - 1, 0);
  const createdCount = readNumber(root, ['created', 'created_count', 'inserted_count']);
  const updatedCount = readNumber(root, ['updated', 'updated_count']);
  const skippedCount = readNumber(root, ['skipped', 'skipped_count', 'error_count']);
  const detail =
    firstString(
      readString(root, ['detail', 'message', 'summary']),
      `Processed ${totalCount} employee row${totalCount === 1 ? '' : 's'}`
    ) ?? `Processed ${totalCount} employee rows`;

  return {
    totalCount,
    createdCount,
    updatedCount,
    skippedCount,
    warnings,
    detail
  };
}

function extractDownloadFilename(contentDisposition?: string | null) {
  if (!contentDisposition) {
    return 'employees-export.csv';
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? 'employees-export.csv';
}

function readErrorStatus(error: unknown) {
  return error instanceof Error && 'status' in error ? Number((error as { status?: number }).status) : undefined;
}

function modulesFromPermissionKeys(permissionKeys: string[]) {
  return permissionKeys
    .map((permissionKey) => permissionKey.split('.')[0])
    .filter(Boolean)
    .map(formatLabel);
}

function actionsFromPermissionKeys(permissionKeys: string[]) {
  return permissionKeys
    .map((permissionKey) => permissionKey.split('.').slice(1).join('_') || 'view')
    .filter(Boolean)
    .map(formatLabel);
}

function extractFieldList(items: unknown[], keys: string[]) {
  return items
    .map((item) => readString(asRecord(item), keys))
    .filter((value): value is string => Boolean(value));
}

function normalizeRiskScoreValue(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return 0;
  }

  return value <= 1 ? value * 100 : value;
}

function normalizeRiskLevel(explicitLevel: number | undefined, score: number, status?: string) {
  if (explicitLevel !== undefined && Number.isFinite(explicitLevel)) {
    return Math.max(0, Math.min(4, Math.round(explicitLevel)));
  }

  const normalizedStatus = status?.trim().toLowerCase();
  if (normalizedStatus?.includes('critical') || normalizedStatus?.includes('high')) {
    return 4;
  }

  if (normalizedStatus?.includes('watch') || normalizedStatus?.includes('medium')) {
    return 3;
  }

  if (normalizedStatus?.includes('low')) {
    return 1;
  }

  if (score >= 80) {
    return 4;
  }

  if (score >= 60) {
    return 3;
  }

  if (score >= 30) {
    return 2;
  }

  if (score > 0) {
    return 1;
  }

  return 0;
}

function riskStatusLabel(level: number) {
  if (level >= 4) {
    return 'High risk';
  }

  if (level >= 3) {
    return 'Watch';
  }

  if (level >= 1) {
    return 'Normal';
  }

  return 'Low';
}

function fallbackNumericKpi(kpis: KpiMetric[], key: string) {
  const match = kpis.find((item) => item.key === key);
  return Number(match?.value ?? 0);
}

function fallbackDeltaKpi(kpis: KpiMetric[], key: string) {
  return kpis.find((item) => item.key === key)?.delta ?? '--';
}

function sortRiskScores(scores: RiskScoreRecord[]) {
  return [...scores].sort((left, right) => {
    if (right.riskLevel !== left.riskLevel) {
      return right.riskLevel - left.riskLevel;
    }

    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.employee.localeCompare(right.employee);
  });
}

function sortAccessMatrix(records: AccessMatrixRecord[]) {
  return [...records].sort((left, right) => {
    if (right.employeeCount !== left.employeeCount) {
      return right.employeeCount - left.employeeCount;
    }

    return left.role.localeCompare(right.role);
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

function compareAuditLogs(left: AuditLogRecord, right: AuditLogRecord) {
  return toTimestamp(right.timestamp) - toTimestamp(left.timestamp);
}

function compareAuditLogItems(left: AuditLogApiItem, right: AuditLogApiItem) {
  return (
    toTimestamp(readString(right, ['timestamp', 'occurred_at', 'created_at', 'updated_at'])) -
    toTimestamp(readString(left, ['timestamp', 'occurred_at', 'created_at', 'updated_at']))
  );
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
  const normalized = status.trim().toLowerCase();

  if (
    normalized === 'new' ||
    normalized === 'reviewing' ||
    normalized === 'reviewed' ||
    normalized === 'confirmed' ||
    normalized === 'ignored' ||
    normalized === 'closed'
  ) {
    return normalized;
  }

  if (normalized === 'open') {
    return 'reviewing';
  }

  return normalized;
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

function formatOptionalDateTime(value?: string | null) {
  if (!value) {
    return null;
  }

  return formatDateTime(value);
}

function normalizeTimeValue(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const timeMatch = trimmed.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
  }

  return trimmed;
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

function unwrapPrimaryRecord(payload: unknown) {
  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }

  return pickRecords(record, ['data', 'summary', 'result', 'dashboard']) ?? record;
}

function extractUnknownItems(payload: unknown, keys: string[] = ['items']): unknown[] | undefined {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const directValue = record[key];
    if (Array.isArray(directValue)) {
      return directValue;
    }

    const nestedValue = asRecord(directValue);
    if (!nestedValue) {
      continue;
    }

    const nestedItems: unknown[] | undefined = extractUnknownItems(nestedValue, [
      'items',
      'rows',
      'records',
      'results',
      'data'
    ]);
    if (nestedItems && nestedItems.length > 0) {
      return nestedItems;
    }
  }

  return undefined;
}

function collectRecordSources(...values: Array<Record<string, unknown> | undefined>) {
  return values.filter((value): value is Record<string, unknown> => Boolean(value));
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

function dedupeLabels(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
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

function buildAuditMetadataSummary(
  item: Record<string, unknown>,
  details?: Record<string, unknown>
) {
  const safeValues = [
    buildAuditMetadataLabel(item, 'event_id', 'Event'),
    buildAuditMetadataLabel(item, 'policy_name', 'Policy'),
    buildAuditMetadataLabel(item, 'policy_id', 'Policy ID'),
    buildAuditMetadataLabel(item, 'session_id', 'Session'),
    buildAuditMetadataLabel(item, 'risk_rule', 'Risk rule'),
    buildAuditMetadataLabel(item, 'severity', 'Severity'),
    buildAuditMetadataLabel(item, 'department', 'Department'),
    buildAuditMetadataLabel(item, 'role', 'Role'),
    buildAuditMetadataLabel(item, 'position', 'Position'),
    buildAuditMetadataLabel(item, 'streak_count', 'Streak'),
    buildAuditMetadataLabel(item, 'duration_seconds', 'Duration'),
    buildAuditMetadataLabel(item, 'retention_days', 'Retention'),
    buildAuditMetadataLabel(item, 'screenshot_interval_seconds', 'Interval'),
    buildAuditMetadataLabel(item, 'no_change_threshold', 'Threshold'),
    details ? buildAuditMetadataLabel(details, 'event_id', 'Event') : undefined,
    details ? buildAuditMetadataLabel(details, 'session_id', 'Session') : undefined,
    details ? buildAuditMetadataLabel(details, 'risk_rule', 'Risk rule') : undefined,
    details ? buildAuditMetadataLabel(details, 'severity', 'Severity') : undefined,
    details ? buildAuditMetadataLabel(details, 'streak_count', 'Streak') : undefined,
    details ? buildAuditMetadataLabel(details, 'duration_seconds', 'Duration') : undefined
  ].filter(Boolean);

  return safeValues.length > 0 ? safeValues.join(' / ') : undefined;
}

function buildAuditMetadataLabel(
  source: Record<string, unknown>,
  key: string,
  label: string
) {
  const stringValue = readString(source, [key]);
  if (stringValue) {
    return `${label} ${stringValue}`;
  }

  const numberValue = readNumber(source, [key]);
  if (numberValue !== undefined) {
    if (key.endsWith('_seconds')) {
      return `${label} ${formatDurationSeconds(numberValue)}`;
    }

    if (key.endsWith('_days')) {
      return `${label} ${numberValue}d`;
    }

    return `${label} ${numberValue}`;
  }

  return undefined;
}

function toTimestamp(value?: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}
