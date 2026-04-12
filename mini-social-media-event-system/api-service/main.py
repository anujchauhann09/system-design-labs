import uuid
from fastapi import FastAPI
from shared.models import LikeEvent, CommentEvent
from shared.kafka_helper import get_producer
from shared.config import TOPIC_USER_EVENTS
from shared.logger import get_logger

logger = get_logger("api-service")
app = FastAPI(title="Mini Social Media Event System")
producer = get_producer()

@app.post('/like')
def like(event: LikeEvent):
    payload = {"event_id": str(uuid.uuid4()), "type": "like", "user_id": event.user_id, "post_id": event.post_id}
    producer.send(TOPIC_USER_EVENTS, value=payload, key=str(event.post_id).encode())
    logger.info(f"Event published | type=like user_id={event.user_id} post_id={event.post_id} event_id={payload['event_id']}")
    return {"status": "ok"}

@app.post('/comment')
def comment(event: CommentEvent):
    payload = {"event_id": str(uuid.uuid4()), "type": "comment", "user_id": event.user_id, "post_id": event.post_id, "comment": event.comment}
    producer.send(TOPIC_USER_EVENTS, value=payload, key=str(event.post_id).encode())
    logger.info(f"Event published | type=comment user_id={event.user_id} post_id={event.post_id} event_id={payload['event_id']}")
    return {"status": "ok"}
