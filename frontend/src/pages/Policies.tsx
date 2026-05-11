import { Card, Space, Table } from 'antd';
import { useEffect, useState } from 'react';

import { PageSection } from '../components/PageSection';
import { adminApi } from '../services/adminApi';
import type { PolicyRecord } from '../types/models';

export function PoliciesPage() {
  const [rows, setRows] = useState<PolicyRecord[]>([]);

  useEffect(() => {
    adminApi.getPolicies().then(setRows);
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="策略模板"
        description="按岗位展示截图间隔、连续无变化阈值和原图保留期，后续可扩展编辑器和版本历史。"
      />
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: '岗位模板', dataIndex: 'role' },
            { title: '截图间隔', dataIndex: 'screenshotInterval' },
            { title: '无变化阈值', dataIndex: 'noChangeThreshold' },
            { title: '高风险时长', dataIndex: 'highRiskDuration' },
            {
              title: 'OCR',
              dataIndex: 'ocrEnabled',
              render: (value: boolean) => (value ? '启用' : '关闭')
            },
            { title: '原图保留期', dataIndex: 'originalRetention' }
          ]}
        />
      </Card>
    </Space>
  );
}
