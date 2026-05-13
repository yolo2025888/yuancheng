import { Alert, Button, Card, Form, Input, Select, Space, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';

type LoginFormValues = {
  identifier: string;
  password: string;
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, apiStatus, signIn, useLocalDevSession } = useAuth();
  const { language, setLanguage, t } = useI18n();
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
        ? t('login.failed', 'Login failed. Check the account identifier and password.')
        : t('login.unavailable', 'Login endpoint is unavailable.')
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
            <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
              <Typography.Text className="header-kicker">{t('app.phase', 'Phase 6')}</Typography.Text>
              <Select
                size="small"
                value={language}
                aria-label={t('language.label', 'Language')}
                style={{ width: 104 }}
                options={[
                  { value: 'zh', label: t('language.zh', 'Chinese') },
                  { value: 'en', label: t('language.en', 'English') }
                ]}
                onChange={setLanguage}
              />
            </Space>
            <Typography.Title level={2}>{t('login.title', 'Admin Login')}</Typography.Title>
            <Typography.Paragraph className="muted-label">
              {t(
                'login.description',
                'Sign in to the employee monitor admin console. This UI only exposes aggregate operations and administrative metadata.'
              )}
            </Typography.Paragraph>
          </div>
          {errorMessage ? <Alert type="error" showIcon message={errorMessage} /> : null}
          {apiStatus ? <ApiStatusNotice status={apiStatus} title={t('login.authApi', 'Auth API')} /> : null}
          {devFallbackAvailable ? (
            <Alert
              type="warning"
              showIcon
              message={t('login.devFallback.message', 'Local development fallback available')}
              description={t(
                'login.devFallback.description',
                'Auth endpoints are unavailable. You can open a frontend-only local development session, but it must not be treated as a production bypass.'
              )}
            />
          ) : null}
          <Form
            form={form}
            layout="vertical"
            size="large"
            onFinish={(values) => void handleSubmit(values)}
          >
            <Form.Item
              label={t('login.identifier', 'Username or email')}
              name="identifier"
              rules={[{ required: true, whitespace: true, message: t('login.identifier.required', 'Enter a username or email.') }]}
            >
              <Input prefix={<UserOutlined />} placeholder="alice.admin" autoComplete="username" />
            </Form.Item>
            <Form.Item
              label={t('login.password', 'Password')}
              name="password"
              rules={[{ required: true, whitespace: true, message: t('login.password.required', 'Enter the password.') }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder={t('login.password', 'Password')} autoComplete="current-password" />
            </Form.Item>
            <Space direction="vertical" size={10} className="full-width">
              <Button type="primary" htmlType="submit" loading={submitting} block>
                {t('login.submit', 'Sign in')}
              </Button>
              {devFallbackAvailable ? (
                <Button onClick={handleUseLocalDevSession} block>
                  {t('login.devSession', 'Use local dev session')}
                </Button>
              ) : null}
            </Space>
          </Form>
          <Typography.Text type="secondary">
            {t(
              'login.footer',
              'Production access still requires a working auth backend and a valid bearer token. Sessions are kept in browser session storage only.'
            )}
          </Typography.Text>
        </Space>
      </Card>
    </div>
  );
}
