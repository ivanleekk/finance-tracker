# Project AI Agent Instructions

This document provides a high-level overview and instructions for AI agents working across the entire Finance Tracker project.

## 1. Project Overview

- **Goal:** A modern finance tracker for young adults to plan life milestones and visualize long-term goal progress.
- **Architecture:** Monorepo with a FastAPI backend and a React/TypeScript frontend.
- **Deployment:** Containerized using Docker Compose.

## 2. Core Tech Stack

- **Backend:** Python 3.14, FastAPI, SQLAlchemy, Alembic, Polars, uv.
- **Frontend (web):** React 19, TypeScript, Vite 8, Tailwind CSS 4, pnpm.
- **Mobile:** Expo / React Native, TypeScript.
- **Database:** PostgreSQL 18.

## 3. Directory Structure

- `backend/`: FastAPI application, database models, migrations, and tests.
- `frontend/`: React (web) application, UI components, and assets.
- `mobile/`: Expo / React Native application - same backend, independent codebase (no shared package; small utilities like the ⌘K/quick-add parser are intentionally duplicated between `frontend/src/lib/commandParser.ts` and `mobile/src/lib/commandParser.ts` - keep them in sync by hand when the parsing rules change).
- `docker-compose.yml`: Infrastructure orchestration (backend + web frontend only; mobile runs via `expo start`).

## 4a. Private vs. Shared Ownership

- `FinancialAccount.owner_user_id` and `SubPortfolio.owner_user_id` are nullable: `NULL` means shared with the household, a user id means private to that user. This is enforced server-side (`verify_private_owner_visibility` in `backend/src/auth.py`) as well as filtered client-side (`isVisibleInViewMode` in both frontends' `lib/ViewModeContext.tsx`).
- The Private/Household/Blended 3-way switch (or the mobile equivalent) only renders once a household has a real second person - a member beyond the owner, or a pending invite. Every user technically has their own household (created during onboarding), so household _count_ alone is not the right signal; see `ViewModeContext`'s `hasSecondPerson` check.
- Household invites (`HouseholdInvite` model) are email-based and auto-accept into a real `HouseholdMember` on signup or login for a matching email (`resolve_pending_invites` in `backend/src/routers/users.py`).

## 4. Cross-Cutting Concerns

- **Authentication:** JWT-based authentication via HTTP-only cookies. The React Router v7 SSR frontend must manually extract and forward cookies from the incoming browser request to the backend during server-side `loader` and `action` execution.
- **API Communication:** Frontend communicates with backend via REST API. Client-side fetches use `http://localhost:8000`, but Server-Side fetches (in loaders/actions) MUST use the internal Docker network `http://backend:8000` (handled by `getApiUrl` utility).
- **Data Consistency:** Ensure that frontend models/types stay in sync with backend Pydantic schemas (`backend/src/schemas.py`).
- **Data Fetching Paradigm:** The frontend strictly uses React Router v7 SSR paradigms (Loaders and Actions). Do not use `useEffect` for data fetching or mutations.
- **Development Workflow:**
    - Backend uses `uv` for dependency management.
    - Frontend uses `pnpm` for dependency management.
    - Docker is used for local development and orchestration.
- Always use `alembic` for schema changes.
- Run `uv run alembic revision --autogenerate -m "description"` after modifying `models.py`.
- **Multi-Currency Reporting**: The system standardizes all financial reporting (Dashboard, Portfolio, Net Worth) to the household's `base_currency`.
    - Backend models (`AccountBalance`, `PortfolioSnapshot`) store a `home_currency` equivalent calculated at the time of the record.
    - The `snapshot_engine.py` uses `yfinance` to fetch historical exchange rates for conversion.
    - Frontend components should prioritize displaying these converted values for aggregate views, while potentially showing native currency values for individual account details.
- **Sub-Portfolio Cash**: Uninvested cash inside a sub-portfolio is modeled as a pseudo-asset (`Asset.type == "cash"`, ticker `CASH.<CUR>`, always priced at 1.0 in its own currency — see `CASH_ASSET_TYPE` in `backend/src/models.py`). Deposits/withdrawals are buy/sell trades created via `POST /portfolio/subportfolios/{id}/cash`, so they flow through the normal transaction, balance, snapshot, and performance pipelines. Cash assets are excluded from yfinance price and dividend lookups. Shared helpers live in `backend/src/services/cash_service.py`.
    - **Settle from cash**: `TradeCreate.settle_from_cash` (used by `POST /portfolio/trades`) settles a stock buy/sell against a sub-portfolio's own cash instead of a funding-account transaction. It creates a companion trade of the cash pseudo-asset moving the opposite direction and links the pair via `Trade.settlement_trade_id` (self-referential FK). Neither leg gets a `Transaction` — no real money crosses a household account. Buys are rejected with 400 if cash is insufficient; editing/deleting a cash-settled trade keeps its companion in sync (see `settle_trade_from_cash` in `cash_service.py` and `execute_trade`/`update_trade`/`delete_trade` in `routers/portfolio.py`).
    - **Dividend cash crediting**: Auto-tracked dividends (`sync_dividends_range` in `dividend_engine.py`) no longer credit a real bank account. They credit sub-portfolio cash directly via `sync_dividend_cash_credit`, which creates/updates a buy trade of the cash pseudo-asset linked through `Dividend.cash_trade_id`. This means dividend payouts show up in the portfolio equity curve immediately (via `PortfolioSnapshot`) instead of only bumping `AccountBalance`.

## 5. Global Agent Guidelines

- **Security:** Never commit secrets or hardcode API keys. Use environment variables.
- **Consistency:** Maintain consistent naming conventions and architectural patterns across both backend and frontend.
- **Documentation:** Keep `AGENTS.md` files updated as the project evolves.
- **Testing:** Always ensure that changes are accompanied by appropriate tests (Pytest for backend, Vitest/React Testing Library for frontend).
