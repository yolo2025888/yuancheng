import { Layout, Menu, Space, Typography, Grid, Avatar, Badge } from 'antd';
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
      <Sider
        width={256}
        collapsible
        collapsed={collapsed}
        trigger={null}
        breakpoint="lg"
      >
        <div className="brand-block">
          <div className="brand-mark">EM</div>
          {!collapsed ? (
            <Space direction="vertical" size={0}>
              <Typography.Text className="brand-title">
                行为监控后台
              </Typography.Text>
              <Typography.Text className="brand-subtitle">
                Employee Monitor
              </Typography.Text>
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
            <Typography.Text className="header-kicker">MVP 骨架</Typography.Text>
            <Typography.Title level={4}>企业远程工作监控管理台</Typography.Title>
          </div>
          <Space size={18}>
            <div className="header-meta">
              <Typography.Text>环境</Typography.Text>
              <strong>Mock Data</strong>
            </div>
            <div className="header-meta">
              <Typography.Text>告警</Typography.Text>
              <Badge status="processing" text="11 条待处理" />
            </div>
            <Avatar style={{ backgroundColor: '#0f766e' }}>管</Avatar>
          </Space>
        </Header>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
