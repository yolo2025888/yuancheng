import { Card, Result, Spin } from 'antd';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import { AdminLayout } from './layouts/AdminLayout';
import { navRoutes } from './router';

export default function App() {
  const location = useLocation();
  const { status, canAccess, permissionsResolved } = useAuth();

  if (status === 'booting') {
    return (
      <div className="login-shell">
        <Card bordered={false} className="login-card centered-card">
          <Spin size="large" />
        </Card>
      </div>
    );
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: { pathname: location.pathname } }} />;
  }

  const currentRoute = navRoutes.find((route) =>
    route.path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(route.path)
  );
  const isRouteAllowed =
    !currentRoute?.permissionKeys || !permissionsResolved || canAccess(...currentRoute.permissionKeys);

  return (
    <AdminLayout>
      {isRouteAllowed ? (
        <Outlet />
      ) : (
        <Card bordered={false} className="panel-card">
          <Result
            status="403"
            title="Permission required"
            subTitle="The current role does not have permission to open this admin surface."
          />
        </Card>
      )}
    </AdminLayout>
  );
}
