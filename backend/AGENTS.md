# Backend AI Agent Instructions

This document contains the source of truth for the Finance Tracker backend. Any AI agent working on the backend **must read and adhere to these guidelines**.

## 1. Backend Architecture
- **Framework:** FastAPI (Python 3.14).
- **Package Manager:** `uv` (use `uv` for all dependency and environment management).
- **Database:** PostgreSQL 18-alpine using SQLAlchemy 2.0+ as the ORM.
- **Migrations:** Alembic for database schema versioning.
- **Data Processing:** Polars for efficient financial data manipulation and snapshots.

## 2. Domain Model & Multi-Tenancy
- **Households:** The core unit of multi-tenancy. All accounts and portfolios belong to a `Household`.
- **Users:** Belong to a `Household`. Current implementation assumes one household per user (solo-first).
- **UUIDs:** Use UUID7 for all primary keys to ensure sortability and uniqueness.
- **Schema:** Database tables are isolated within the `finance_tracker` schema in PostgreSQL.

## 3. Implementation Standards
- **Routing:** Use APIRouters located in `src/routers/`. Group logic by domain (e.g., `accounts.py`, `portfolio.py`).
- **Schemas:** Use Pydantic V2 for all request and response models in `src/schemas.py`.
- **Database Access:** Use the session dependency from `src/database.py`. Prefer async operations where possible.
- **Models:** Define SQLAlchemy models in `src/models.py`.
- **Error Handling:** Use custom FastAPI HTTPException subclasses for consistent error responses.

## 4. Development Workflow
- **Dependency Management:** Use `uv sync` to sync dependencies and `uv add <package>` to add new ones.
- **Running Locally:** `uv run fastapi dev src/main.py` (or similar, depending on configuration).
- **Migrations:** 
  - Generate: `alembic revision --autogenerate -m "description"`
  - Apply: `alembic upgrade head`
- **Testing:** Use `pytest`. Test files should be located in the `tests/` directory.

## 5. API Design Principles
- **RESTful:** Adhere to REST principles for endpoint design.
- **Aggregation:** Provide household-level aggregation endpoints (e.g., `GET /portfolio/snapshots/household/{household_id}`) to support efficient dashboard rendering and minimize frontend-to-backend round trips.
- **Response Format:** Ensure all responses follow a consistent JSON structure.
- **Documentation:** FastAPI automatically generates Swagger docs at `/docs`. Ensure all endpoints have clear descriptions and type hints.

## 6. Security
- **Authentication:** JWT-based. Verify tokens in a reusable dependency.
- **Authorization:** Ensure users can only access data belonging to their `Household`.
