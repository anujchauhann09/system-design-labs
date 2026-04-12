FROM python:3.11-slim

WORKDIR /app

COPY analytics-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ shared/
COPY analytics-service/main.py .

CMD ["python", "main.py"]
