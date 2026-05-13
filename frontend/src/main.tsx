import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { RouterProvider } from 'react-router-dom';

import { AuthProvider } from './auth/AuthContext';
import { I18nProvider, useI18n } from './i18n/I18nContext';
import { router } from './router';
import './styles/global.css';

const CHUNK_RELOAD_GUARD_KEY = 'employee-monitor-admin.chunk-reload-once';

window.addEventListener('vite:preloadError', (event) => {
  const hasReloaded = window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) === '1';
  if (hasReloaded) {
    return;
  }

  event.preventDefault();
  window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, '1');
  window.location.reload();
});

window.sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);

const theme = {
  token: {
    colorPrimary: '#0f766e',
    colorInfo: '#0f766e',
    colorBgBase: '#f3f6f8',
    colorTextBase: '#14213d',
    borderRadius: 14,
    fontFamily:
      '"IBM Plex Sans","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif'
  },
  components: {
    Layout: {
      bodyBg: '#eef3f6',
      siderBg: '#0f172a',
      headerBg: 'rgba(255,255,255,0.82)'
    },
    Menu: {
      darkItemBg: '#0f172a',
      darkItemSelectedBg: '#134e4a',
      darkItemHoverBg: '#172554',
      darkItemColor: 'rgba(226,232,240,0.82)',
      darkItemSelectedColor: '#f8fafc'
    },
    Card: {
      borderRadiusLG: 18
    }
  }
};

function RootProviders() {
  const { antdLocale } = useI18n();

  return (
    <ConfigProvider locale={antdLocale} theme={theme}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <RootProviders />
    </I18nProvider>
  </React.StrictMode>
);
