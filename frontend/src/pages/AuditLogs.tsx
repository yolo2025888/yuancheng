import { Card, Space, Table } from 'antd';
import { useEffect, useState } from 'react';

import { PageSection } from '../components/PageSection';
import { adminApi } from '../services/adminApi';
import type { AuditLogRecord } from '../types/models';

export function AuditLogsPage() {
  const [rows, setRows] = useState<AuditLogRecord[]>([]);

  useEffect(() => {
    adminApi.getAuditLogs().then(setRows);
  }, []);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="审计日志"
        description="保留查看原图、策略修改和导出事件等敏感动作，为后续权限闭环提供审计骨架。"
      />
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: '操作人', dataIndex: 'operator' },
            { title: '动作', dataIndex: 'action' },
            { title: '目标', dataIndex: 'target' },
            { title: '原因', dataIndex: 'reason' },
            { title: '时间', dataIndex: 'timestamp' },
            { title: '结果', dataIndex: 'result' }
          ]}
        />
      </Card>
    </Space>
  );
}
