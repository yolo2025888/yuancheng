import type {
  AuditLogRecord,
  DeviceRecord,
  EmployeeRecord,
  EventRecord,
  GitHubRiskRecord,
  HeatmapPoint,
  KpiMetric,
  PolicyRecord,
  RealtimeStatusRecord,
  ScreenshotComparison,
  StatusBucket,
  TimelineSegment
} from '../types/models';

export const dashboardKpis: KpiMetric[] = [
  { key: 'online', title: 'Online devices', value: '128', delta: '+6', tone: 'positive' },
  { key: 'active', title: 'Active employees', value: '97', delta: '+12%', tone: 'positive' },
  { key: 'risk', title: 'High-risk events', value: '11', delta: '-2', tone: 'warning' },
  { key: 'github', title: 'GitHub risk events', value: '4', delta: '+1', tone: 'danger' }
];

export const workStatusSeries: StatusBucket[] = [
  { slot: '09:00', coding: 32, review: 8, meeting: 12, documentation: 5, communication: 7, idle: 4, locked: 1 },
  { slot: '10:00', coding: 38, review: 6, meeting: 10, documentation: 7, communication: 6, idle: 3, locked: 1 },
  { slot: '11:00', coding: 35, review: 9, meeting: 8, documentation: 8, communication: 5, idle: 4, locked: 2 },
  { slot: '12:00', coding: 12, review: 4, meeting: 3, documentation: 4, communication: 2, idle: 20, locked: 15 },
  { slot: '13:00', coding: 34, review: 7, meeting: 5, documentation: 7, communication: 4, idle: 2, locked: 1 },
  { slot: '14:00', coding: 41, review: 10, meeting: 6, documentation: 6, communication: 4, idle: 2, locked: 1 },
  { slot: '15:00', coding: 36, review: 11, meeting: 7, documentation: 8, communication: 5, idle: 3, locked: 1 },
  { slot: '16:00', coding: 29, review: 7, meeting: 12, documentation: 6, communication: 8, idle: 4, locked: 2 }
];

const heatmapEmployees = ['Wang Chen', 'Zhang Ning', 'Li Bo', 'Zhou Lan', 'Zhao Jing'];
const heatmapSlots = ['09', '10', '11', '12', '13', '14', '15', '16'];

export const employeeHeatmap: HeatmapPoint[] = heatmapEmployees.flatMap((employee, rowIndex) =>
  heatmapSlots.map((slot, colIndex) => {
    const riskLevel = [1, 2, 2, 0, 2, 3, 4, 2][(rowIndex + colIndex) % 8];
    const status =
      riskLevel >= 4 ? 'High risk' : riskLevel === 3 ? 'Watch' : riskLevel === 0 ? 'Break' : 'Normal';

    return {
      employee,
      slot: `${slot}:00`,
      riskLevel,
      status
    };
  })
);

export const events: EventRecord[] = [
  {
    id: 'EVT-1024',
    employee: 'Wang Chen',
    department: 'Platform Engineering',
    type: 'No-change streak',
    severity: 'high',
    status: 'reviewing',
    startedAt: '2026-05-11 14:05',
    duration: '18m',
    summary: 'IDE stayed in the foreground with near-zero aggregate input counters.'
  },
  {
    id: 'EVT-1023',
    employee: 'Zhang Ning',
    department: 'Frontend Engineering',
    type: 'Unexpected app focus',
    severity: 'medium',
    status: 'new',
    startedAt: '2026-05-11 13:48',
    duration: '9m',
    summary: 'Browser remained on non-work media pages without linked ticket context.'
  },
  {
    id: 'EVT-1022',
    employee: 'Zhou Lan',
    department: 'SRE',
    type: 'Agent offline',
    severity: 'critical',
    status: 'confirmed',
    startedAt: '2026-05-11 11:11',
    duration: '26m',
    summary: 'Device CN-SH-SRE-07 missed heartbeats before reconnecting.'
  },
  {
    id: 'EVT-1021',
    employee: 'Zhao Jing',
    department: 'Security Engineering',
    type: 'Frequent GitHub clone',
    severity: 'high',
    status: 'new',
    startedAt: '2026-05-11 10:32',
    duration: '5m',
    summary: 'Sensitive repository was cloned or fetched 12 times in a short period.'
  }
];

export const realtimeStatus: RealtimeStatusRecord[] = [
  {
    key: '1',
    employee: 'Wang Chen',
    department: 'Platform Engineering',
    role: 'Backend Engineer',
    device: 'CN-SH-RD-01',
    currentStatus: 'online',
    app: 'JetBrains Rider',
    activity: 'Coding',
    lastScreenshotAt: '14:24:08',
    noChangeCount: 5,
    riskLevel: 'watch'
  },
  {
    key: '2',
    employee: 'Zhang Ning',
    department: 'Frontend Engineering',
    role: 'Frontend Engineer',
    device: 'CN-SH-FE-03',
    currentStatus: 'online',
    app: 'Chrome',
    activity: 'Page debugging',
    lastScreenshotAt: '14:24:02',
    noChangeCount: 2,
    riskLevel: 'normal'
  },
  {
    key: '3',
    employee: 'Zhou Lan',
    department: 'SRE',
    role: 'Site Reliability Engineer',
    device: 'CN-SH-SRE-07',
    currentStatus: 'locked',
    app: 'Windows LockApp',
    activity: 'Locked session',
    lastScreenshotAt: '14:23:55',
    noChangeCount: 9,
    riskLevel: 'high'
  },
  {
    key: '4',
    employee: 'Zhao Jing',
    department: 'Security Engineering',
    role: 'Security Engineer',
    device: 'CN-SH-SEC-02',
    currentStatus: 'online',
    app: 'GitHub Desktop',
    activity: 'Repository sync',
    lastScreenshotAt: '14:23:59',
    noChangeCount: 1,
    riskLevel: 'watch'
  }
];

export const employees: EmployeeRecord[] = [
  {
    key: '1',
    employeeNo: 'E-001',
    name: 'Wang Chen',
    department: 'Platform Engineering',
    role: 'Engineering',
    position: 'Backend Engineer',
    manager: 'Lin Hang',
    status: 'active',
    devices: 2,
    todayRisk: 3,
    githubAccount: 'wangchen-dev',
    policyName: 'Engineering standard'
  },
  {
    key: '2',
    employeeNo: 'E-014',
    name: 'Zhang Ning',
    department: 'Frontend Engineering',
    role: 'Engineering',
    position: 'Frontend Engineer',
    manager: 'Song Ya',
    status: 'active',
    devices: 1,
    todayRisk: 1,
    githubAccount: 'zhangning-ui',
    policyName: 'Engineering standard'
  },
  {
    key: '3',
    employeeNo: 'E-021',
    name: 'Li Bo',
    department: 'Quality Engineering',
    role: 'Quality',
    position: 'QA Engineer',
    manager: 'Song Ya',
    status: 'active',
    devices: 1,
    todayRisk: 0,
    githubAccount: 'libo-qa',
    policyName: 'QA review profile'
  },
  {
    key: '4',
    employeeNo: 'E-035',
    name: 'Zhou Lan',
    department: 'SRE',
    role: 'Operations',
    position: 'Site Reliability Engineer',
    manager: 'Yao Chong',
    status: 'active',
    devices: 2,
    todayRisk: 2,
    githubAccount: 'zhoulan-ops',
    policyName: 'SRE high-idle tolerance'
  },
  {
    key: '5',
    employeeNo: 'E-042',
    name: 'Zhao Jing',
    department: 'Security Engineering',
    role: 'Security',
    position: 'Security Engineer',
    manager: 'Yao Chong',
    status: 'watch',
    devices: 1,
    todayRisk: 4,
    githubAccount: 'zhaojing-sec',
    policyName: 'Security strict review'
  }
];

export const devices: DeviceRecord[] = [
  {
    key: '1',
    deviceName: 'CN-SH-RD-01',
    employee: 'Wang Chen',
    employeeNo: 'E-001',
    department: 'Platform Engineering',
    role: 'Engineering',
    position: 'Backend Engineer',
    os: 'Windows 11',
    agentVersion: '0.1.6',
    lastHeartbeat: '14:24:09',
    status: 'online',
    metadataLabels: ['Console session', 'Desktop active', 'Switches 12', 'Wheel 4']
  },
  {
    key: '2',
    deviceName: 'CN-SH-FE-03',
    employee: 'Zhang Ning',
    employeeNo: 'E-014',
    department: 'Frontend Engineering',
    role: 'Engineering',
    position: 'Frontend Engineer',
    os: 'Windows 11',
    agentVersion: '0.1.6',
    lastHeartbeat: '14:24:02',
    status: 'online',
    metadataLabels: ['Remote session', 'Desktop active', 'Idle 48s', 'Switches 7']
  },
  {
    key: '3',
    deviceName: 'CN-SH-SRE-07',
    employee: 'Zhou Lan',
    employeeNo: 'E-035',
    department: 'SRE',
    role: 'Operations',
    position: 'Site Reliability Engineer',
    os: 'Windows 10',
    agentVersion: '0.1.5',
    lastHeartbeat: '14:23:10',
    status: 'warning',
    metadataLabels: ['Locked', 'Idle 640s', 'Desktop secure', 'Wheel 0']
  },
  {
    key: '4',
    deviceName: 'CN-SH-QA-02',
    employee: 'Li Bo',
    employeeNo: 'E-021',
    department: 'Quality Engineering',
    role: 'Quality',
    position: 'QA Engineer',
    os: 'Windows 11',
    agentVersion: '0.1.6',
    lastHeartbeat: '14:21:44',
    status: 'offline',
    metadataLabels: ['Desktop unavailable']
  }
];

export const timelineKpis: KpiMetric[] = [
  { key: 'session', title: 'Work session length', value: '7h 18m', delta: '+22m', tone: 'positive' },
  { key: 'effective', title: 'Effective change time', value: '5h 42m', delta: '78%', tone: 'positive' },
  { key: 'idle', title: 'Idle time', value: '43m', delta: '-9m', tone: 'warning' },
  { key: 'github', title: 'GitHub activity', value: '16', delta: '+3', tone: 'default' }
];

export const timelineSegments: TimelineSegment[] = [
  { time: '09:10', label: 'Coding', detail: 'Rider + PostgreSQL migration script', status: 'working' },
  { time: '10:00', label: 'Code review', detail: 'GitHub PR #182 review', status: 'working' },
  { time: '11:25', label: 'Meeting', detail: 'Feishu sync for 25 minutes', status: 'meeting' },
  { time: '14:05', label: 'No-change streak', detail: 'Rider stayed unchanged for 18 minutes', status: 'risk' },
  { time: '15:10', label: 'Recovered work', detail: 'Terminal output and editor activity resumed', status: 'working' },
  { time: '16:02', label: 'Documentation', detail: 'Confluence API design draft', status: 'idle' }
];

export const screenshotComparison: ScreenshotComparison = {
  currentImageLabel: 'Current screenshot 14:23:58',
  previousImageLabel: 'Previous screenshot 14:13:58',
  metrics: [
    { label: 'pHash distance', value: '2', hint: 'Below the workstation threshold of 6.' },
    { label: 'SSIM', value: '0.992', hint: 'Structural changes are minimal.' },
    { label: 'Changed block ratio', value: '3.1%', hint: 'Changes are concentrated in cursor and clock regions.' },
    { label: 'Keyboard / Mouse', value: '1 / 2', hint: 'Aggregate counters only. No raw input content is stored.' }
  ],
  reasoning: [
    'Foreground application remained JetBrains Rider and the window title did not change.',
    'Six consecutive frames stayed below the role threshold and entered the watch queue.',
    'Review against employee explanation and related GitHub activity before closing the event.'
  ]
};

export const policies: PolicyRecord[] = [
  {
    key: '1',
    name: 'Engineering standard',
    version: '2026.05',
    roles: ['Engineering'],
    role: 'Engineering',
    positions: ['Backend Engineer', 'Frontend Engineer'],
    departments: ['Platform Engineering', 'Frontend Engineering'],
    status: 'active',
    isActive: true,
    assignedEmployees: 34,
    screenshotIntervalSeconds: 10,
    screenshotInterval: '10s',
    noChangeThresholdFrames: 6,
    noChangeThreshold: '6 frames',
    highRiskDurationSeconds: 60,
    highRiskDuration: '1m',
    ocrEnabled: true,
    retentionDays: 7,
    originalRetention: '7 days'
  },
  {
    key: '2',
    name: 'QA review profile',
    version: '2026.05',
    roles: ['Quality'],
    role: 'Quality',
    positions: ['QA Engineer', 'Test Lead'],
    departments: ['Quality Engineering'],
    status: 'active',
    isActive: true,
    assignedEmployees: 11,
    screenshotIntervalSeconds: 12,
    screenshotInterval: '12s',
    noChangeThresholdFrames: 8,
    noChangeThreshold: '8 frames',
    highRiskDurationSeconds: 120,
    highRiskDuration: '2m',
    ocrEnabled: true,
    retentionDays: 7,
    originalRetention: '7 days'
  },
  {
    key: '3',
    name: 'SRE high-idle tolerance',
    version: '2026.05',
    roles: ['Operations'],
    role: 'Operations',
    positions: ['Site Reliability Engineer'],
    departments: ['SRE'],
    status: 'active',
    isActive: true,
    assignedEmployees: 8,
    screenshotIntervalSeconds: 10,
    screenshotInterval: '10s',
    noChangeThresholdFrames: 12,
    noChangeThreshold: '12 frames',
    highRiskDurationSeconds: 120,
    highRiskDuration: '2m',
    ocrEnabled: true,
    retentionDays: 3,
    originalRetention: '3 days'
  },
  {
    key: '4',
    name: 'Security strict review',
    version: '2026.05',
    roles: ['Security'],
    role: 'Security',
    positions: ['Security Engineer', 'Incident Responder'],
    departments: ['Security Engineering'],
    status: 'draft',
    isActive: false,
    assignedEmployees: 6,
    screenshotIntervalSeconds: 8,
    screenshotInterval: '8s',
    noChangeThresholdFrames: 5,
    noChangeThreshold: '5 frames',
    highRiskDurationSeconds: 40,
    highRiskDuration: '40s',
    ocrEnabled: false,
    retentionDays: 3,
    originalRetention: '3 days'
  }
];

export const auditLogs: AuditLogRecord[] = [
  {
    key: '1',
    operator: 'Liu Yi',
    action: 'Viewed original screenshot',
    target: 'Wang Chen / EVT-1024',
    reason: 'Re-check high-risk no-change event',
    timestamp: '2026-05-11 14:20:05',
    result: 'Approved'
  },
  {
    key: '2',
    operator: 'Yao Chong',
    action: 'Updated policy',
    target: 'SRE high-idle tolerance',
    reason: 'Reduce false positives',
    timestamp: '2026-05-11 13:11:18',
    result: 'Applied'
  },
  {
    key: '3',
    operator: 'Chen Rui',
    action: 'Exported events',
    target: 'GitHub risk 2026-05-10',
    reason: 'Weekly security report prep',
    timestamp: '2026-05-11 10:02:41',
    result: 'Logged'
  }
];

export const githubRisks: GitHubRiskRecord[] = [
  {
    key: '1',
    employee: 'Zhao Jing',
    repository: 'corp/infra-secrets',
    action: 'clone',
    riskRule: 'Frequent sensitive repository clone',
    severity: 'critical',
    timestamp: '2026-05-11 10:32',
    correlation: 'Linked device CN-SH-SEC-02'
  },
  {
    key: '2',
    employee: 'Wang Chen',
    repository: 'corp/core-platform',
    action: 'review',
    riskRule: 'Off-hours review',
    severity: 'medium',
    timestamp: '2026-05-10 22:14',
    correlation: 'Linked screenshots show normal coding context'
  },
  {
    key: '3',
    employee: 'Zhang Ning',
    repository: 'corp/admin-console',
    action: 'fetch',
    riskRule: 'Short-window frequent fetch',
    severity: 'high',
    timestamp: '2026-05-11 09:48',
    correlation: 'Linked screenshots show page debugging'
  }
];

export const githubTrend = [
  ['09:00', 1],
  ['10:00', 4],
  ['11:00', 2],
  ['12:00', 0],
  ['13:00', 3],
  ['14:00', 5],
  ['15:00', 2]
] as const;
