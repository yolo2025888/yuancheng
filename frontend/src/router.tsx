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
import { lazy, Suspense, type ComponentType, type ReactElement } from 'react';
import { createBrowserRouter } from 'react-router-dom';

import App from './App';

function lazyNamed<T extends Record<string, ComponentType>>(loader: () => Promise<T>, exportName: keyof T) {
  return lazy(async () => ({ default: (await loader())[exportName] }));
}

const AccessRolesPage = lazyNamed(() => import('./pages/AccessRoles'), 'AccessRolesPage');
const AttendancePage = lazyNamed(() => import('./pages/Attendance'), 'AttendancePage');
const AuditLogsPage = lazyNamed(() => import('./pages/AuditLogs'), 'AuditLogsPage');
const DashboardPage = lazyNamed(() => import('./pages/Dashboard'), 'DashboardPage');
const DevicesPage = lazyNamed(() => import('./pages/Devices'), 'DevicesPage');
const EmployeesPage = lazyNamed(() => import('./pages/Employees'), 'EmployeesPage');
const EventsPage = lazyNamed(() => import('./pages/Events'), 'EventsPage');
const GitHubRiskPage = lazyNamed(() => import('./pages/GitHubRisk'), 'GitHubRiskPage');
const LoginPage = lazyNamed(() => import('./pages/Login'), 'LoginPage');
const PoliciesPage = lazyNamed(() => import('./pages/Policies'), 'PoliciesPage');
const RealtimeStatusPage = lazyNamed(() => import('./pages/RealtimeStatus'), 'RealtimeStatusPage');
const ScreenshotDetailPage = lazyNamed(() => import('./pages/ScreenshotDetail'), 'ScreenshotDetailPage');
const TimelinePage = lazyNamed(() => import('./pages/Timeline'), 'TimelinePage');

function routeElement(Page: ComponentType): ReactElement {
  return (
    <Suspense fallback={<div aria-busy="true" style={{ minHeight: 160 }} />}>
      <Page />
    </Suspense>
  );
}

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
    permissionKeys: ['screenshots.metadata.view', 'dashboard.view']
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
    permissionKeys: ['screenshots.metadata.view']
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
    permissionKeys: ['screenshots.metadata.view']
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
    element: routeElement(LoginPage)
  },
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: routeElement(DashboardPage) },
      { path: 'realtime-status', element: routeElement(RealtimeStatusPage) },
      { path: 'employees', element: routeElement(EmployeesPage) },
      { path: 'devices', element: routeElement(DevicesPage) },
      { path: 'timeline', element: routeElement(TimelinePage) },
      { path: 'events', element: routeElement(EventsPage) },
      { path: 'attendance', element: routeElement(AttendancePage) },
      { path: 'screenshot-detail', element: routeElement(ScreenshotDetailPage) },
      { path: 'access-roles', element: routeElement(AccessRolesPage) },
      { path: 'policies', element: routeElement(PoliciesPage) },
      { path: 'audit-logs', element: routeElement(AuditLogsPage) },
      { path: 'github-risk', element: routeElement(GitHubRiskPage) }
    ]
  }
]);
