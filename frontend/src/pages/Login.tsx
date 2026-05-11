import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { useAuth } from '../auth/AuthContext';

type LoginFormValues = {
  identifier: string;
  password: string;
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, apiStatus, signIn, useLocalDevSession } = useAuth();
  const [form] = Form.useForm<LoginFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [devFallbackAvailable, setDevFallbackAvailable] = useState(false);
  const targetPath = useMemo(() => {
    const state = location.state as { from?: { pathname?: string } } | null;
    return state?.from?.pathname && state.from.pathname !== '/login' ? state.from.pathname : '/';
  }, [location.state]);

  if (status === 'authenticated') {
    return <Navigate to={targetPath} replace />;
  }

  const handleSubmit = async (values: LoginFormValues) => {
    setSubmitting(true);
    setErrorMessage(null);
    setDevFallbackAvailable(false);

    const result = await signIn(values.identifier, values.password, 'session');

    if (result.ok) {
      navigate(targetPath, { replace: true });
      return;
    }

    setErrorMessage(
      result.unauthorized
        ? 'Login failed. Check the account identifier and password.'
        : 'Login endpoint is unavailable.'
    );
    setDevFallbackAvailable(result.devFallbackAvailable);
    setSubmitting(false);
  };

  const handleUseLocalDevSession = () => {
    const values = form.getFieldsValue();
    useLocalDevSession(values.identifier || 'local.dev.admin', 'session');
    navigate(targetPath, { replace: true });
  };

  return (
    <div className="login-shell">
      <Card bordered={false} className="login-card">
        <Space direction="vertical" size={20} className="full-width">
          <div>
            <Typography.Text className="header-kicker">Phase 6</Typography.Text>
            <Typography.Title level={2}>Admin Login</Typography.Title>
            <Typography.Paragraph className="muted-label">
              Sign in to the employee monitor admin console. This UI only exposes aggregate operations and administrative metadata.
            </Typography.Paragraph>
          </div>
          {errorMessage ? <Alert type="error" showIcon message={errorMessage} /> : null}
          {apiStatus ? <ApiStatusNotice status={apiStatus} title="Auth API" /> : null}
          {devFallbackAvailable ? (
            <Alert
              type="warning"
              showIcon
              message="Local development fallback available"
              description="Auth endpoints are unavailable. You can open a frontend-only local development session, but it must not be treated as a production bypass."
            />
          ) : null}
          <Form
            form={form}
            layout="vertical"
            size="large"
            onFinish={(values) => void handleSubmit(values)}
          >
            <Form.Item
              label="Username or email"
              name="identifier"
              rules={[{ required: true, whitespace: true, message: 'Enter a username or email.' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="alice.admin" autoComplete="username" />
            </Form.Item>
            <Form.Item
              label="Password"
              name="password"
              rules={[{ required: true, whitespace: true, message: 'Enter the password.' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="Password" autoComplete="current-password" />
            </Form.Item>
            <Space direction="vertical" size={10} className="full-width">
              <Button type="primary" htmlType="submit" loading={submitting} block>
                Sign in
              </Button>
              {devFallbackAvailable ? (
                <Button onClick={handleUseLocalDevSession} block>
                  Use local dev session
                </Button>
              ) : null}
            </Space>
          </Form>
          <Typography.Text type="secondary">
            Production access still requires a working auth backend and a valid bearer token. Sessions are kept in browser session storage only.
          </Typography.Text>
        </Space>
      </Card>
    </div>
  );
}
