from shared.kafka_helper import get_consumer
from shared.config import TOPIC_USER_EVENTS
from shared.retry import process_with_retry
from shared.event_parser import parse_event
from shared.logger import get_logger

logger = get_logger("notification-service")
consumer = get_consumer(TOPIC_USER_EVENTS)

logger.info("Notification service started, waiting for events...")

def handle(event):
    if event["type"] == "like":
        logger.info(f"Event processed | User {event['user_id']} liked post {event['post_id']}")
    elif event["type"] == "comment":
        logger.info(f"Event processed | User {event['user_id']} commented on post {event['post_id']}")

for message in consumer:
    event = message.value
    logger.info(f"Event received | event_id={event.get('event_id')} type={event.get('type')}")
    if parse_event(event):
        process_with_retry(event, handle)
