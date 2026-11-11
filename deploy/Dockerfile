FROM postgres:18-trixie
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PATH="/opt/venv/bin:${PATH}"
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv && pip install --no-cache-dir -r requirements.txt \
    && useradd -u 10001 -m ytn && mkdir -p /data && chown ytn /data
COPY backend/*.py ./backend/
USER ytn
ENTRYPOINT []
CMD ["uvicorn","backend.main:app","--host","0.0.0.0","--port","8000"]
