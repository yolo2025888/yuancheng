import {
  AlertOutlined,
  CalendarOutlined,
  KeyOutlined,
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
import { AccessRolesPage } from './pages/AccessRoles';
import { AttendancePage } from './pages/Attendance';
import { AuditLogsPage } from './pages/AuditLogs';
import { DashboardPage } from './pages/Dashboard';
import { DevicesPage } from './pages/Devices';
import { EmployeesPage } from './pages/Employees';
import { EventsPage } from './pages/Events';
import { GitHubRiskPage } from './pages/GitHubRisk';
import { LoginPage } from './pages/Login';
import { PoliciesPage } from './pages/Policies';
import { RealtimeStatusPage } from './pages/RealtimeStatus';
import { ScreenshotDetailPage } from './pages/ScreenshotDetail';
import { TimelinePage } from './pages/Timeline';

export type NavRoute = {
  key: string;
  label: string;
  path: string;
  icon: JSX.Element;
  permissionKeys?: string[];
};

export const navRoutes: NavRoute[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    path: '/',
    icon: <DashboardOutlined />,
    permissionKeys: ['dashboard.view']
  },
  {
    key: 'realtime',
    label: 'Realtime Status',
    path: '/realtime-status',
    icon: <LaptopOutlined />,
    permissionKeys: ['screenshots.view', 'dashboard.view']
  },
  {
    key: 'employees',
    label: 'Employees',
    path: '/employees',
    icon: <TeamOutlined />,
    permissionKeys: ['directory.view']
  },
  {
    key: 'devices',
    label: 'Devices',
    path: '/devices',
    icon: <DeploymentUnitOutlined />,
    permissionKeys: ['directory.view']
  },
  {
    key: 'timeline',
    label: 'Timeline',
    path: '/timeline',
    icon: <ClockCircleOutlined />,
    permissionKeys: ['screenshots.view']
  },
  {
    key: 'events',
    label: 'Events',
    path: '/events',
    icon: <AlertOutlined />,
    permissionKeys: ['events.review']
  },
  {
    key: 'attendance',
    label: 'Attendance',
    path: '/attendance',
    icon: <CalendarOutlined />,
    permissionKeys: ['attendance.view']
  },
  {
    key: 'screenshot-detail',
    label: 'Screenshot Detail',
    path: '/screenshot-detail',
    icon: <UnorderedListOutlined />,
    permissionKeys: ['screenshots.view']
  },
  {
    key: 'access-roles',
    label: 'Access Roles',
    path: '/access-roles',
    icon: <KeyOutlined />,
    permissionKeys: ['access_matrix.view']
  },
  {
    key: 'policies',
    label: 'Policies',
    path: '/policies',
    icon: <SafetyCertificateOutlined />,
    permissionKeys: ['policies.manage']
  },
  {
    key: 'audit-logs',
    label: 'Audit Logs',
    path: '/audit-logs',
    icon: <UnorderedListOutlined />,
    permissionKeys: ['audit_logs.view']
  },
  {
    key: 'github-risk',
    label: 'GitHub Risk',
    path: '/github-risk',
    icon: <GithubOutlined />,
    permissionKeys: ['risk_scores.view']
  }
];

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />
  },
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
      { path: 'attendance', element: <AttendancePage /> },
      { path: 'screenshot-detail', element: <ScreenshotDetailPage /> },
      { path: 'access-roles', element: <AccessRolesPage /> },
      { path: 'policies', element: <PoliciesPage /> },
      { path: 'audit-logs', element: <AuditLogsPage /> },
      { path: 'github-risk', element: <GitHubRiskPage /> }
    ]
  }
]);
