import json
from kafka import KafkaProducer, KafkaConsumer
from shared.config import KAFKA_BOOTSTRAP_SERVERS

def get_producer():
    return KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        value_serializer=lambda v: json.dumps(v).encode("utf-8")
    )

def get_consumer(topic: str):
    return KafkaConsumer(
        topic,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        value_deserializer=lambda v: json.loads(v.decode("utf-8"))
    )
