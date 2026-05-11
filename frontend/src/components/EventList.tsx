import { Button, Card, List, Space, Typography } from 'antd';

import type { EventRecord } from '../types/models';
import { StatusTag } from './StatusTag';

type EventListProps = {
  items: EventRecord[];
};

export function EventList({ items }: EventListProps) {
  return (
    <Card
      title="待复核事件"
      bordered={false}
      className="panel-card"
      extra={<Button type="link">查看全部</Button>}
    >
      <List
        dataSource={items}
        renderItem={(item) => (
          <List.Item>
            <div className="event-row">
              <div>
                <Space size={8} wrap>
                  <Typography.Text strong>{item.id}</Typography.Text>
                  <StatusTag value={item.severity} />
                  <StatusTag value={item.status} />
                </Space>
                <Typography.Paragraph className="event-summary">
                  {item.employee} / {item.type} / {item.summary}
                </Typography.Paragraph>
              </div>
              <div className="event-meta">
                <Typography.Text>{item.startedAt}</Typography.Text>
                <Typography.Text>{item.duration}</Typography.Text>
              </div>
            </div>
          </List.Item>
        )}
      />
    </Card>
  );
}
