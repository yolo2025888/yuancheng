import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function manualChunks(id: string) {
  const normalizedId = id.replace(/\\/g, '/');

  if (!normalizedId.includes('/node_modules/')) {
    return undefined;
  }

  if (
    normalizedId.includes('/node_modules/react/') ||
    normalizedId.includes('/node_modules/react-dom/') ||
    normalizedId.includes('/node_modules/react-router-dom/') ||
    normalizedId.includes('/node_modules/@remix-run/router/') ||
    normalizedId.includes('/node_modules/scheduler/')
  ) {
    return 'react';
  }

  if (normalizedId.includes('/node_modules/@ant-design/icons')) {
    return 'antd-icons';
  }

  if (normalizedId.includes('/node_modules/antd/')) {
    return 'antd-core';
  }

  if (
    normalizedId.includes('/node_modules/@ant-design/') ||
    normalizedId.includes('/node_modules/@rc-component/') ||
    normalizedId.includes('/node_modules/rc-') ||
    normalizedId.includes('/node_modules/async-validator/') ||
    normalizedId.includes('/node_modules/@babel/runtime/')
  ) {
    return 'antd-vendor';
  }

  if (normalizedId.includes('/node_modules/echarts/')) {
    return 'echarts';
  }

  if (normalizedId.includes('/node_modules/zrender/')) {
    return 'echarts';
  }

  return undefined;
}

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173
  }
});
