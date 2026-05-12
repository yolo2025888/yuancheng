import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(__dirname, '..');

function readRelative(path) {
  const fullPath = join(frontendRoot, path);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing file: ${path}`);
  }

  return readFileSync(fullPath, 'utf8');
}

function includesAll(haystack, needles) {
  return needles.every((needle) => haystack.includes(needle));
}

const routerSource = readRelative('src/router.tsx');
const layoutSource = readRelative('src/layouts/AdminLayout.tsx');
const appSource = readRelative('src/App.tsx');
const adminApiSource = readRelative('src/services/adminApi.ts');

const requiredSurfaces = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    path: '/',
    permission: 'dashboard.view',
    component: 'DashboardPage',
    page: 'src/pages/Dashboard.tsx',
    pageSignals: ['reviewQueue', 'EventList'],
    apiSignals: ['/api/review-queue']
  },
  {
    key: 'realtime',
    label: 'Realtime Status',
    path: '/realtime-status',
    permissions: ['screenshots.metadata.view', 'dashboard.view'],
    component: 'RealtimeStatusPage',
    page: 'src/pages/RealtimeStatus.tsx',
    pageSignals: ['Realtime Status', 'getRealtimeStatus'],
    apiSignals: ['/health']
  },
  {
    key: 'employees',
    label: 'Employees',
    path: '/employees',
    permission: 'directory.view',
    component: 'EmployeesPage',
    page: 'src/pages/Employees.tsx',
    pageSignals: ['Employees', 'getEmployees'],
    apiSignals: ['/api/employees']
  },
  {
    key: 'devices',
    label: 'Devices',
    path: '/devices',
    permission: 'directory.view',
    component: 'DevicesPage',
    page: 'src/pages/Devices.tsx',
    pageSignals: ['Agent Token', 'handleIssueToken'],
    apiSignals: ['/api/devices']
  },
  {
    key: 'timeline',
    label: 'Timeline',
    path: '/timeline',
    permission: 'screenshots.metadata.view',
    component: 'TimelinePage',
    page: 'src/pages/Timeline.tsx',
    pageSignals: ['Timeline', 'getTimeline'],
    apiSignals: ['/api/employees/${discoveredEmployeeId}/timeline']
  },
  {
    key: 'events',
    label: 'Events',
    path: '/events',
    permission: 'events.review',
    component: 'EventsPage',
    page: 'src/pages/Events.tsx',
    pageSignals: ['REVIEW_ACTIONS', 'canReviewEvents'],
    apiSignals: ['/api/events']
  },
  {
    key: 'attendance',
    label: 'Attendance',
    path: '/attendance',
    permission: 'attendance.view',
    component: 'AttendancePage',
    page: 'src/pages/Attendance.tsx',
    pageSignals: ['reviewAttendance', 'attendance.manage'],
    apiSignals: ['/api/attendance', '/api/attendance/rules/default']
  },
  {
    key: 'screenshot-detail',
    label: 'Screenshot Detail',
    path: '/screenshot-detail',
    permission: 'screenshots.metadata.view',
    component: 'ScreenshotDetailPage',
    page: 'src/pages/ScreenshotDetail.tsx',
    pageSignals: ['Activity', 'Diff summary'],
    apiSignals: ['getScreenshotDetail']
  },
  {
    key: 'github-risk',
    label: 'GitHub Risk',
    path: '/github-risk',
    permission: 'github_risks.view',
    component: 'GitHubRiskPage',
    page: 'src/pages/GitHubRisk.tsx',
    pageSignals: ['GitHub Risk', 'getGitHubRisks'],
    apiSignals: ['/api/github-risks']
  },
  {
    key: 'access-roles',
    label: 'Access Roles',
    path: '/access-roles',
    permission: 'access_matrix.view',
    component: 'AccessRolesPage',
    page: 'src/pages/AccessRoles.tsx',
    pageSignals: ['permission', 'role'],
    apiSignals: ['/api/access']
  },
  {
    key: 'policies',
    label: 'Policies',
    path: '/policies',
    permission: 'policies.manage',
    component: 'PoliciesPage',
    page: 'src/pages/Policies.tsx',
    pageSignals: ['Policies', 'getPolicies'],
    apiSignals: ['/api/policies']
  },
  {
    key: 'audit-logs',
    label: 'Audit Logs',
    path: '/audit-logs',
    permission: 'audit_logs.view',
    component: 'AuditLogsPage',
    page: 'src/pages/AuditLogs.tsx',
    pageSignals: ['Audit Logs', 'getAuditLogs'],
    apiSignals: ['/api/audit-logs']
  }
];

const failures = [];

for (const surface of requiredSurfaces) {
  const pagePath = join(frontendRoot, surface.page);
  if (!existsSync(pagePath)) {
    failures.push(`${surface.key}: missing page file ${surface.page}`);
    continue;
  }

  const pageSource = readFileSync(pagePath, 'utf8');
  const routePath = surface.path === '/' ? "{ index: true" : `path: '${surface.path.slice(1)}'`;

  const permissions = surface.permissions ?? [surface.permission];
  const routeChecks = [
    [`key: '${surface.key}'`, 'nav key'],
    [`label: '${surface.label}'`, 'nav label'],
    [`path: '${surface.path}'`, 'nav path'],
    [surface.component, 'lazy component'],
    [routePath, 'router child path']
  ];

  for (const [needle, label] of routeChecks) {
    if (!routerSource.includes(needle)) {
      failures.push(`${surface.key}: missing ${label} signal "${needle}" in router.tsx`);
    }
  }

  for (const permission of permissions) {
    if (!routerSource.includes(permission)) {
      failures.push(`${surface.key}: missing permission signal "${permission}" in router.tsx`);
    }
  }

  if (!includesAll(pageSource, surface.pageSignals)) {
    failures.push(`${surface.key}: page ${surface.page} is missing one of: ${surface.pageSignals.join(', ')}`);
  }

  if (!includesAll(adminApiSource, surface.apiSignals)) {
    failures.push(`${surface.key}: adminApi.ts is missing one of: ${surface.apiSignals.join(', ')}`);
  }
}

if (!layoutSource.includes('navRoutes.filter') || !layoutSource.includes('canAccess(...route.permissionKeys)')) {
  failures.push('AdminLayout does not filter visible menu items through route permissions.');
}

if (!layoutSource.includes('visibleRoutes.map') || !layoutSource.includes('Menu')) {
  failures.push('AdminLayout does not render the visible route list as the console menu.');
}

if (!appSource.includes('Navigate to="/login"') || !appSource.includes('canAccess(...currentRoute.permissionKeys)')) {
  failures.push('App.tsx does not enforce login and route permissions before rendering protected pages.');
}

if (failures.length > 0) {
  console.error('Console route smoke failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'passed',
  checkedSurfaces: requiredSurfaces.map((surface) => ({
    key: surface.key,
    path: surface.path,
    permissions: surface.permissions ?? [surface.permission]
  }))
}, null, 2));
