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
    label: 'Dashboard',
    path: '/',
    icon: <DashboardOutlined />
  },
  {
    key: 'realtime',
    label: 'Realtime Status',
    path: '/realtime-status',
    icon: <LaptopOutlined />
  },
  {
    key: 'employees',
    label: 'Employees',
    path: '/employees',
    icon: <TeamOutlined />
  },
  {
    key: 'devices',
    label: 'Devices',
    path: '/devices',
    icon: <DeploymentUnitOutlined />
  },
  {
    key: 'timeline',
    label: 'Timeline',
    path: '/timeline',
    icon: <ClockCircleOutlined />
  },
  {
    key: 'events',
    label: 'Events',
    path: '/events',
    icon: <AlertOutlined />
  },
  {
    key: 'screenshot-detail',
    label: 'Screenshot Detail',
    path: '/screenshot-detail',
    icon: <UnorderedListOutlined />
  },
  {
    key: 'policies',
    label: 'Policies',
    path: '/policies',
    icon: <SafetyCertificateOutlined />
  },
  {
    key: 'audit-logs',
    label: 'Audit Logs',
    path: '/audit-logs',
    icon: <UnorderedListOutlined />
  },
  {
    key: 'github-risk',
    label: 'GitHub Risk',
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
