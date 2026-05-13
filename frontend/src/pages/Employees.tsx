import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
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
import { useI18n } from '../i18n/I18nContext';
import { adminApi } from '../services/adminApi';
import type { ApiStatus, EmployeeMutationInput, EmployeeRecord } from '../types/models';

const { Dragger } = Upload;

export function EmployeesPage() {
  const { t, text } = useI18n();
  const { canAccess, permissionsResolved } = useAuth();
  const [rows, setRows] = useState<EmployeeRecord[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [transferStatus, setTransferStatus] = useState<ApiStatus | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isEditorModalOpen, setIsEditorModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeRecord | null>(null);
  const [csvText, setCsvText] = useState('');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [deletingEmployeeKey, setDeletingEmployeeKey] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [form] = Form.useForm<EmployeeMutationInput>();
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
      messageApi.warning(t('employees.exportUnavailable', 'Employee CSV export is unavailable.'));
      setExporting(false);
      return;
    }

    downloadBlob(result.blob, result.filename ?? 'employees-export.csv');
    messageApi.success(t('employees.exportDownloaded', 'Employee CSV export downloaded.'));
    setExporting(false);
  }, [messageApi, t]);

  const handleImport = useCallback(async () => {
    const file = fileList[0]?.originFileObj;
    const pastedCsv = csvText.trim();

    if (!pastedCsv && !file) {
      messageApi.error(t('employees.importNeedSource', 'Paste CSV content or attach a CSV file first.'));
      return;
    }

    const importSource = pastedCsv || file;
    if (!importSource) {
      messageApi.error(t('employees.importNeedSource', 'Paste CSV content or attach a CSV file first.'));
      return;
    }

    setImporting(true);
    const result = await adminApi.importEmployees(importSource);
    setTransferStatus(result.apiStatus);

    if (!result.data) {
      messageApi.warning(t('employees.importUnavailable', 'Employee CSV import is unavailable.'));
      setImporting(false);
      return;
    }

    await loadEmployees();
    setIsImportModalOpen(false);
    setCsvText('');
    setFileList([]);
    messageApi.success(result.data.detail ?? t('employees.importCompleted', 'Employee CSV import completed.'));
    setImporting(false);
  }, [csvText, fileList, loadEmployees, messageApi, t]);

  const openCreateEditor = useCallback(() => {
    setEditingEmployee(null);
    form.setFieldsValue(createEmptyEmployeeValues());
    setIsEditorModalOpen(true);
  }, [form]);

  const openEditEditor = useCallback(
    (record: EmployeeRecord) => {
      setEditingEmployee(record);
      form.setFieldsValue(employeeToEditorValues(record));
      setIsEditorModalOpen(true);
    },
    [form]
  );

  const handleSaveEmployee = useCallback(async () => {
    const values = normalizeEmployeeValues(await form.validateFields());
    setSavingEmployee(true);

    const result = editingEmployee
      ? await adminApi.updateEmployee(editingEmployee.key, values)
      : await adminApi.createEmployee(values);
    setApiStatus(result.apiStatus);

    if (result.data) {
      setRows(result.data);
      setIsEditorModalOpen(false);
      setEditingEmployee(null);
      messageApi.success(
        editingEmployee
          ? t('employees.employeeSaved', 'Employee saved.')
          : t('employees.employeeCreated', 'Employee created.')
      );
    } else {
      messageApi.warning(text(result.apiStatus.detail) || t('employees.employeeSaveFailed', 'Employee could not be saved.'));
    }

    setSavingEmployee(false);
  }, [editingEmployee, form, messageApi, t, text]);

  const handleDeleteEmployee = useCallback(
    async (record: EmployeeRecord) => {
      setDeletingEmployeeKey(record.key);
      const result = await adminApi.deleteEmployee(record.key, record.name);
      setApiStatus(result.apiStatus);

      if (result.data) {
        setRows(result.data);
        messageApi.success(t('employees.employeeDeleted', 'Employee deleted.'));
      } else {
        messageApi.warning(text(result.apiStatus.detail) || t('employees.employeeDeleteFailed', 'Employee could not be deleted.'));
      }

      setDeletingEmployeeKey(null);
    },
    [messageApi, t, text]
  );

  return (
    <Space direction="vertical" size={20} className="page-stack">
      {contextHolder}
      <PageSection
        title={t('employees.title', 'Employees')}
        description={t(
          'employees.description',
          'Live employee records are used when available. Job role and position are shown explicitly so admin policy coverage can be managed by post.'
        )}
        extra={
          <Space size={[8, 8]} wrap>
            <Tag color="blue">{t('employees.count', '{{count}} employees', { count: rows.length })}</Tag>
            <Tag color="purple">{t('employees.positions', '{{count}} positions', { count: summary.positions })}</Tag>
            <Tag color={summary.riskyEmployees > 0 ? 'orange' : 'green'}>
              {t('employees.riskyToday', '{{count}} with risk today', { count: summary.riskyEmployees })}
            </Tag>
            <Button size="small" onClick={() => void loadEmployees()}>
              {t('common.reload', 'Reload')}
            </Button>
            <Button
              size="small"
              type="primary"
              disabled={!canManageDirectory}
              onClick={openCreateEditor}
            >
              {t('employees.newEmployee', 'New employee')}
            </Button>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={exporting}
              disabled={!canManageDirectory}
              onClick={() => void handleExport()}
            >
              {t('employees.exportCsv', 'Export CSV')}
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<UploadOutlined />}
              disabled={!canManageDirectory}
              onClick={() => setIsImportModalOpen(true)}
            >
              {t('employees.importCsv', 'Import CSV')}
            </Button>
          </Space>
        }
      />
      {apiStatus ? <ApiStatusNotice status={apiStatus} title={t('employees.api', 'Employee API')} /> : null}
      {transferStatus ? <ApiStatusNotice status={transferStatus} title={t('employees.transferApi', 'Employee import/export')} /> : null}
      {!canManageDirectory ? (
        <Alert
          type="warning"
          showIcon
          message={t('employees.restricted', 'Employee import and export are restricted for the current role.')}
          description={t(
            'employees.restrictedDesc',
            'Permission data from the auth profile does not include employee directory management access.'
          )}
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
              title: t('common.employee', 'Employee'),
              dataIndex: 'name',
              width: 220,
              render: (_value: string, record: EmployeeRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{record.name}</Typography.Text>
                  <Typography.Text type="secondary">{record.employeeNo ?? t('common.noEmployeeNo', 'No employee no.')}</Typography.Text>
                </Space>
              )
            },
            { title: t('common.department', 'Department'), dataIndex: 'department', width: 180, render: (value: string) => text(value) },
            {
              title: t('devices.rolePosition', 'Role / Position'),
              width: 240,
              render: (_value: unknown, record: EmployeeRecord) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text>{text(record.role)}</Typography.Text>
                  {record.position ? <Tag color="geekblue">{text(record.position)}</Tag> : null}
                </Space>
              )
            },
            {
              title: t('employees.managerPolicy', 'Manager / Policy'),
              width: 220,
              render: (_value: unknown, record: EmployeeRecord) => (
                <Space direction="vertical" size={4}>
                  <Typography.Text>{text(record.manager)}</Typography.Text>
                  {record.policyName ? <Typography.Text type="secondary">{text(record.policyName)}</Typography.Text> : null}
                </Space>
              )
            },
            {
              title: t('employees.devicesRisk', 'Devices / Risk'),
              width: 140,
              render: (_value: unknown, record: EmployeeRecord) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{t('employees.devicesValue', '{{count}} devices', { count: record.devices })}</Typography.Text>
                  <Typography.Text type={record.todayRisk > 0 ? 'warning' : 'secondary'}>
                    {t('access.riskEvents', '{{count}} risk events', { count: record.todayRisk })}
                  </Typography.Text>
                </Space>
              )
            },
            { title: 'GitHub', dataIndex: 'githubAccount', width: 180 },
            {
              title: t('common.status', 'Status'),
              dataIndex: 'status',
              width: 120,
              render: (value?: string) => <StatusTag value={value ?? 'active'} />
            },
            {
              title: t('common.actions', 'Actions'),
              width: 180,
              fixed: 'right',
              render: (_value: unknown, record: EmployeeRecord) => (
                <Space size={8} wrap>
                  <Button size="small" type="link" disabled={!canManageDirectory} onClick={() => openEditEditor(record)}>
                    {t('common.edit', 'Edit')}
                  </Button>
                  <Popconfirm
                    title={t('employees.deleteTitle', 'Delete employee?')}
                    description={t(
                      'employees.deleteDescription',
                      'This removes the employee from directory lists while preserving historical monitoring records.'
                    )}
                    okText={t('employees.delete', 'Delete')}
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void handleDeleteEmployee(record)}
                  >
                    <Button
                      size="small"
                      type="link"
                      danger
                      disabled={!canManageDirectory}
                      loading={deletingEmployeeKey === record.key}
                    >
                      {t('employees.delete', 'Delete')}
                    </Button>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
        />
      </Card>
      <Modal
        title={
          editingEmployee
            ? t('employees.editTitle', 'Edit employee')
            : t('employees.createTitle', 'Create employee')
        }
        open={isEditorModalOpen}
        okText={editingEmployee ? t('common.save', 'Save') : t('employees.create', 'Create')}
        okButtonProps={{ loading: savingEmployee, disabled: !canManageDirectory }}
        onOk={() => void handleSaveEmployee()}
        onCancel={() => {
          if (savingEmployee) {
            return;
          }

          setIsEditorModalOpen(false);
          setEditingEmployee(null);
        }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label={t('common.employee', 'Employee')}
            name="name"
            rules={[{ required: true, whitespace: true, message: t('employees.nameRequired', 'Employee name is required.') }]}
          >
            <Input maxLength={120} disabled={!canManageDirectory} />
          </Form.Item>
          <Form.Item
            label={t('employees.employeeNo', 'Employee no.')}
            name="employeeNo"
            rules={[{ required: true, whitespace: true, message: t('employees.employeeNoRequired', 'Employee number is required.') }]}
          >
            <Input maxLength={64} disabled={!canManageDirectory} />
          </Form.Item>
          <Form.Item label={t('common.department', 'Department')} name="department">
            <Input maxLength={120} disabled={!canManageDirectory} />
          </Form.Item>
          <Form.Item label={t('employees.jobRole', 'Job role')} name="role">
            <Input maxLength={120} disabled={!canManageDirectory} />
          </Form.Item>
          <Form.Item label={t('employees.manager', 'Manager')} name="manager">
            <Input maxLength={120} disabled={!canManageDirectory} />
          </Form.Item>
          <Form.Item label="GitHub" name="githubAccount">
            <Input maxLength={120} disabled={!canManageDirectory} />
          </Form.Item>
          <Form.Item label={t('common.status', 'Status')} name="status">
            <Select
              disabled={!canManageDirectory}
              options={[
                { value: 'active', label: t('employees.active', 'Active') },
                { value: 'inactive', label: t('employees.inactive', 'Inactive') }
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={t('employees.importTitle', 'Import employees from CSV')}
        open={isImportModalOpen}
        okText={t('employees.startImport', 'Start import')}
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
            message={t('employees.contractSettling', 'Backend contract is still settling')}
            description={t(
              'employees.contractDesc',
              'The frontend will try multipart form, JSON, and text/csv payloads against /api/admin/import/employees and show a clear unavailable status if none succeed.'
            )}
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
            <p className="ant-upload-text">{t('employees.dropCsv', 'Drop a CSV file here or click to attach one.')}</p>
            <p className="ant-upload-hint">
              {t('employees.uploadHint', 'No employee monitoring content is captured here beyond the CSV you provide.')}
            </p>
          </Dragger>
          <Input.TextArea
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            rows={8}
            placeholder={t('employees.pasteCsv', 'Paste employee CSV content here if you are not uploading a file.')}
          />
        </Space>
      </Modal>
    </Space>
  );
}

function createEmptyEmployeeValues(): EmployeeMutationInput {
  return {
    name: '',
    employeeNo: '',
    department: '',
    role: '',
    manager: '',
    githubAccount: '',
    status: 'active'
  };
}

function employeeToEditorValues(record: EmployeeRecord): EmployeeMutationInput {
  return {
    name: record.name,
    employeeNo: record.employeeNo ?? '',
    department: record.department === 'Unassigned' ? '' : record.department,
    role: record.role === 'General' ? '' : record.role,
    manager: record.manager === 'Unassigned' ? '' : record.manager,
    githubAccount: record.githubAccount === '--' ? '' : record.githubAccount,
    status: record.status ?? 'active'
  };
}

function normalizeEmployeeValues(values: EmployeeMutationInput): EmployeeMutationInput {
  return {
    name: values.name.trim(),
    employeeNo: values.employeeNo.trim(),
    department: values.department?.trim() || undefined,
    role: values.role?.trim() || undefined,
    manager: values.manager?.trim() || undefined,
    githubAccount: values.githubAccount?.trim() || undefined,
    status: values.status ?? 'active'
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}
