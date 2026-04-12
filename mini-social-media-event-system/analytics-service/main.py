import redis
from shared.kafka_helper import get_consumer
from shared.config import TOPIC_USER_EVENTS, REDIS_HOST, REDIS_PORT
from shared.retry import process_with_retry
from shared.event_parser import parse_event
from shared.logger import get_logger

logger = get_logger("analytics-service")
consumer = get_consumer(TOPIC_USER_EVENTS)
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

logger.info("Analytics service started, waiting for events...")

def handle(event):
    post_id = event["post_id"]
    if event["type"] == "like":
        count = r.incr(f"like_count:{post_id}")
        logger.info(f"Event processed | post {post_id} now has {count} like(s)")
    elif event["type"] == "comment":
        count = r.incr(f"comment_count:{post_id}")
        logger.info(f"Event processed | post {post_id} now has {count} comment(s)")

for message in consumer:
    event = message.value
    logger.info(f"Event received | event_id={event.get('event_id')} type={event.get('type')}")
    if parse_event(event):
        process_with_retry(event, handle)
