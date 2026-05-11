import { Alert, Button, Card, Empty, List, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';

import type { ApiStatus, EventRecord, ReviewQueueRecord } from '../types/models';
import { ChangeMetricsSummary } from './ChangeMetricsSummary';
import { StatusTag } from './StatusTag';

type EventListProps = {
  items: EventRecord[];
  reviewQueue: ReviewQueueRecord[];
  reviewQueueApiStatus?: ApiStatus | null;
};

export function EventList({ items, reviewQueue, reviewQueueApiStatus }: EventListProps) {
  const noChangeItems = items.filter((item) => item.noChangeStreakTriggered);
  const urgentItems = reviewQueue.filter((item) => item.severity === 'critical' || item.severity === 'high');
  const latestEvents = items.slice(0, 3);

  return (
    <Card
      title="Review queue / alerts"
      bordered={false}
      className="panel-card"
      extra={
        <Space size={8}>
          {reviewQueueApiStatus ? (
            <Tag color={reviewQueueApiStatus.source === 'live' ? 'green' : 'gold'}>
              {reviewQueueApiStatus.source === 'live' ? 'Live queue' : 'Fallback queue'}
            </Tag>
          ) : null}
          <Link to="/events">
            <Button type="link">Open Events</Button>
          </Link>
        </Space>
      }
    >
      {reviewQueue.length > 0 ? (
        <Alert
          showIcon
          type={urgentItems.length > 0 ? 'warning' : 'info'}
          className="embedded-alert"
          message={`${reviewQueue.length} item(s) in review queue`}
          description={
            urgentItems.length > 0
              ? `${urgentItems.length} high-severity alert(s) should be reviewed first.`
              : 'Queue is populated from live review endpoints when available, otherwise from current event and risk feeds.'
          }
        />
      ) : null}
      {reviewQueue.length > 0 ? (
        <List
          size="small"
          dataSource={reviewQueue.slice(0, 6)}
          renderItem={(item) => (
            <List.Item
              className={item.severity === 'critical' || item.severity === 'high' ? 'event-item-priority' : undefined}
            >
              <div className="event-row">
                <div>
                  <Space size={[6, 6]} wrap>
                    <StatusTag value={item.severity} />
                    <Typography.Text strong>{item.type}</Typography.Text>
                    {item.isActionable === false ? <Tag>Read only</Tag> : null}
                    <Typography.Text type="secondary">{item.employee}</Typography.Text>
                    {item.department ? <Typography.Text type="secondary">{item.department}</Typography.Text> : null}
                  </Space>
                  <Typography.Paragraph className="event-summary">
                    {item.reason}
                    {item.deviceHostname ? ` / ${item.deviceHostname}` : ''}
                  </Typography.Paragraph>
                </div>
                <div className="event-meta">
                  <StatusTag value={item.status} />
                  <Typography.Text>{item.ageLabel}</Typography.Text>
                </div>
              </div>
            </List.Item>
          )}
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No review queue items are pending."
        />
      )}
      {latestEvents.length > 0 ? (
        <Space direction="vertical" size={10} style={{ width: '100%', marginTop: 16 }}>
          <Space size={8} wrap>
            <Typography.Text strong>Recent event context</Typography.Text>
            {noChangeItems.length > 0 ? <Tag color="gold">{noChangeItems.length} no-change streak</Tag> : null}
          </Space>
          <List
            size="small"
            dataSource={latestEvents}
            renderItem={(item) => (
              <List.Item>
                <div style={{ width: '100%' }}>
                  <Space size={[6, 6]} wrap>
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
              </List.Item>
            )}
          />
        </Space>
      ) : null}
    </Card>
  );
}
