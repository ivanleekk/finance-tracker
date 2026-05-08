FROM ghcr.io/astral-sh/uv:python3.14-alpine as base

WORKDIR /app

# Install dependencies first to leverage Docker caching
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev

# ---------------------------------------------------------
# Development Stage
# ---------------------------------------------------------
FROM base as development
COPY . /app
RUN uv pip install -e .
EXPOSE 5001
CMD ["sh", "-c", "uv run alembic upgrade head && uv run fastapi dev --host 0.0.0.0 --port 5001 src/main.py"]

# ---------------------------------------------------------
# Production Stage
# ---------------------------------------------------------
FROM base as production
COPY . /app
# Sync again with project installed, still no-dev
RUN uv sync --frozen --no-dev
EXPOSE 5001
# In production, we use uvicorn directly for better performance and stability
CMD ["sh", "-c", "uv run alembic upgrade head && uv run uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-5001}"]