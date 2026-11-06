FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev
COPY app ./app
ENV PORT=8000
EXPOSE 8000
# One worker: the event log and rebuttal queues live in process memory.
# Proxy headers are ignored here; the app reads X-Forwarded-For itself (TRUSTED_PROXY_HOPS).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --no-proxy-headers"]
