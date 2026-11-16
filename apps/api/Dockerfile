FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .
# Unprivileged runtime user (2026-11-14): the API never needs root. /data holds the Skill packages (a volume).
RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin app \
    && mkdir -p /data && chown app:app /data
USER app
ENV PATH="/app/.venv/bin:$PATH" STORAGE_DIR=/data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).status == 200 else 1)"
# uvicorn from the virtualenv directly: `uv run` at start would try to sync (write) the root-owned .venv
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
