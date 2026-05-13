import {
  AlertOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  GithubOutlined,
  KeyOutlined,
  LaptopOutlined,
  PictureOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { lazy, Suspense, type ComponentType, type ReactElement } from 'react';
import { createBrowserRouter } from 'react-router-dom';

import App from './App';
import type { TranslationKey } from './i18n/translations';

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
const ScreenshotGalleryPage = lazyNamed(() => import('./pages/ScreenshotGallery'), 'ScreenshotGalleryPage');
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
  labelKey: TranslationKey;
  labelFallback: string;
  path: string;
  icon: JSX.Element;
  permissionKeys?: string[];
};

export const navRoutes: NavRoute[] = [
  {
    key: 'dashboard',
    labelKey: 'nav.dashboard',
    labelFallback: 'Dashboard',
    path: '/',
    icon: <DashboardOutlined />,
    permissionKeys: ['dashboard.view']
  },
  {
    key: 'realtime',
    labelKey: 'nav.realtime',
    labelFallback: 'Realtime Status',
    path: '/realtime-status',
    icon: <LaptopOutlined />,
    permissionKeys: ['screenshots.metadata.view', 'dashboard.view']
  },
  {
    key: 'employees',
    labelKey: 'nav.employees',
    labelFallback: 'Employees',
    path: '/employees',
    icon: <TeamOutlined />,
    permissionKeys: ['directory.view']
  },
  {
    key: 'devices',
    labelKey: 'nav.devices',
    labelFallback: 'Devices',
    path: '/devices',
    icon: <DeploymentUnitOutlined />,
    permissionKeys: ['directory.view']
  },
  {
    key: 'timeline',
    labelKey: 'nav.timeline.fixed',
    labelFallback: '时间线',
    path: '/timeline',
    icon: <ClockCircleOutlined />,
    permissionKeys: ['screenshots.metadata.view']
  },
  {
    key: 'screenshots',
    labelKey: 'nav.screenshotGallery.fixed',
    labelFallback: '截图库',
    path: '/screenshots',
    icon: <PictureOutlined />,
    permissionKeys: ['screenshots.metadata.view']
  },
  {
    key: 'events',
    labelKey: 'nav.events',
    labelFallback: 'Events',
    path: '/events',
    icon: <AlertOutlined />,
    permissionKeys: ['events.review']
  },
  {
    key: 'attendance',
    labelKey: 'nav.attendance',
    labelFallback: 'Attendance',
    path: '/attendance',
    icon: <CalendarOutlined />,
    permissionKeys: ['attendance.view']
  },
  {
    key: 'access-roles',
    labelKey: 'nav.accessRoles',
    labelFallback: 'Access Roles',
    path: '/access-roles',
    icon: <KeyOutlined />,
    permissionKeys: ['access_matrix.view']
  },
  {
    key: 'policies',
    labelKey: 'nav.policies',
    labelFallback: 'Policies',
    path: '/policies',
    icon: <SafetyCertificateOutlined />,
    permissionKeys: ['policies.manage']
  },
  {
    key: 'audit-logs',
    labelKey: 'nav.auditLogs',
    labelFallback: 'Audit Logs',
    path: '/audit-logs',
    icon: <UnorderedListOutlined />,
    permissionKeys: ['audit_logs.view']
  },
  {
    key: 'github-risk',
    labelKey: 'nav.githubRisk',
    labelFallback: 'GitHub Risk',
    path: '/github-risk',
    icon: <GithubOutlined />,
    permissionKeys: ['github_risks.view']
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
      { path: 'screenshots', element: routeElement(ScreenshotGalleryPage) },
      { path: 'screenshots/detail', element: routeElement(ScreenshotDetailPage) },
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
