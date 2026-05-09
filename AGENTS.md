# Project AI Agent Instructions

This document provides a high-level overview and instructions for AI agents working across the entire Finance Tracker project.

## 1. Project Overview
- **Goal:** A modern finance tracker for young adults to plan life milestones and visualize long-term goal progress.
- **Architecture:** Monorepo with a FastAPI backend and a React/TypeScript frontend.
- **Deployment:** Containerized using Docker Compose.

## 2. Core Tech Stack
- **Backend:** Python 3.14, FastAPI, SQLAlchemy, Alembic, Polars, uv.
- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4, pnpm.
- **Database:** PostgreSQL 18.

## 3. Directory Structure
- `backend/`: FastAPI application, database models, migrations, and tests.
- `frontend/`: React application, UI components, and assets.
- `docker-compose.yml`: Infrastructure orchestration.

## 4. Cross-Cutting Concerns
- **Authentication:** JWT-based authentication via HTTP-only cookies. The React Router v7 SSR frontend must manually extract and forward cookies from the incoming browser request to the backend during server-side `loader` and `action` execution.
- **API Communication:** Frontend communicates with backend via REST API. Client-side fetches use `http://localhost:8000`, but Server-Side fetches (in loaders/actions) MUST use the internal Docker network `http://backend:8000` (handled by `getApiUrl` utility).
- **Data Consistency:** Ensure that frontend models/types stay in sync with backend Pydantic schemas (`backend/src/schemas.py`).
- **Data Fetching Paradigm:** The frontend strictly uses React Router v7 SSR paradigms (Loaders and Actions). Do not use `useEffect` for data fetching or mutations.
- **Development Workflow:**
  - Backend uses `uv` for dependency management.
  - Frontend uses `pnpm` for dependency management.
  - Docker is used for local development and orchestration.
- **Multi-Currency Reporting**: The system standardizes all financial reporting (Dashboard, Portfolio, Net Worth) to the household's `base_currency`. 
  - Backend models (`AccountBalance`, `PortfolioSnapshot`) store a `home_currency` equivalent calculated at the time of the record.
  - The `snapshot_engine.py` uses `yfinance` to fetch historical exchange rates for conversion.
  - Frontend components should prioritize displaying these converted values for aggregate views, while potentially showing native currency values for individual account details.

## 5. Global Agent Guidelines
- **Security:** Never commit secrets or hardcode API keys. Use environment variables.
- **Consistency:** Maintain consistent naming conventions and architectural patterns across both backend and frontend.
- **Documentation:** Keep `AGENTS.md` files updated as the project evolves.
- **Testing:** Always ensure that changes are accompanied by appropriate tests (Pytest for backend, Vitest/React Testing Library for frontend).
