import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';

import { defaultLanguage, translations, type Language, type TranslationKey } from './translations';

type TranslationValues = Record<string, string | number | null | undefined>;

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  antdLocale: typeof zhCN;
  t: (key: TranslationKey, fallback?: string, values?: TranslationValues) => string;
  text: (value?: string | null) => string;
};

const STORAGE_KEY = 'employee-monitor-admin-language';
const I18nContext = createContext<I18nContextValue | null>(null);

const antdLocales = {
  zh: zhCN,
  en: enUS
} satisfies Record<Language, typeof zhCN>;

const dynamicZhText: Record<string, string> = {
  'Access denied': '访问被拒绝',
  'Active employees': '活跃员工',
  'Admin review active': '管理审核进行中',
  'Agent offline': 'Agent 离线',
  Applied: '已应用',
  Approved: '已批准',
  Break: '休息',
  'Clock in': '上班打卡',
  'Clock out': '下班打卡',
  Coding: '编码',
  'Code review': '代码评审',
  Communication: '沟通',
  'Current screenshot 14:23:58': '当前截图 14:23:58',
  Documentation: '文档',
  'Effective change time': '有效变化时间',
  'Engineering standard': '工程标准',
  'Fallback defaults': '降级默认值',
  'Fallback queue': '降级队列',
  'Frequent GitHub clone': '频繁 GitHub clone',
  'GitHub activity': 'GitHub 活动',
  'GitHub risk events': 'GitHub 风险事件',
  'High risk': '高风险',
  'High-risk events': '高风险事件',
  Idle: '空闲',
  'Idle time': '空闲时间',
  Issued: '已签发',
  Late: '迟到',
  'Local admin fallback': '本地管理降级',
  'Local dev fallback': '本地开发降级',
  'Local time': '本地时间',
  Locked: '锁定',
  'Meeting': '会议',
  Normal: '正常',
  'No-change streak': '无变化连续',
  'Not issued': '未签发',
  'Online devices': '在线设备',
  'Previous screenshot 14:13:58': '上一张截图 14:13:58',
  'QA review profile': 'QA 审核档案',
  Review: '评审',
  Reviewed: '已审核',
  Revoked: '已吊销',
  'SRE high-idle tolerance': 'SRE 高空闲容忍策略',
  'Security strict review': '安全严格审核',
  'Work session length': '工作会话时长',
  Watch: '关注'
};

const additionalDynamicZhText: Record<string, string> = {
  Active: '启用',
  inactive: '停用',
  Inactive: '停用',
  Unassigned: '未分配',
  General: '通用',
  'Backend Engineer': '后端工程师',
  'Frontend Engineer': '前端工程师',
  'QA Engineer': '测试工程师',
  'Test Lead': '测试负责人',
  'Site Reliability Engineer': '站点可靠性工程师',
  'Security Engineer': '安全工程师',
  'Incident Responder': '应急响应工程师',
  Engineering: '工程',
  Quality: '质量',
  Operations: '运维',
  Security: '安全',
  'Platform Engineering': '平台工程',
  'Frontend Engineering': '前端工程',
  'Quality Engineering': '质量工程',
  SRE: 'SRE',
  'Security Engineering': '安全工程',
  'Console session': '控制台会话',
  'Desktop active': '桌面活跃',
  'Remote session': '远程会话',
  'Locked': '已锁定',
  'Desktop secure': '安全桌面',
  'Desktop unavailable': '桌面不可用',
  'Page debugging': '页面调试',
  'Locked session': '锁定会话',
  'Repository sync': '仓库同步',
  'Unexpected app focus': '异常应用焦点',
  'Frequent sensitive repository clone': '敏感仓库频繁 clone',
  'Off-hours review': '非工作时间评审',
  'Short-window frequent fetch': '短时间频繁 fetch',
  'Linked device CN-SH-SEC-02': '关联设备 CN-SH-SEC-02',
  'Linked screenshots show normal coding context': '关联截图显示正常编码上下文',
  'Linked screenshots show page debugging': '关联截图显示页面调试',
  clone: 'clone',
  fetch: 'fetch',
  review: '评审',
  'Viewed original screenshot': '查看原始截图',
  'Updated policy': '更新策略',
  'Exported events': '导出事件',
  'Re-check high-risk no-change event': '复核高风险无变化连续事件',
  'Reduce false positives': '减少误报',
  'Weekly security report prep': '周度安全报告准备',
  Logged: '已记录',
  'pHash distance': 'pHash 距离',
  SSIM: 'SSIM',
  'Changed block ratio': '变化块比例',
  'Keyboard / Mouse': '键盘 / 鼠标',
  'Below the workstation threshold of 6.': '低于工作站阈值 6。',
  'Structural changes are minimal.': '结构变化很小。',
  'Changes are concentrated in cursor and clock regions.': '变化集中在光标和时钟区域。',
  'Aggregate counters only. No raw input content is stored.': '仅聚合计数，不存储原始输入内容。',
  'Foreground application remained JetBrains Rider and the window title did not change.':
    '前台应用保持为 JetBrains Rider，窗口标题未变化。',
  'Six consecutive frames stayed below the role threshold and entered the watch queue.':
    '连续六帧低于角色阈值，已进入关注队列。',
  'Review against employee explanation and related GitHub activity before closing the event.':
    '关闭事件前请结合员工说明和相关 GitHub 活动复核。',
  'Rider + PostgreSQL migration script': 'Rider + PostgreSQL 迁移脚本',
  'GitHub PR #182 review': 'GitHub PR #182 评审',
  'Feishu sync for 25 minutes': '飞书同步 25 分钟',
  'Rider stayed unchanged for 18 minutes': 'Rider 连续 18 分钟无变化',
  'Terminal output and editor activity resumed': '终端输出和编辑器活动已恢复',
  'Confluence API design draft': 'Confluence API 设计草稿',
  'Recovered work': '恢复工作',
  'IDE stayed in the foreground with near-zero aggregate input counters.':
    'IDE 保持前台，聚合输入计数几乎为零。',
  'Browser remained on non-work media pages without linked ticket context.':
    '浏览器停留在非工作媒体页面，且无关联工单上下文。',
  'Device CN-SH-SRE-07 missed heartbeats before reconnecting.':
    '设备 CN-SH-SRE-07 在重连前心跳缺失。',
  'Sensitive repository was cloned or fetched 12 times in a short period.':
    '敏感仓库在短时间内被 clone 或 fetch 12 次。',
  'No effective change': '无有效变化',
  'Effective change': '有有效变化',
  'Effective change unknown': '有效变化未知',
  Major: '重大',
  Medium: '中',
  Minor: '轻微',
  Low: '低',
  Critical: '严重',
  High: '高',
  New: '新建',
  Reviewing: '审核中',
  Confirmed: '已确认',
  Ignored: '已忽略',
  Closed: '已关闭',
  'Live API': '实时 API',
  'Backend unavailable': '后端不可用',
  'Device not found': '设备不存在',
  'Endpoint unavailable': '接口不可用',
  'Validation failed': '校验失败',
  'Save failed': '保存失败',
  'Record unavailable': '记录不可用',
  'Not connected': '未连接',
  'Change level': '变化等级',
  'Similarity': '相似度',
  'Distance': '距离',
  'Activity': '活动',
  'Reason': '原因',
  'Linked risks': '关联风险',
  Dashboard: '仪表盘',
  Employees: '员工',
  Timeline: '时间线',
  Events: '事件',
  Devices: '设备',
  Policies: '策略',
  'Realtime Status': '实时状态',
  'Screenshot Detail': '截图详情',
  'GitHub Risk': 'GitHub 风险',
  'Audit Logs': '审计日志',
  View: '查看',
  Filter: '筛选',
  Acknowledge: '确认',
  'Assign Policy': '分配策略',
  Export: '导出',
  Escalate: '升级处理',
  'Adjust Policy': '调整策略'
};

const exhaustiveZhText: Record<string, string> = {
  'Default attendance rule': '默认考勤规则',
  'Dashboard summary loaded': '仪表盘汇总已加载',
  'Access matrix payload did not contain usable role rows': '访问矩阵数据不包含可用角色行',
  'Employees payload is not an array': '员工数据不是数组',
  'Employee CSV export prepared': '员工 CSV 导出已准备好',
  'No employee import payload was configured': '未配置员工导入内容',
  'Employee CSV import completed': '员工 CSV 导入完成',
  'Devices payload is not an array': '设备数据不是数组',
  'Device token response did not include a token': '设备 token 响应未包含 token',
  'Issued a device-scoped agent token': '已签发设备级客户端 token',
  'Device token revoke response did not include revoked_at': '设备 token 吊销响应未包含吊销时间',
  'Revoked the device-scoped agent token': '已吊销设备级客户端 token',
  'No employee_id could be discovered from live data': '实时数据中未发现 employee_id',
  'Review queue endpoint unavailable': '审核队列接口不可用',
  'Review updated but event refresh used fallback data': '审核已更新，但事件刷新使用了降级数据',
  'Review updated but attendance refresh used fallback data': '审核已更新，但考勤刷新使用了降级数据',
  'No previous screenshot': '无上一张截图',
  'Policies payload is not an array': '策略数据不是数组',
  'Audit log payload is not an array': '审计日志数据不是数组',
  'Attendance payload is not an array': '考勤数据不是数组',
  'Default attendance rule update API is not available on this backend.': '当前后端未提供默认考勤规则更新接口。',
  'No GitHub risk endpoint responded': '没有 GitHub 风险接口响应',
  'GitHub risk API returned no events': 'GitHub 风险接口未返回事件',
  'GitHub risk payload did not contain a usable list': 'GitHub 风险数据不包含可用列表',
  'GitHub risk payload items could not be normalized': 'GitHub 风险数据项无法规范化',
  'Unknown employee': '未知员工',
  'Unknown repository': '未知仓库',
  'GitHub risk event': 'GitHub 风险事件',
  'No linked context': '无关联上下文',
  'Unknown time': '未知时间',
  'No mutation attempt was configured': '未配置变更请求',
  'No live activity summary': '无实时活动摘要',
  'All roles': '全部角色',
  'Unknown action': '未知操作',
  'Unspecified target': '未指定目标',
  'Backend rule': '后端规则',
  'Review queue payload did not contain a usable list': '审核队列数据不包含可用列表',
  'Escalated risk score': '风险分升高',
  'Risk watch': '风险关注',
  'No live summary': '无实时摘要',
  'No no-change streak': '无连续无变化',
  'No screenshot available': '无可用截图',
  'No live screenshot was returned by the backend.': '后端未返回实时截图。',
  'Rule-based mock activity summary only.': '仅提供基于规则的 mock 活动摘要。',
  'Confidence floor': '置信度下限',
  'Review threshold': '复核阈值',
  'Normalized from live or mock screenshot diff fields.': '由实时或 mock 截图差异字段规范化而来。',
  'Shows whether the capture should count as valid work-state change.': '表示该采集是否应计为有效工作状态变化。',
  'Portion of blocks that changed between adjacent screenshots.': '相邻截图之间发生变化的块占比。',
  'Higher values generally mean the screenshots are more alike.': '数值越高通常表示截图越相似。',
  'Distance-style diff metric from the backend when available.': '后端可用时返回的距离型差异指标。',
  'Backend-compatible reason text shown defensively when present.': '存在时防御性展示后端兼容原因文本。',
  'No previous frame is available from the current source.': '当前来源没有可用的上一帧。',
  'This frame is linked to a no-change streak risk and should be reviewed in context.': '该帧关联连续无变化风险，需要结合上下文复核。',
  'No no-change streak risk is linked to this frame.': '该帧未关联连续无变化风险。',
  'Linked risk from timeline': '来自时间线的关联风险',
  'Policy ID': '策略 ID',
  'Risk rule': '风险规则',
  'Request timed out': '请求超时',
  'Unknown API error': '未知 API 错误',
  'Wang Chen': '王晨',
  'Zhang Ning': '张宁',
  'Li Bo': '李博',
  'Zhou Lan': '周岚',
  'Zhao Jing': '赵静',
  'Lin Hang': '林航',
  'Song Ya': '宋雅',
  'Yao Chong': '姚冲',
  'Liu Yi': '刘一',
  'Chen Rui': '陈睿',
  'Clock-in after 09:30': '09:30 后上班打卡',
  'Clock-out before 18:00': '18:00 前下班打卡',
  'Windows LockApp': 'Windows 锁屏应用'
};

function translateDynamicPattern(value: string) {
  const durationMatch = value.match(/^(\+?)(\d+)h(?:\s+(\d+)m)?$/);
  if (durationMatch) {
    return `${durationMatch[1]}${durationMatch[2]} 小时${durationMatch[3] ? ` ${durationMatch[3]} 分钟` : ''}`;
  }

  const minuteMatch = value.match(/^(\+?)(\d+)m$/);
  if (minuteMatch) {
    return `${minuteMatch[1]}${minuteMatch[2]} 分钟`;
  }

  const employeeMatch = value.match(/^Employee (\d+)$/);
  if (employeeMatch) {
    return `员工 ${employeeMatch[1]}`;
  }

  const policyMatch = value.match(/^Policy (\d+)$/);
  if (policyMatch) {
    return `策略 ${policyMatch[1]}`;
  }

  const roleMatch = value.match(/^Role (\d+)$/);
  if (roleMatch) {
    return `角色 ${roleMatch[1]}`;
  }

  const deviceMatch = value.match(/^Device (.+)$/);
  if (deviceMatch) {
    return `设备 ${deviceMatch[1]}`;
  }

  const scoreMatch = value.match(/^Score (\d+)$/);
  if (scoreMatch) {
    return `分数 ${scoreMatch[1]}`;
  }

  const linkedEventsMatch = value.match(/^(\d+) linked events?$/);
  if (linkedEventsMatch) {
    return `${linkedEventsMatch[1]} 个关联事件`;
  }

  const devicesTotalMatch = value.match(/^of (\d+) devices$/);
  if (devicesTotalMatch) {
    return `共 ${devicesTotalMatch[1]} 台设备`;
  }

  const employeesTotalMatch = value.match(/^of (\d+) employees$/);
  if (employeesTotalMatch) {
    return `共 ${employeesTotalMatch[1]} 名员工`;
  }

  const reviewMatch = value.match(/^(\d+) in review$/);
  if (reviewMatch) {
    return `${reviewMatch[1]} 个待复核`;
  }

  const watchlistMatch = value.match(/^(\d+) watchlist$/);
  if (watchlistMatch) {
    return `${watchlistMatch[1]} 个关注对象`;
  }

  const flaggedMatch = value.match(/^(\d+) employees flagged$/);
  if (flaggedMatch) {
    return `${flaggedMatch[1]} 名员工已标记`;
  }

  const noChangeMatch = value.match(/^(\d+) no-change streak$/);
  if (noChangeMatch) {
    return `${noChangeMatch[1]} 个连续无变化`;
  }

  const processedRowsMatch = value.match(/^Processed (\d+) employee rows?$/);
  if (processedRowsMatch) {
    return `已处理 ${processedRowsMatch[1]} 行员工数据`;
  }

  const loadedGithubMatch = value.match(/^Loaded (\d+) GitHub risk events$/);
  if (loadedGithubMatch) {
    return `已加载 ${loadedGithubMatch[1]} 个 GitHub 风险事件`;
  }

  const activityFromMockMatch = value.match(/^(.+) activity from mock timeline data\.$/);
  if (activityFromMockMatch) {
    return `${translateZhToken(activityFromMockMatch[1])}活动来自 mock 时间线数据。`;
  }

  const activityInferredMatch = value.match(/^(.+) activity inferred from mock timeline data\.$/);
  if (activityInferredMatch) {
    return `${translateZhToken(activityInferredMatch[1])}活动由 mock 时间线数据推断。`;
  }

  const activeAppMatch = value.match(/^Active app: (.+)$/);
  if (activeAppMatch) {
    return `前台应用：${translateZhToken(activeAppMatch[1])}`;
  }

  const confidenceMatch = value.match(/^Activity confidence: (.+)$/);
  if (confidenceMatch) {
    return `活动置信度：${confidenceMatch[1] === 'unknown' ? '未知' : confidenceMatch[1]}`;
  }

  const comparedFrameMatch = value.match(/^Compared against previous frame at (.+)$/);
  if (comparedFrameMatch) {
    return `已与 ${comparedFrameMatch[1]} 的上一帧对比`;
  }

  const diffReasonMatch = value.match(/^Diff reason: (.+)$/);
  if (diffReasonMatch) {
    return `差异原因：${diffReasonMatch[1]}`;
  }

  const switchMatch = value.match(/^Switches (\d+)$/);
  if (switchMatch) {
    return `切换 ${switchMatch[1]} 次`;
  }

  const wheelMatch = value.match(/^Wheel (\d+)$/);
  if (wheelMatch) {
    return `滚轮 ${wheelMatch[1]} 次`;
  }

  const idleMatch = value.match(/^Idle (\d+)s$/);
  if (idleMatch) {
    return `空闲 ${idleMatch[1]} 秒`;
  }

  const framesMatch = value.match(/^(\d+) frames$/);
  if (framesMatch) {
    return `${framesMatch[1]} 帧`;
  }

  const daysMatch = value.match(/^(\d+) days$/);
  if (daysMatch) {
    return `${daysMatch[1]} 天`;
  }

  const streakMatch = value.match(/^Streak count (\d+)$/);
  if (streakMatch) {
    return `连续次数 ${streakMatch[1]}`;
  }

  const exportUnavailable = value.match(/^Employee CSV export unavailable: (.+)$/);
  if (exportUnavailable) {
    return `员工 CSV 导出不可用：${exportUnavailable[1]}`;
  }

  const importUnavailable = value.match(/^Employee CSV import unavailable: (.+)$/);
  if (importUnavailable) {
    return `员工 CSV 导入不可用：${importUnavailable[1]}`;
  }

  const deviceIssueFailed = value.match(/^Device token issue failed: (.+)$/);
  if (deviceIssueFailed) {
    return `设备 token 签发失败：${deviceIssueFailed[1]}`;
  }

  const deviceRevokeFailed = value.match(/^Device token revoke failed: (.+)$/);
  if (deviceRevokeFailed) {
    return `设备 token 吊销失败：${deviceRevokeFailed[1]}`;
  }

  const reviewKeptLocal = value.match(/^Review kept locally only: (.+)$/);
  if (reviewKeptLocal) {
    return `审核仅保留在本地：${reviewKeptLocal[1]}`;
  }

  const attendanceUnavailable = value.match(/^Attendance record is unavailable: (.+)$/);
  if (attendanceUnavailable) {
    return `考勤记录不可用：${attendanceUnavailable[1]}`;
  }

  const createdEmployee = value.match(/^Created employee (.+)$/);
  if (createdEmployee) {
    return `已创建员工 ${createdEmployee[1]}`;
  }

  const savedEmployee = value.match(/^Saved employee (.+)$/);
  if (savedEmployee) {
    return `已保存员工 ${savedEmployee[1]}`;
  }

  const deletedEmployee = value.match(/^Deleted employee (.+)$/);
  if (deletedEmployee) {
    return `已删除员工 ${deletedEmployee[1]}`;
  }

  const reviewUpdated = value.match(/^Review updated to (.+)$/);
  if (reviewUpdated) {
    return `审核已更新为 ${additionalDynamicZhText[reviewUpdated[1]] ?? dynamicZhText[reviewUpdated[1]] ?? reviewUpdated[1]}`;
  }

  const attendanceReviewUpdated = value.match(/^Attendance review updated to (.+)$/);
  if (attendanceReviewUpdated) {
    return `考勤审核已更新为 ${attendanceReviewUpdated[1]}`;
  }

  const attendanceReviewDenied = value.match(/^Attendance review access denied: (.+)$/);
  if (attendanceReviewDenied) {
    return `考勤审核访问被拒绝：${attendanceReviewDenied[1]}`;
  }

  const attendanceReviewRejected = value.match(/^Attendance review rejected: (.+)$/);
  if (attendanceReviewRejected) {
    return `考勤审核被拒绝：${attendanceReviewRejected[1]}`;
  }

  const attendanceReviewNotSaved = value.match(/^Attendance review was not saved: (.+)$/);
  if (attendanceReviewNotSaved) {
    return `考勤审核未保存：${attendanceReviewNotSaved[1]}`;
  }

  const refreshFallback = value.match(/^(.+); list refresh used fallback data$/);
  if (refreshFallback) {
    return `${refreshFallback[1]}；列表刷新使用了降级数据`;
  }

  return null;
}

function normalizeLanguage(value: string | null): Language {
  return value === 'en' || value === 'zh' ? value : defaultLanguage;
}

function interpolate(template: string, values?: TranslationValues) {
  if (!values) {
    return template;
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

function translateZhToken(value: string) {
  return exhaustiveZhText[value] ?? additionalDynamicZhText[value] ?? dynamicZhText[value] ?? value;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() =>
    normalizeLanguage(window.localStorage.getItem(STORAGE_KEY))
  );

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(STORAGE_KEY, nextLanguage);
  };

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      antdLocale: antdLocales[language],
      t: (key, fallback, values) => {
        const languageTable = translations[language] as Partial<Record<TranslationKey, string>>;
        const zhTable = translations.zh as Record<TranslationKey, string>;
        const template = languageTable[key] ?? (language === 'en' ? fallback : undefined) ?? zhTable[key] ?? fallback ?? key;
        return interpolate(template, values);
      },
      text: (rawValue) => {
        if (!rawValue) {
          return '';
        }

        if (language !== 'zh') {
          return rawValue;
        }

        return exhaustiveZhText[rawValue] ?? additionalDynamicZhText[rawValue] ?? dynamicZhText[rawValue] ?? translateDynamicPattern(rawValue) ?? rawValue;
      }
    }),
    [language]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider');
  }

  return context;
}
