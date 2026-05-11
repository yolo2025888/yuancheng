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

export const adminApi = {
  async getDashboardData() {
    return Promise.resolve({
      kpis: dashboardKpis,
      workStatusSeries,
      employeeHeatmap,
      events
    });
  },
  async getRealtimeStatus() {
    return Promise.resolve(realtimeStatus);
  },
  async getEmployees() {
    return Promise.resolve(employees);
  },
  async getDevices() {
    return Promise.resolve(devices);
  },
  async getTimeline() {
    return Promise.resolve({
      kpis: timelineKpis,
      segments: timelineSegments
    });
  },
  async getEvents() {
    return Promise.resolve(events);
  },
  async getScreenshotDetail() {
    return Promise.resolve(screenshotComparison);
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
