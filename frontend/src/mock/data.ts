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
  { key: 'online', title: '在线设备', value: '128', delta: '+6', tone: 'positive' },
  { key: 'active', title: '活跃员工', value: '97', delta: '+12%', tone: 'positive' },
  { key: 'risk', title: '今日高风险事件', value: '11', delta: '-2', tone: 'warning' },
  { key: 'github', title: 'GitHub 风险事件', value: '4', delta: '+1', tone: 'danger' }
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

const heatmapEmployees = ['王晨', '张宁', '李博', '周岚', '赵璟'];
const heatmapSlots = ['09', '10', '11', '12', '13', '14', '15', '16'];

export const employeeHeatmap: HeatmapPoint[] = heatmapEmployees.flatMap((employee, rowIndex) =>
  heatmapSlots.map((slot, colIndex) => {
    const riskLevel = [1, 2, 2, 0, 2, 3, 4, 2][(rowIndex + colIndex) % 8];
    const status = riskLevel >= 4 ? '高风险静止' : riskLevel === 3 ? '需关注' : riskLevel === 0 ? '午休' : '正常';

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
    employee: '王晨',
    department: '平台研发',
    type: '连续无变化',
    severity: 'high',
    status: 'reviewing',
    startedAt: '2026-05-11 14:05',
    duration: '18 分钟',
    summary: 'IDE 前台持续无变化，键鼠计数接近 0'
  },
  {
    id: 'EVT-1023',
    employee: '张宁',
    department: '前端研发',
    type: '非工作应用',
    severity: 'medium',
    status: 'new',
    startedAt: '2026-05-11 13:48',
    duration: '9 分钟',
    summary: '浏览器停留在视频站点，未关联工单'
  },
  {
    id: 'EVT-1022',
    employee: '周岚',
    department: 'SRE',
    type: 'Agent 离线',
    severity: 'critical',
    status: 'confirmed',
    startedAt: '2026-05-11 11:11',
    duration: '26 分钟',
    summary: '设备 CN-SH-SRE-07 心跳中断后恢复'
  },
  {
    id: 'EVT-1021',
    employee: '赵璟',
    department: '安全工程',
    type: 'GitHub 高频 clone',
    severity: 'high',
    status: 'new',
    startedAt: '2026-05-11 10:32',
    duration: '5 分钟',
    summary: '敏感仓库连续 clone/fetch 12 次'
  }
];

export const realtimeStatus: RealtimeStatusRecord[] = [
  {
    key: '1',
    employee: '王晨',
    department: '平台研发',
    role: '后端工程师',
    device: 'CN-SH-RD-01',
    currentStatus: '在线',
    app: 'JetBrains Rider',
    activity: '编码',
    lastScreenshotAt: '14:24:08',
    noChangeCount: 5,
    riskLevel: 'watch'
  },
  {
    key: '2',
    employee: '张宁',
    department: '前端研发',
    role: '前端工程师',
    device: 'CN-SH-FE-03',
    currentStatus: '在线',
    app: 'Chrome',
    activity: '页面调试',
    lastScreenshotAt: '14:24:02',
    noChangeCount: 2,
    riskLevel: 'normal'
  },
  {
    key: '3',
    employee: '周岚',
    department: 'SRE',
    role: '运维工程师',
    device: 'CN-SH-SRE-07',
    currentStatus: '锁屏',
    app: 'Windows LockApp',
    activity: '锁屏',
    lastScreenshotAt: '14:23:55',
    noChangeCount: 9,
    riskLevel: 'high'
  },
  {
    key: '4',
    employee: '赵璟',
    department: '安全工程',
    role: '安全工程师',
    device: 'CN-SH-SEC-02',
    currentStatus: '在线',
    app: 'GitHub Desktop',
    activity: '仓库同步',
    lastScreenshotAt: '14:23:59',
    noChangeCount: 1,
    riskLevel: 'watch'
  }
];

export const employees: EmployeeRecord[] = [
  { key: '1', name: '王晨', department: '平台研发', role: '后端工程师', manager: '林舟', devices: 2, todayRisk: 3, githubAccount: 'wangchen-dev' },
  { key: '2', name: '张宁', department: '前端研发', role: '前端工程师', manager: '宋雅', devices: 1, todayRisk: 1, githubAccount: 'zhangning-ui' },
  { key: '3', name: '李博', department: '测试质量', role: '测试工程师', manager: '宋雅', devices: 1, todayRisk: 0, githubAccount: 'libo-qa' },
  { key: '4', name: '周岚', department: 'SRE', role: '运维工程师', manager: '姚骁', devices: 2, todayRisk: 2, githubAccount: 'zhoulan-ops' },
  { key: '5', name: '赵璟', department: '安全工程', role: '安全工程师', manager: '姚骁', devices: 1, todayRisk: 4, githubAccount: 'zhaojing-sec' }
];

export const devices: DeviceRecord[] = [
  { key: '1', deviceName: 'CN-SH-RD-01', employee: '王晨', os: 'Windows 11', agentVersion: '0.1.6', lastHeartbeat: '14:24:09', status: 'online' },
  { key: '2', deviceName: 'CN-SH-FE-03', employee: '张宁', os: 'Windows 11', agentVersion: '0.1.6', lastHeartbeat: '14:24:02', status: 'online' },
  { key: '3', deviceName: 'CN-SH-SRE-07', employee: '周岚', os: 'Windows 10', agentVersion: '0.1.5', lastHeartbeat: '14:23:10', status: 'warning' },
  { key: '4', deviceName: 'CN-SH-QA-02', employee: '李博', os: 'Windows 11', agentVersion: '0.1.6', lastHeartbeat: '14:21:44', status: 'offline' }
];

export const timelineKpis: KpiMetric[] = [
  { key: 'session', title: '工作会话时长', value: '7h 18m', delta: '+22m', tone: 'positive' },
  { key: 'effective', title: '有效变化时长', value: '5h 42m', delta: '78%', tone: 'positive' },
  { key: 'idle', title: '静止时长', value: '43m', delta: '-9m', tone: 'warning' },
  { key: 'github', title: 'GitHub 活动', value: '16', delta: '+3', tone: 'default' }
];

export const timelineSegments: TimelineSegment[] = [
  { time: '09:10', label: '编码', detail: 'Rider + PostgreSQL 迁移脚本', status: 'working' },
  { time: '10:00', label: '代码评审', detail: 'GitHub PR #182 review', status: 'working' },
  { time: '11:25', label: '例会', detail: '飞书会议 25 分钟', status: 'meeting' },
  { time: '14:05', label: '连续无变化', detail: 'Rider 前台静止 18 分钟', status: 'risk' },
  { time: '15:10', label: '恢复工作', detail: '终端输出与代码编辑恢复', status: 'working' },
  { time: '16:02', label: '文档整理', detail: 'Confluence 接口方案', status: 'idle' }
];

export const screenshotComparison: ScreenshotComparison = {
  currentImageLabel: '当前截图 14:23:58',
  previousImageLabel: '上一张截图 14:13:58',
  metrics: [
    { label: 'pHash 距离', value: '2', hint: '低于岗位阈值 6' },
    { label: 'SSIM', value: '0.992', hint: '结构变化极低' },
    { label: '变化块比例', value: '3.1%', hint: '主要集中在光标与时间区域' },
    { label: '键鼠计数', value: '键盘 1 / 鼠标 2', hint: '不足以判定有效操作' }
  ],
  reasoning: [
    '前台应用为 JetBrains Rider，窗口标题未变化。',
    '连续 6 次截图差分低于岗位阈值，已进入高风险观察。',
    '可结合员工说明和 GitHub 活动判断是否为正常阅读代码场景。'
  ]
};

export const policies: PolicyRecord[] = [
  { key: '1', role: '后端工程师', screenshotInterval: '10 秒', noChangeThreshold: '6 次', highRiskDuration: '5 分钟', ocrEnabled: true, originalRetention: '7 天' },
  { key: '2', role: '前端工程师', screenshotInterval: '10 秒', noChangeThreshold: '6 次', highRiskDuration: '5 分钟', ocrEnabled: true, originalRetention: '7 天' },
  { key: '3', role: '运维工程师', screenshotInterval: '10 秒', noChangeThreshold: '12 次', highRiskDuration: '10 分钟', ocrEnabled: true, originalRetention: '3 天' },
  { key: '4', role: '产品经理', screenshotInterval: '15 秒', noChangeThreshold: '12 次', highRiskDuration: '10 分钟', ocrEnabled: false, originalRetention: '3 天' }
];

export const auditLogs: AuditLogRecord[] = [
  { key: '1', operator: '刘衡', action: '查看原图', target: '王晨 / EVT-1024', reason: '复核高风险连续无变化事件', timestamp: '2026-05-11 14:20:05', result: '已授权' },
  { key: '2', operator: '姚骁', action: '修改策略', target: '运维工程师模板', reason: '降低误报率', timestamp: '2026-05-11 13:11:18', result: '已生效' },
  { key: '3', operator: '陈荟', action: '导出事件', target: 'GitHub 风险 2026-05-10', reason: '安全周报整理', timestamp: '2026-05-11 10:02:41', result: '已记录' }
];

export const githubRisks: GitHubRiskRecord[] = [
  { key: '1', employee: '赵璟', repository: 'corp/infra-secrets', action: 'clone', riskRule: '敏感仓库高频 clone', severity: 'critical', timestamp: '2026-05-11 10:32', correlation: '关联设备 CN-SH-SEC-02' },
  { key: '2', employee: '王晨', repository: 'corp/core-platform', action: 'review', riskRule: '非工作时段 review', severity: 'medium', timestamp: '2026-05-10 22:14', correlation: '关联截图正常编码' },
  { key: '3', employee: '张宁', repository: 'corp/admin-console', action: 'fetch', riskRule: '短时高频 fetch', severity: 'high', timestamp: '2026-05-11 09:48', correlation: '关联截图页面调试' }
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
