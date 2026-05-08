# Backend

Run FastAPI in dev mode using

```bash
uv run fastapi dev src/main.p
```

## Database

![Database Schema](./database_schema.svg)

Create revision for alembic

```bash
uv run alembic revision --autogenerate -m "comment here"
```

Upgrade database

```bash
uv run alembic upgrade head
```
