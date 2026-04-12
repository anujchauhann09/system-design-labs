FROM python:3.11-slim

WORKDIR /app

COPY notification-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ shared/
COPY notification-service/main.py .

CMD ["python", "main.py"]
