import sqlite3
from shared.kafka_helper import get_consumer
from shared.config import TOPIC_USER_EVENTS
from shared.retry import process_with_retry
from shared.event_parser import parse_event
from shared.logger import get_logger

logger = get_logger("feed-service")

conn = sqlite3.connect("feed.db")
cursor = conn.cursor()
cursor.execute("""
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT UNIQUE,
        type TEXT,
        user_id INTEGER,
        post_id INTEGER
    )
""")
conn.commit()

consumer = get_consumer(TOPIC_USER_EVENTS)

logger.info("Feed service started, waiting for events...")

def handle(event):
    cursor.execute(
        "INSERT OR IGNORE INTO events (event_id, type, user_id, post_id) VALUES (?, ?, ?, ?)",
        (event.get("event_id"), event.get("type"), event.get("user_id"), event.get("post_id"))
    )
    conn.commit()
    if cursor.rowcount == 1:
        logger.info(f"Event processed | saved event_id={event.get('event_id')}")
    else:
        logger.warning(f"Duplicate ignored | event_id={event.get('event_id')}")

for message in consumer:
    event = message.value
    logger.info(f"Event received | event_id={event.get('event_id')} type={event.get('type')}")
    if parse_event(event):
        process_with_retry(event, handle)
