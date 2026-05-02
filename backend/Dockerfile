FROM ghcr.io/astral-sh/uv:python3.14-alpine

WORKDIR /app

# Install dependencies first to leverage Docker caching
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev

# Copy the rest of the application
COPY . /app

# Install the project in editable mode
RUN uv pip install -e .

# Expose the port the app runs on
EXPOSE 5001

# Apply migrations before serving so restarted containers match the code.
CMD ["sh", "-c", ".venv/bin/alembic upgrade head && .venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 5001"]
