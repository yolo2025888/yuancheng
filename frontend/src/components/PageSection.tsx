import { Space, Typography } from 'antd';
import type { ReactNode } from 'react';

type PageSectionProps = {
  title: string;
  description: string;
  extra?: ReactNode;
};

export function PageSection({ title, description, extra }: PageSectionProps) {
  return (
    <div className="page-section">
      <Space direction="vertical" size={4}>
        <Typography.Title level={3}>{title}</Typography.Title>
        <Typography.Text>{description}</Typography.Text>
      </Space>
      {extra ? <div>{extra}</div> : null}
    </div>
  );
}
