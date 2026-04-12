import time
import random
from shared.kafka_helper import get_producer
from shared.config import TOPIC_DLQ
from shared.logger import get_logger

logger = get_logger("retry")

_producer = None

def get_dlq_producer():
    global _producer
    if _producer is None:
        _producer = get_producer()
    return _producer

def process_with_retry(event, handler, retries=3, delay=1):
    for attempt in range(1, retries + 1):
        try:
            if random.random() < 0.5:
                raise Exception("Simulated random failure")

            handler(event)
            logger.info(f"[attempt {attempt}] success | event_id={event.get('event_id')}")
            return

        except Exception as e:
            logger.error(f"[attempt {attempt}] failed: {e} | event_id={event.get('event_id')}")
            if attempt < retries:
                time.sleep(delay)

    logger.error(f"All retries exhausted, sending to DLQ | event_id={event.get('event_id')}")
    get_dlq_producer().send(TOPIC_DLQ, event)
