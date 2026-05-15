FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml poetry.lock* /app/
RUN apt-get update && apt-get install -y build-essential libpq-dev && rm -rf /var/lib/apt/lists/*
RUN pip install --upgrade pip
RUN pip install poetry || true
RUN poetry config virtualenvs.create false || true
RUN poetry install --no-dev || pip install -r requirements.txt
COPY . /app
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000"]
