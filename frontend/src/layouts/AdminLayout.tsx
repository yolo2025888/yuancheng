import { Avatar, Badge, Grid, Layout, Menu, Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

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

  const selectedKey =
    navRoutes.find((route) =>
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
          items={navRoutes.map((route) => ({
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
            <Typography.Text className="header-kicker">Phase 3</Typography.Text>
            <Typography.Title level={4}>Remote workforce monitoring admin</Typography.Title>
          </div>
          <Space size={18}>
            <div className="header-meta">
              <Typography.Text>Mode</Typography.Text>
              <strong>Live API + fallback</strong>
            </div>
            <div className="header-meta">
              <Typography.Text>Queue</Typography.Text>
              <Badge status="processing" text="Admin review active" />
            </div>
            <Avatar style={{ backgroundColor: '#0f766e' }}>AD</Avatar>
          </Space>
        </Header>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
