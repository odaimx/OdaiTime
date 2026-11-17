FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# /app/data guarda las fotos de checadas (volumen); se crea con dueño odai para que
# el volumen nuevo herede los permisos.
RUN useradd --create-home --uid 1000 odai && mkdir -p /app/data/fotos && chown -R odai /app
USER odai

EXPOSE 8000

# Aplica migraciones y arranca la API.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${API_WORKERS:-2} --proxy-headers --forwarded-allow-ips='*'"]
