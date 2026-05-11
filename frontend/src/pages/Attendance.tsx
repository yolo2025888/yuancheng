import { Button, Card, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, AttendanceRecord } from '../types/models';

export function AttendancePage() {
  const [rows, setRows] = useState<AttendanceRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const loadAttendance = useCallback(async () => {
    setLoading(true);
    const result = await adminApi.getAttendance();
    setRows(result.data);
    setApiStatus(result.apiStatus);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  const summary = useMemo(() => {
    const abnormalCount = rows.filter((row) => row.anomalyStatus !== 'normal').length;
    const pendingCount = rows.filter((row) => row.reviewStatus === 'pending').length;
    const clockInCount = rows.filter((row) => row.eventType === 'clock_in').length;

    return { abnormalCount, pendingCount, clockInCount };
  }, [rows]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title="Attendance"
        description="Review employee clock-in and clock-out records, including late arrivals, early departures, and review status."
        extra={
          <Space size={[8, 8]} wrap>
            <Tag color="blue">{rows.length} records</Tag>
            <Tag color="cyan">{summary.clockInCount} clock-ins</Tag>
            <Tag color={summary.abnormalCount > 0 ? 'orange' : 'green'}>
              {summary.abnormalCount} exceptions
            </Tag>
            <Tag color={summary.pendingCount > 0 ? 'gold' : 'green'}>
              {summary.pendingCount} pending review
            </Tag>
            <Button size="small" onClick={() => void loadAttendance()} loading={loading}>
              Reload
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Attendance API" /> : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1180 }}
          columns={[
            {
              title: 'Employee',
              width: 220,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{record.employee}</Typography.Text>
                  <Typography.Text type="secondary">{record.employeeNo ?? record.userName}</Typography.Text>
                </Space>
              )
            },
            {
              title: 'Department / Device',
              width: 220,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.department ?? '--'}</Typography.Text>
                  <Typography.Text type="secondary">{record.machineName ?? 'Unknown device'}</Typography.Text>
                </Space>
              )
            },
            {
              title: 'Type',
              width: 130,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Tag color={record.eventType === 'clock_in' ? 'blue' : 'purple'}>{record.eventLabel}</Tag>
              )
            },
            {
              title: 'Time',
              width: 220,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.occurredAt}</Typography.Text>
                  <Typography.Text type="secondary">{record.workDate ?? '--'}</Typography.Text>
                </Space>
              )
            },
            {
              title: 'Exception',
              width: 260,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={4}>
                  <Tag color={attendanceStatusColor(record.anomalyStatus)}>{record.anomalyLabel}</Tag>
                  {record.anomalyReasons.length > 0 ? (
                    <Typography.Text type="secondary">{record.anomalyReasons.join('; ')}</Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">No exception detected</Typography.Text>
                  )}
                </Space>
              )
            },
            {
              title: 'Review',
              width: 180,
              render: (_value: unknown, record: AttendanceRecord) => (
                <Space direction="vertical" size={4}>
                  <Tag color={reviewStatusColor(record.reviewStatus)}>{record.reviewStatus}</Tag>
                  {record.reviewNote ? <Typography.Text type="secondary">{record.reviewNote}</Typography.Text> : null}
                </Space>
              )
            },
            {
              title: 'Source',
              dataIndex: 'source',
              width: 120
            }
          ]}
        />
      </Card>
    </Space>
  );
}

function attendanceStatusColor(status: string) {
  if (status === 'late' || status === 'early_leave') {
    return 'orange';
  }
  if (status === 'missing_clock_out' || status === 'missing_clock_in') {
    return 'red';
  }
  return 'green';
}

function reviewStatusColor(status: string) {
  if (status === 'pending') {
    return 'gold';
  }
  if (status === 'confirmed') {
    return 'red';
  }
  if (status === 'ignored' || status === 'reviewed') {
    return 'green';
  }
  return 'default';
}
