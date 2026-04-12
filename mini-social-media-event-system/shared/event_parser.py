from pydantic import ValidationError
from shared.models import LikeEvent, CommentEvent
from shared.logger import get_logger

logger = get_logger("event_parser")

def parse_event(event: dict):
    event_type = event.get("type")

    try:
        if event_type == "like":
            return LikeEvent(**event)
        elif event_type == "comment":
            return CommentEvent(**event)
        else:
            logger.warning(f"Unknown event type: {event_type}")
            return None
    except ValidationError as e:
        logger.error(f"Invalid event skipped: {e.errors()}")
        return None
