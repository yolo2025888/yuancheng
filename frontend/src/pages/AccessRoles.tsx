import { Button, Card, Col, Row, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiStatusNotice } from '../components/ApiStatusNotice';
import { PageSection } from '../components/PageSection';
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
        title="Access Roles"
        description="Review role permissions, module coverage, and employee-to-job-role alignment on one admin surface."
        extra={
          <Space size={[8, 8]} wrap>
            <Tag color="blue">{summary.roles} roles</Tag>
            <Tag color="geekblue">{summary.modules} modules</Tag>
            <Tag color="purple">{summary.actions} actions</Tag>
            <Tag color="green">{summary.coveredEmployees} employees mapped</Tag>
            <Tag color={summary.unmappedEmployees > 0 ? 'orange' : 'green'}>
              {summary.unmappedEmployees} unmapped
            </Tag>
            <Button size="small" onClick={() => void loadData()} loading={loading}>
              Reload
            </Button>
          </Space>
        }
      />
      {accessApiStatus ? <ApiStatusNotice status={accessApiStatus} title="Access matrix API" /> : null}
      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={16}>
          <Card bordered={false} className="panel-card" title="Role access matrix">
            <Table
              rowKey="key"
              size="small"
              loading={loading}
              pagination={false}
              dataSource={rows}
              scroll={{ x: 1220 }}
              columns={[
                {
                  title: 'Role',
                  width: 180,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space direction="vertical" size={2}>
                      <Typography.Text strong>{record.role}</Typography.Text>
                      <Typography.Text type="secondary">{record.employeeCount} employees</Typography.Text>
                    </Space>
                  )
                },
                {
                  title: 'Allowed modules',
                  width: 320,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space size={[4, 4]} wrap>
                      {record.modules.length > 0 ? (
                        record.modules.map((module) => (
                          <Tag key={module} color="geekblue">
                            {module}
                          </Tag>
                        ))
                      ) : (
                        <Typography.Text type="secondary">No modules declared</Typography.Text>
                      )}
                    </Space>
                  )
                },
                {
                  title: 'Allowed actions',
                  width: 260,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space size={[4, 4]} wrap>
                      {record.actions.length > 0 ? (
                        record.actions.map((action) => (
                          <Tag key={action} color="cyan">
                            {action}
                          </Tag>
                        ))
                      ) : (
                        <Typography.Text type="secondary">No actions declared</Typography.Text>
                      )}
                    </Space>
                  )
                },
                {
                  title: 'Scope',
                  width: 260,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space direction="vertical" size={4}>
                      <Typography.Text type="secondary">
                        Departments: {record.departments.join(', ') || 'None'}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        Positions: {record.positions.join(', ') || 'None'}
                      </Typography.Text>
                    </Space>
                  )
                },
                {
                  title: 'Employees / Policies',
                  width: 220,
                  render: (_value: unknown, record: AccessMatrixRecord) => (
                    <Space direction="vertical" size={4}>
                      <Typography.Text type="secondary">
                        {record.employees.slice(0, 3).join(', ') || 'No named employees'}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {record.policyNames.join(', ') || 'No policy binding'}
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
            title="Alignment snapshot"
            extra={<Typography.Text type="secondary">Source mix</Typography.Text>}
          >
            <Space direction="vertical" size={12} className="full-width">
              <Space size={[8, 8]} wrap>
                {employeeApiStatus ? (
                  <Tag color={employeeApiStatus.source === 'live' ? 'green' : 'gold'}>
                    Employees {employeeApiStatus.label}
                  </Tag>
                ) : null}
                {policyApiStatus ? (
                  <Tag color={policyApiStatus.source === 'live' ? 'green' : 'gold'}>
                    Policies {policyApiStatus.label}
                  </Tag>
                ) : null}
              </Space>
              {rows.slice(0, 6).map((record) => (
                <Space key={record.key} direction="vertical" size={2} className="full-width">
                  <Typography.Text strong>{record.role}</Typography.Text>
                  <Typography.Text type="secondary">
                    {record.policyNames.join(', ') || 'No policy binding'}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {record.employeeCount} employees / {record.modules.length} modules / {record.actions.length} actions
                  </Typography.Text>
                </Space>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
      <Card bordered={false} className="panel-card" title="Employee relevance">
        <Table
          rowKey="key"
          size="small"
          loading={loading}
          dataSource={employeeAccessRows}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1180 }}
          columns={[
            {
              title: 'Employee',
              width: 220,
              render: (_value: unknown, record: EmployeeAccessRow) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{record.employee}</Typography.Text>
                  <Typography.Text type="secondary">{record.employeeNo ?? 'No employee no.'}</Typography.Text>
                </Space>
              )
            },
            { title: 'Department', dataIndex: 'department', width: 180 },
            {
              title: 'Role / Position',
              width: 220,
              render: (_value: unknown, record: EmployeeAccessRow) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.role}</Typography.Text>
                  <Typography.Text type="secondary">{record.position ?? 'No position metadata'}</Typography.Text>
                </Space>
              )
            },
            {
              title: 'Access profile',
              width: 220,
              render: (_value: unknown, record: EmployeeAccessRow) => (
                <Space direction="vertical" size={4}>
                  <Tag color={record.coverageState === 'mapped' ? 'green' : 'orange'}>
                    {record.profile ?? 'Unmapped'}
                  </Tag>
                  <Typography.Text type="secondary">
                    {record.actions.length} actions / {record.modules.length} modules
                  </Typography.Text>
                </Space>
              )
            },
            {
              title: 'Modules',
              width: 280,
              render: (_value: unknown, record: EmployeeAccessRow) => (
                <Space size={[4, 4]} wrap>
                  {record.modules.length > 0 ? (
                    record.modules.slice(0, 4).map((module) => (
                      <Tag key={`${record.key}-${module}`}>{module}</Tag>
                    ))
                  ) : (
                    <Typography.Text type="secondary">No module mapping</Typography.Text>
                  )}
                </Space>
              )
            },
            {
              title: 'Policy / Risk',
              width: 180,
              render: (_value: unknown, record: EmployeeAccessRow) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{record.policyName ?? 'No policy assigned'}</Typography.Text>
                  <Typography.Text type={record.todayRisk > 0 ? 'warning' : 'secondary'}>
                    {record.todayRisk} risk events
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
