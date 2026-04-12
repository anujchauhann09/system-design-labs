# Mini Social Media Event System — Notes

This is a personal log of how we built this system step by step. Not a tutorial. Just honest notes on what we built, why, what broke, and what we learned along the way.

---

## Where we started

The goal was simple — build an API that accepts a like or comment, and instead of saving it directly to a database, publish it as an event. Other services would react to that event independently.

The first version was just a FastAPI app with two endpoints:

```python
@app.post('/like')
def like():
    print('Liked')  

@app.post('/comment')
def comment():  
    print('Commented')
```

---

## Phase 1 — API that actually works

Added Pydantic models to accept real data:

```python
class LikeEvent(BaseModel):
    user_id: int
    post_id: int
```

FastAPI uses this to automatically validate incoming JSON. Send the wrong type or miss a field — you get a 422 back without writing a single line of validation code. That's Pydantic doing its job.

For now, just `print()` the event. No Kafka yet. Keep it simple, verify it works first.

Tested with curl, worked. Checkpoint done.

---

## Phase 2 — Adding Kafka

This is where it got interesting. Kafka is a message broker — your API drops off a message, other services pick it up later. They don't need to know about each other.

But Kafka doesn't run alone. It needs Zookeeper to manage cluster state — who's alive, who's the leader, where topics live. Think of Kafka as the post office and Zookeeper as the manager keeping things organized behind the scenes.

Added both to docker-compose. Key thing learned here: `KAFKA_ADVERTISED_LISTENERS` must use the Docker service name (`kafka`), not `localhost`. If you put `localhost`, your API container tries to connect to itself instead of the Kafka container. 

Updated the API to use `KafkaProducer`:

```python
producer = KafkaProducer(
    bootstrap_servers=os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
    value_serializer=lambda v: json.dumps(v).encode("utf-8")
)
```

The `value_serializer` is a two-step translation — dict → JSON string → bytes. Kafka only speaks bytes.

---

## The depends_on problem

Added `depends_on: kafka` to the API service. Ran it. API crashed.

Why? `depends_on` only waits for the container to start, not for Kafka to be ready inside it. Kafka takes 10-15 seconds to fully boot. The API connected too early, found nothing, crashed.

The fix is healthchecks:

```yaml
healthcheck:
  test: ["CMD", "kafka-broker-api-versions", "--bootstrap-server", "localhost:9092"]
  interval: 10s
  timeout: 10s
  retries: 10
```

Combined with `condition: service_healthy` in depends_on. Now Docker waits until Kafka actually responds before starting the API. Same for Zookeeper — used `nc -z localhost 2181` as a simple port check.

Lesson: `depends_on` is not enough. Always add healthchecks for services that take time to boot.

---

## Phase 3 — Notification Service

First consumer. Its job: read from Kafka, print a human-readable message.

No FastAPI needed here. No HTTP server. Just a plain Python script with an infinite loop:

```python
for message in consumer:
    event = message.value
    if event["type"] == "like":
        print(f"User {event['user_id']} liked post {event['post_id']}")
```

`KafkaConsumer` is the mirror of `KafkaProducer`. The loop blocks forever, waking up whenever a new message arrives.

---

## Phase 4 — Analytics and Feed Services

Added two more consumers. Each reads the same `user-events` topic independently. Kafka tracks each consumer's offset separately — so all three get every message without interfering.

**Analytics service** — counts likes and comments per post in memory:

```python
likes = {}
comments = {}

likes[post_id] = likes.get(post_id, 0) + 1
```

Simple dict. Fast. But lost on restart — that's the tradeoff of in-memory storage.

**Feed service** — stores every event in SQLite.

---

## Idempotency

Kafka guarantees at-least-once delivery. That means the same message can arrive twice — if a consumer crashes after processing but before committing its offset, Kafka replays it on restart.

Without protection, feed-service would insert duplicate rows.

Fix: add `event_id` (a UUID) to every event at the API level, add a `UNIQUE` constraint on `event_id` in SQLite, use `INSERT OR IGNORE`.

```python
payload = {"event_id": str(uuid.uuid4()), ...}
```

```sql
INSERT OR IGNORE INTO events (event_id, ...) VALUES (?, ...)
```

If the same event arrives twice, the second insert is silently skipped. `cursor.rowcount` tells you whether it was a fresh insert (1) or a duplicate (0).

---

## Shared module

At this point every service had its own copy of the Kafka setup, the topic name string, and the Pydantic models. Change one thing and you have to update it in four places.

Created `shared/` as a Python package:

- `config.py` — all env vars and constants in one place
- `models.py` — `LikeEvent` and `CommentEvent` defined once
- `kafka_helper.py` — `get_producer()` and `get_consumer()` so no service repeats the serializer setup

The tricky Docker part: each service's Dockerfile needs to copy the shared folder in, since it lives outside the service's own folder:

```dockerfile
COPY shared/ shared/
COPY analytics-service/main.py .
```

---

## Redis

In-memory dict in analytics-service resets on every restart. Redis is a separate container that persists across restarts and can be read by any service.

Redis has a built-in `INCR` command — atomically increments a counter at a key. If the key doesn't exist, it starts at 0 and becomes 1. No need to check first.

```python
count = r.incr(f"like_count:{post_id}")
count = r.incr(f"comment_count:{post_id}")
```

Key naming convention `like_count:99` — the colon is just Redis convention for namespacing, like a folder path.

Added Redis to docker-compose with a healthcheck (`redis-cli ping` returns `PONG` when ready). Analytics-service now depends on both Kafka and Redis being healthy before starting.

---

## Retry logic and DLQ

Real systems fail. Networks blip. DBs timeout. You can't just crash and lose the event.

Added `process_with_retry` in `shared/retry.py`. It tries the handler up to 3 times with a delay between attempts. To simulate real failures, it randomly raises an exception 50% of the time.

```
attempt 1 → fail
attempt 2 → fail  
attempt 3 → success (or final fail)
```

If all retries fail, the event goes to a Dead Letter Queue — `user-events-dlq`. This is just another Kafka topic. Nothing special about it except the name. Failed events land there so someone can inspect them later, fix the bug, and replay.

The DLQ producer is a singleton — created once and reused. No point creating a new connection on every failure.

---

## Partitions

By default Kafka creates topics with 1 partition — one lane. All messages queue up and get processed one by one.

With multiple partitions, multiple consumers can read in parallel. Kafka distributes partitions across consumers in the same consumer group.

But partitions break ordering across the topic. Events for post 99 might land in different partitions and get processed out of order.

Fix: partition key. Same key always hashes to the same partition.

```python
producer.send(TOPIC_USER_EVENTS, value=payload, key=str(event.post_id).encode())
```

Using `post_id` as the key means all events for post 99 always go to the same partition — ordering preserved per post.

Turned off `KAFKA_AUTO_CREATE_TOPICS_ENABLE` and added a `kafka-init` service that explicitly creates topics with 3 partitions:

```yaml
kafka-init:
  entrypoint: ["/bin/sh", "-c"]
  command: >
    "kafka-topics --create --if-not-exists
    --bootstrap-server kafka:9092
    --topic user-events
    --partitions 3
    --replication-factor 1"
```

This runs once and exits. All other services wait for it with `condition: service_completed_successfully`.

---

## Validation

Pydantic already handles missing fields and wrong types — FastAPI returns 422 automatically. But it doesn't know your business rules.

Added `@field_validator` to models:

```python
@field_validator("user_id", "post_id")
@classmethod
def must_be_positive(cls, v, info):
    if v <= 0:
        raise ValueError(f"{info.field_name} must be a positive integer")
    return v
```

Also added consumer-side validation in `shared/event_parser.py`. Even though the API validates before publishing, events could come from other producers in the future. The parser tries to construct the right model from the raw dict — if it fails, it logs and skips.

---

## Logging

Replaced all `print()` with Python's `logging` module. Created `shared/logger.py` — one function that every service calls:

```python
logger = get_logger("analytics-service")
logger.info("Event received | event_id=abc-123 type=like")
logger.error("Failed to process | event_id=abc-123")
```

Every log line has a timestamp, level, service name, and the `event_id`.

`print` has no level, no timestamp, no source. Once you have more than one service, `logging` is the only sane choice.

---

## Project structure evolution

Started with everything at root:

```
main.py
Dockerfile
requirements.txt
docker-compose.yml
```

Ended with each service self-contained:

```
docker-compose.yml        ← orchestration, stays at root
shared/                   ← shared code, stays at root
api-service/
analytics-service/
feed-service/
notification-service/
```

Each service has its own `main.py`, `requirements.txt`, `Dockerfile`. Docker build context is always root so shared/ is accessible. Each Dockerfile copies only what it needs.

---

## Things worth remembering

**depends_on is not enough** — always add healthchecks for services that take time to boot.

**Kafka at-least-once** — duplicates can happen. Use idempotent inserts (`INSERT OR IGNORE` + unique constraint).

**Partition key matters** — without it, ordering across a topic is not guaranteed. Use a meaningful key (post_id, user_id) based on what ordering matters for each consumer.

---

## The full flow

```
curl POST /like
    → api-service validates (Pydantic)
    → generates event_id (UUID)
    → publishes to Kafka "user-events" with post_id as partition key
        → notification-service: prints human-readable message
        → analytics-service: increments like_count in Redis
        → feed-service: inserts event row in SQLite
    → if any consumer fails → retry 3x → DLQ
```

One HTTP request, three independent reactions, zero coupling between consumers.
