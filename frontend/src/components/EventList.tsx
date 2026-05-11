import { Alert, Button, Card, List, Space, Typography } from 'antd';
import { Link } from 'react-router-dom';

import type { EventRecord } from '../types/models';
import { ChangeMetricsSummary } from './ChangeMetricsSummary';
import { StatusTag } from './StatusTag';

type EventListProps = {
  items: EventRecord[];
};

export function EventList({ items }: EventListProps) {
  const noChangeItems = items.filter((item) => item.noChangeStreakTriggered);

  return (
    <Card
      title="Pending Review Events"
      bordered={false}
      className="panel-card"
      extra={
        <Link to="/events">
          <Button type="link">View all</Button>
        </Link>
      }
    >
      {noChangeItems.length > 0 ? (
        <Alert
          showIcon
          type="warning"
          className="embedded-alert"
          message={`${noChangeItems.length} no-change streak risk event(s) need review`}
          description="Triggered from repeated low-diff screenshots. Review against aggregate keyboard and mouse counters plus work context."
        />
      ) : null}
      <List
        dataSource={items}
        renderItem={(item) => (
          <List.Item className={item.noChangeStreakTriggered ? 'event-item-priority' : undefined}>
            <div className="event-row">
              <div>
                <Space size={8} wrap>
                  <Typography.Text strong>{item.id}</Typography.Text>
                  <StatusTag value={item.severity} />
                  <StatusTag value={item.status} />
                  {item.noChangeStreakTriggered ? <StatusTag value="no_change_streak" /> : null}
                </Space>
                <Typography.Paragraph className="event-summary">
                  {item.employee} / {item.type} / {item.summary}
                </Typography.Paragraph>
                <ChangeMetricsSummary
                  metrics={item.changeMetrics}
                  noChangeStreakTriggered={item.noChangeStreakTriggered}
                />
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
