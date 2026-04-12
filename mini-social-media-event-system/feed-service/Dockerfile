FROM python:3.11-slim

WORKDIR /app

COPY feed-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ shared/
COPY feed-service/main.py .

CMD ["python", "main.py"]
