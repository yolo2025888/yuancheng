import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { RouterProvider } from 'react-router-dom';

import { AuthProvider } from './auth/AuthContext';
import { router } from './router';
import './styles/global.css';

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={theme}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ConfigProvider>
  </React.StrictMode>
);
