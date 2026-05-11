import { Avatar, Badge, Button, Grid, Layout, Menu, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { navRoutes } from '../router';

const { Header, Sider, Content } = Layout;

type AdminLayoutProps = {
  children: ReactNode;
};

export function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const collapsed = !screens.lg;
  const { session, apiStatus, canAccess, permissionsResolved, logout } = useAuth();
  const visibleRoutes = permissionsResolved
    ? navRoutes.filter((route) => !route.permissionKeys || canAccess(...route.permissionKeys))
    : navRoutes;

  const selectedKey =
    visibleRoutes.find((route) =>
      route.path === '/'
        ? location.pathname === '/'
        : location.pathname.startsWith(route.path)
    )?.key ?? 'dashboard';

  return (
    <Layout className="app-shell">
      <Sider width={256} collapsible collapsed={collapsed} trigger={null} breakpoint="lg">
        <div className="brand-block">
          <div className="brand-mark">EM</div>
          {!collapsed ? (
            <Space direction="vertical" size={0}>
              <Typography.Text className="brand-title">Admin Console</Typography.Text>
              <Typography.Text className="brand-subtitle">Employee Monitor</Typography.Text>
            </Space>
          ) : null}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={visibleRoutes.map((route) => ({
            key: route.key,
            icon: route.icon,
            label: route.label,
            onClick: () => navigate(route.path)
          }))}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <div>
            <Typography.Text className="header-kicker">Phase 6</Typography.Text>
            <Typography.Title level={4}>Remote workforce monitoring admin</Typography.Title>
          </div>
          <Space size={18}>
            <div className="header-meta">
              <Typography.Text>Mode</Typography.Text>
              <strong>{apiStatus?.source === 'mock' ? 'Auth fallback active' : 'Bearer session'}</strong>
            </div>
            <div className="header-meta">
              <Typography.Text>Queue</Typography.Text>
              <Badge status="processing" text="Admin review active" />
            </div>
            <div className="header-user-block">
              <Space size={[6, 6]} wrap>
                {session?.user.roleName ? <Tag color="geekblue">{session.user.roleName}</Tag> : null}
                {permissionsResolved ? <Tag color="cyan">RBAC filtered</Tag> : null}
                {session?.source === 'local-dev' ? <Tag color="gold">Local dev fallback</Tag> : null}
              </Space>
              <Typography.Text strong>{session?.user.displayName ?? session?.user.username ?? 'Admin'}</Typography.Text>
              <Typography.Text type="secondary">{session?.user.email ?? session?.user.username}</Typography.Text>
            </div>
            <Avatar style={{ backgroundColor: '#0f766e' }}>
              {(session?.user.displayName ?? session?.user.username ?? 'AD').slice(0, 2).toUpperCase()}
            </Avatar>
            <Button size="small" onClick={logout}>
              Sign out
            </Button>
          </Space>
        </Header>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
