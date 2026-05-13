import { Button, Card, Col, Row, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
import { useI18n } from '../i18n/I18nContext';
import { adminApi } from '../services/adminApi';
import type { AccessMatrixRecord, ApiStatus, EmployeeRecord, PolicyRecord } from '../types/models';

type EmployeeAccessRow = {
  key: string;
  employee: string;
  employeeNo?: string;
  department: string;
  role: string;
  position?: string;
  profile?: string;
  modules: string[];
  actions: string[];
  policyName?: string;
  todayRisk: number;
  coverageState: 'mapped' | 'unmapped';
};

export function AccessRolesPage() {
  const { t, text } = useI18n();
  const [rows, setRows] = useState<AccessMatrixRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [accessApiStatus, setAccessApiStatus] = useState<ApiStatus | null>(null);
  const [employeeApiStatus, setEmployeeApiStatus] = useState<ApiStatus | null>(null);
  const [policyApiStatus, setPolicyApiStatus] = useState<ApiStatus | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [accessResult, employeeResult, policyResult] = await Promise.all([
      adminApi.getAccessMatrix(),
      adminApi.getEmployees(),
      adminApi.getPolicies()
    ]);

    setRows(accessResult.data);
    setEmployees(employeeResult.data);
    setPolicies(policyResult.data);
    setAccessApiStatus(accessResult.apiStatus);
    setEmployeeApiStatus(employeeResult.apiStatus);
    setPolicyApiStatus(policyResult.apiStatus);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const employeeAccessRows = useMemo<EmployeeAccessRow[]>(() => {
    return employees
      .map((employee) => {
        const matchedProfiles = rows.filter((record) => matchesAccessProfile(employee, record));
        const modules = dedupeStrings(matchedProfiles.flatMap((record) => record.modules));
        const actions = dedupeStrings(matchedProfiles.flatMap((record) => record.actions));

        return {
          key: employee.key,
          employee: employee.name,
          employeeNo: employee.employeeNo,
          department: employee.department,
          role: employee.role,
          position: employee.position,
          profile: matchedProfiles[0]?.role,
          modules,
          actions,
          policyName:
            employee.policyName ??
            policies.find((policy) => policy.roles.includes(employee.role) || policy.positions.includes(employee.position ?? ''))
              ?.name,
          todayRisk: employee.todayRisk,
          coverageState: matchedProfiles.length > 0 ? ('mapped' as const) : ('unmapped' as const)
        };
      })
      .sort((left, right) => {
        if (left.coverageState !== right.coverageState) {
          return left.coverageState === 'unmapped' ? -1 : 1;
        }

        if (right.todayRisk !== left.todayRisk) {
          return right.todayRisk - left.todayRisk;
        }

        return left.employee.localeCompare(right.employee);
      });
  }, [employees, policies, rows]);

  const summary = useMemo(() => {
    const modules = new Set(rows.flatMap((record) => record.modules));
    const actions = new Set(rows.flatMap((record) => record.actions));
    const coveredEmployees = employeeAccessRows.filter((row) => row.coverageState === 'mapped').length;
    const unmappedEmployees = employeeAccessRows.length - coveredEmployees;

    return {
      roles: rows.length,
      modules: modules.size,
      actions: actions.size,
      coveredEmployees,
      unmappedEmployees
    };
  }, [employeeAccessRows, rows]);

  return (
    <Space direction="vertical" size={20} className="page-stack">
      <PageSection
        title={t('access.title', 'Access Roles')}
        description={t(
          'access.description',
          'Review role permissions, module coverage, and employee-to-job-role alignment on one admin surface.'
        )}
        extra={
          <Space size={[8, 8]} wrap>
            <Tag color="blue">{t('access.roles', '{{count}} roles', { count: summary.roles })}</Tag>
            <Tag color="geekblue">{t('access.modules', '{{count}} modules', { count: summary.modules })}</Tag>
            <Tag color="purple">{t('access.actions', '{{count}} actions', { count: summary.actions })}</Tag>
            <Tag color="green">
              {t('access.employeesMapped', '{{count}} employees mapped', { count: summary.coveredEmployees })}
            </Tag>
            <Tag color={summary.unmappedEmployees > 0 ? 'orange' : 'green'}>
              {t('access.unmapped', '{{count}} unmapped', { count: summary.unmappedEmployees })}
            </Tag>
            <Button size="small" onClick={() => void loadData()} loading={loading}>
              {t('common.reload', 'Reload')}
            </Button>
          </Space>
        }
      />
      {accessApiStatus ? <ApiStatusNotice status={accessApiStatus} title={t('access.matrixApi', 'Access matrix API')} /> : null}
      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={16}>
          <Card bordered={false} className="panel-card" title={t('access.matrix', 'Role access matrix')}>
            <Table
              rowKey="key"
              size="small"
              loading={loading}
              pagination={false}
              dataSource={rows}
              scroll={{ x: 1220 }}
              columns={[
                {
                  title: t('common.role', 'Role'),
                  width: 180,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>{text(record.role)}</Typography.Text>
                      <Typography.Text type="secondary">
                        {t('employees.count', '{{count}} employees', { count: record.employeeCount })}
                      </Typography.Text>
                    </Space>
                  )
                },
                {
                  title: t('access.allowedModules', 'Allowed modules'),
                  width: 320,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space size={[4, 4]} wrap>
                      {record.modules.length > 0 ? (
                        record.modules.map((module) => (
                          <Tag key={module} color="geekblue">
                            {text(module)}
                          </Tag>
                        ))
                      ) : (
                        <Typography.Text type="secondary">{t('access.noModules', 'No modules declared')}</Typography.Text>
                      )}
                    </Space>
                  )
                },
                {
                  title: t('access.allowedActions', 'Allowed actions'),
                  width: 260,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space size={[4, 4]} wrap>
                      {record.actions.length > 0 ? (
                        record.actions.map((action) => (
                          <Tag key={action} color="cyan">
                            {text(action)}
                          </Tag>
                        ))
                      ) : (
                        <Typography.Text type="secondary">{t('access.noActions', 'No actions declared')}</Typography.Text>
                      )}
                    </Space>
                  )
                },
                {
                  title: t('dashboard.scope', 'Scope'),
                  width: 260,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space direction="vertical" size={4}>
                      <Typography.Text type="secondary">
                        {t('access.departments', 'Departments: {{value}}', {
                          value: record.departments.map(text).join(', ') || t('common.none', 'None')
                        })}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {t('access.positions', 'Positions: {{value}}', {
                          value: record.positions.map(text).join(', ') || t('common.none', 'None')
                        })}
                      </Typography.Text>
                    </Space>
                  )
                },
                {
                  title: t('access.employeesPolicies', 'Employees / Policies'),
                  width: 220,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space direction="vertical" size={4}>
                      <Typography.Text type="secondary">
                        {record.employees.slice(0, 3).join(', ') || t('access.noNamedEmployees', 'No named employees')}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {record.policyNames.map(text).join(', ') || t('dashboard.noPolicyBinding', 'No policy binding')}
                      </Typography.Text>
                    </Space>
                  )
                }
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card
            bordered={false}
            className="panel-card"
            title={t('access.alignmentSnapshot', 'Alignment snapshot')}
            extra={<Typography.Text type="secondary">{t('access.sourceMix', 'Source mix')}</Typography.Text>}
          >
            <Space direction="vertical" size={12} className="full-width">
              <Space size={[8, 8]} wrap>
                {employeeApiStatus ? (
                  <Tag color={employeeApiStatus.source === 'live' ? 'green' : 'gold'}>
                    {t('access.employeesTag', 'Employees {{label}}', { label: text(employeeApiStatus.label) })}
                  </Tag>
                ) : null}
                {policyApiStatus ? (
                  <Tag color={policyApiStatus.source === 'live' ? 'green' : 'gold'}>
                    {t('access.policiesTag', 'Policies {{label}}', { label: text(policyApiStatus.label) })}
                  </Tag>
                ) : null}
              </Space>
              {rows.slice(0, 6).map((record) => (
                <Space key={record.key} direction="vertical" size={2} className="full-width">
                  <Typography.Text strong>{text(record.role)}</Typography.Text>
                  <Typography.Text type="secondary">
                    {record.policyNames.map(text).join(', ') || t('dashboard.noPolicyBinding', 'No policy binding')}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {t('employees.count', '{{count}} employees', { count: record.employeeCount })} /{' '}
                    {t('access.modules', '{{count}} modules', { count: record.modules.length })} /{' '}
                    {t('access.actions', '{{count}} actions', { count: record.actions.length })}
                  </Typography.Text>
                </Space>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
      <Card bordered={false} className="panel-card" title={t('access.employeeRelevance', 'Employee relevance')}>
        <Table
          rowKey="key"
          size="small"
          loading={loading}
          dataSource={employeeAccessRows}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1180 }}
          columns={[
            {
              title: t('common.employee', 'Employee'),
              width: 220,
              render: (_value: unknown, record: EmployeeAccessRow) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{record.employee}</Typography.Text>
                  <Typography.Text type="secondary">{record.employeeNo ?? t('common.noEmployeeNo', 'No employee no.')}</Typography.Text>
                </Space>
              )
            },
            { title: t('common.department', 'Department'), dataIndex: 'department', width: 180, render: (value: string) => text(value) },
            {
              title: t('access.rolePosition', 'Role / Position'),
              width: 220,
              render: (_value: unknown, record: EmployeeAccessRow) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{text(record.role)}</Typography.Text>
                  <Typography.Text type="secondary">
                    {record.position ? text(record.position) : t('access.noPosition', 'No position metadata')}
                  </Typography.Text>
                </Space>
              )
            },
            {
              title: t('access.profile', 'Access profile'),
              width: 220,
              render: (_value: unknown, record: EmployeeAccessRow) => (
                <Space direction="vertical" size={4}>
                  <Tag color={record.coverageState === 'mapped' ? 'green' : 'orange'}>
                    {record.profile ? text(record.profile) : t('access.unmappedLabel', 'Unmapped')}
                  </Tag>
                  <Typography.Text type="secondary">
                    {t('access.actionModuleCount', '{{actions}} actions / {{modules}} modules', {
                      actions: record.actions.length,
                      modules: record.modules.length
                    })}
                  </Typography.Text>
                </Space>
              )
            },
            {
              title: t('common.modules', 'Modules'),
              width: 280,
              render: (_value: unknown, record: EmployeeAccessRow) => (
                <Space size={[4, 4]} wrap>
                  {record.modules.length > 0 ? (
                    record.modules.slice(0, 4).map((module) => (
                      <Tag key={`${record.key}-${module}`}>{text(module)}</Tag>
                    ))
                  ) : (
                    <Typography.Text type="secondary">{t('access.noModuleMapping', 'No module mapping')}</Typography.Text>
                  )}
                </Space>
              )
            },
            {
              title: t('access.policyRisk', 'Policy / Risk'),
              width: 180,
              render: (_value: unknown, record: EmployeeAccessRow) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.policyName ? text(record.policyName) : t('access.noPolicyAssigned', 'No policy assigned')}</Typography.Text>
                  <Typography.Text type={record.todayRisk > 0 ? 'warning' : 'secondary'}>
                    {t('access.riskEvents', '{{count}} risk events', { count: record.todayRisk })}
                  </Typography.Text>
                </Space>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}

function matchesAccessProfile(employee: EmployeeRecord, record: AccessMatrixRecord) {
  if (record.role === employee.role) {
    return true;
  }

  if (record.employees.includes(employee.name)) {
    return true;
  }

  if (employee.position && record.positions.includes(employee.position)) {
    return true;
  }

  return record.departments.includes(employee.department);
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
