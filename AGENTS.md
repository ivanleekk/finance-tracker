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
- **Authentication:** JWT-based authentication. Frontend must handle token storage and inclusion in API requests.
- **API Communication:** Frontend communicates with backend via REST API (default port 5001).
- **Data Consistency:** Ensure that frontend models/types stay in sync with backend Pydantic schemas (`backend/src/schemas.py`).
- **Development Workflow:**
  - Backend uses `uv` for dependency management.
  - Frontend uses `pnpm` for dependency management.
  - Docker is used for local development and orchestration.

## 5. Global Agent Guidelines
- **Security:** Never commit secrets or hardcode API keys. Use environment variables.
- **Consistency:** Maintain consistent naming conventions and architectural patterns across both backend and frontend.
- **Documentation:** Keep `AGENTS.md` files updated as the project evolves.
- **Testing:** Always ensure that changes are accompanied by appropriate tests (Pytest for backend, Vitest/React Testing Library for frontend).
