import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { DownloadOutlined, InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { StatusTag } from '../components/StatusTag';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, EmployeeRecord } from '../types/models';

const { Dragger } = Upload;

export function EmployeesPage() {
  const { canAccess, permissionsResolved } = useAuth();
  const [rows, setRows] = useState<EmployeeRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [transferStatus, setTransferStatus] = useState<ApiStatus | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const canManageDirectory = !permissionsResolved || canAccess('directory.manage');

  const loadEmployees = useCallback(async () => {
    const result = await adminApi.getEmployees();
    setRows(result.data);
    setApiStatus(result.apiStatus);
  }, []);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  const summary = useMemo(() => {
    const positions = new Set(rows.map((row) => row.position).filter(Boolean));
    const riskyEmployees = rows.filter((row) => row.todayRisk > 0).length;

    return {
      positions: positions.size,
      riskyEmployees
    };
  }, [rows]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    const result = await adminApi.exportEmployees();
    setTransferStatus(result.apiStatus);

    if (!result.blob) {
      messageApi.warning('Employee CSV export is unavailable.');
      setExporting(false);
      return;
    }

    downloadBlob(result.blob, result.filename ?? 'employees-export.csv');
    messageApi.success('Employee CSV export downloaded.');
    setExporting(false);
  }, [messageApi]);

  const handleImport = useCallback(async () => {
    const file = fileList[0]?.originFileObj;
    const pastedCsv = csvText.trim();

    if (!pastedCsv && !file) {
      messageApi.error('Paste CSV content or attach a CSV file first.');
      return;
    }

    const importSource = pastedCsv || file;
    if (!importSource) {
      messageApi.error('Paste CSV content or attach a CSV file first.');
      return;
    }

    setImporting(true);
    const result = await adminApi.importEmployees(importSource);
    setTransferStatus(result.apiStatus);

    if (!result.data) {
      messageApi.warning('Employee CSV import is unavailable.');
      setImporting(false);
      return;
    }

    await loadEmployees();
    setIsImportModalOpen(false);
    setCsvText('');
    setFileList([]);
    messageApi.success(result.data.detail ?? 'Employee CSV import completed.');
    setImporting(false);
  }, [csvText, fileList, loadEmployees, messageApi]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      {contextHolder}
      <PageSection
        title="Employees"
        description="Live employee records are used when available. Job role and position are shown explicitly so admin policy coverage can be managed by post."
        extra={
          <Space size={[8, 8]} wrap>
            <Tag color="blue">{rows.length} employees</Tag>
            <Tag color="purple">{summary.positions} positions</Tag>
            <Tag color={summary.riskyEmployees > 0 ? 'orange' : 'green'}>
              {summary.riskyEmployees} with risk today
            </Tag>
            <Button size="small" onClick={() => void loadEmployees()}>
              Reload
            </Button>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={exporting}
              disabled={!canManageDirectory}
              onClick={() => void handleExport()}
            >
              Export CSV
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<UploadOutlined />}
              disabled={!canManageDirectory}
              onClick={() => setIsImportModalOpen(true)}
            >
              Import CSV
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title="Employee API" /> : null}
      {transferStatus ? <ApiStatusNotice status={transferStatus} title="Employee import/export" /> : null}
      {!canManageDirectory ? (
        <Alert
          type="warning"
          showIcon
          message="Employee import and export are restricted for the current role."
          description="Permission data from the auth profile does not include employee directory management access."
        />
      ) : null}
      <Card bordered={false} className="panel-card">
        <Table
          rowKey="key"
          size="middle"
          dataSource={rows}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1180 }}
          columns={[
            {
              title: 'Employee',
              dataIndex: 'name',
              width: 220,
              render: (_value: string, record: EmployeeRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{record.name}</Typography.Text>
                  <Typography.Text type="secondary">{record.employeeNo ?? 'No employee no.'}</Typography.Text>
                </Space>
              )
            },
            { title: 'Department', dataIndex: 'department', width: 180 },
            {
              title: 'Role / Position',
              width: 240,
              render: (_value: unknown, record: EmployeeRecord) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text>{record.role}</Typography.Text>
                  {record.position ? <Tag color="geekblue">{record.position}</Tag> : null}
                </Space>
              )
            },
            {
              title: 'Manager / Policy',
              width: 220,
              render: (_value: unknown, record: EmployeeRecord) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text>{record.manager}</Typography.Text>
                  {record.policyName ? <Typography.Text type="secondary">{record.policyName}</Typography.Text> : null}
                </Space>
              )
            },
            {
              title: 'Devices / Risk',
              width: 140,
              render: (_value: unknown, record: EmployeeRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.devices} devices</Typography.Text>
                  <Typography.Text type={record.todayRisk > 0 ? 'warning' : 'secondary'}>
                    {record.todayRisk} risk events
                  </Typography.Text>
                </Space>
              )
            },
            { title: 'GitHub', dataIndex: 'githubAccount', width: 180 },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 120,
              render: (value?: string) => <StatusTag value={value ?? 'active'} />
            }
          ]}
        />
      </Card>
      <Modal
        title="Import employees from CSV"
        open={isImportModalOpen}
        okText="Start import"
        okButtonProps={{ loading: importing, disabled: !canManageDirectory }}
        onOk={() => void handleImport()}
        onCancel={() => {
          if (importing) {
            return;
          }

          setIsImportModalOpen(false);
        }}
      >
        <Space direction="vertical" size={16} className="full-width">
          <Alert
            type="info"
            showIcon
            message="Backend contract is still settling"
            description="The frontend will try multipart form, JSON, and text/csv payloads against /api/admin/import/employees and show a clear unavailable status if none succeed."
          />
          <Dragger
            multiple={false}
            accept=".csv,text/csv"
            beforeUpload={() => false}
            fileList={fileList}
            onChange={({ fileList: nextFileList }) => setFileList(nextFileList.slice(-1))}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Drop a CSV file here or click to attach one.</p>
            <p className="ant-upload-hint">No employee monitoring content is captured here beyond the CSV you provide.</p>
          </Dragger>
          <Input.TextArea
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            rows={8}
            placeholder="Paste employee CSV content here if you are not uploading a file."
          />
        </Space>
      </Modal>
    </Space>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}
