import {
  AlertOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  GithubOutlined,
  LaptopOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { createBrowserRouter } from 'react-router-dom';

import App from './App';
import { AuditLogsPage } from './pages/AuditLogs';
import { DashboardPage } from './pages/Dashboard';
import { DevicesPage } from './pages/Devices';
import { EmployeesPage } from './pages/Employees';
import { EventsPage } from './pages/Events';
import { GitHubRiskPage } from './pages/GitHubRisk';
import { PoliciesPage } from './pages/Policies';
import { RealtimeStatusPage } from './pages/RealtimeStatus';
import { ScreenshotDetailPage } from './pages/ScreenshotDetail';
import { TimelinePage } from './pages/Timeline';

export type NavRoute = {
  key: string;
  label: string;
  path: string;
  icon: JSX.Element;
};

export const navRoutes: NavRoute[] = [
  {
    key: 'dashboard',
    label: '总览仪表盘',
    path: '/',
    icon: <DashboardOutlined />
  },
  {
    key: 'realtime',
    label: '实时状态',
    path: '/realtime-status',
    icon: <LaptopOutlined />
  },
  {
    key: 'employees',
    label: '员工管理',
    path: '/employees',
    icon: <TeamOutlined />
  },
  {
    key: 'devices',
    label: '设备管理',
    path: '/devices',
    icon: <DeploymentUnitOutlined />
  },
  {
    key: 'timeline',
    label: '员工时间线',
    path: '/timeline',
    icon: <ClockCircleOutlined />
  },
  {
    key: 'events',
    label: '事件中心',
    path: '/events',
    icon: <AlertOutlined />
  },
  {
    key: 'screenshot-detail',
    label: '截图详情',
    path: '/screenshot-detail',
    icon: <UnorderedListOutlined />
  },
  {
    key: 'policies',
    label: '策略模板',
    path: '/policies',
    icon: <SafetyCertificateOutlined />
  },
  {
    key: 'audit-logs',
    label: '审计日志',
    path: '/audit-logs',
    icon: <UnorderedListOutlined />
  },
  {
    key: 'github-risk',
    label: 'GitHub 风险',
    path: '/github-risk',
    icon: <GithubOutlined />
  }
];

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'realtime-status', element: <RealtimeStatusPage /> },
      { path: 'employees', element: <EmployeesPage /> },
      { path: 'devices', element: <DevicesPage /> },
      { path: 'timeline', element: <TimelinePage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'screenshot-detail', element: <ScreenshotDetailPage /> },
      { path: 'policies', element: <PoliciesPage /> },
      { path: 'audit-logs', element: <AuditLogsPage /> },
      { path: 'github-risk', element: <GitHubRiskPage /> }
    ]
  }
]);
