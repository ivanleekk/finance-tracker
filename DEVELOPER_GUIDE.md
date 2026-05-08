# Developer Guide

Welcome to the Finance Tracker development guide. This document outlines the technical architecture, development standards, and local setup instructions.

## 🏗 System Architecture

### Multi-Currency Engine
The system standardizes all financial reporting (Dashboard, Portfolio, Net Worth) to the household's `base_currency`.
-   **Storage**: `AccountBalance` and `PortfolioSnapshot` store both native currency and `home_currency` (base) equivalents.
-   **Conversion**: The `snapshot_engine.py` uses `yfinance` to fetch historical exchange rates at the time of the record.

### Authentication & SSR
The project uses **React Router v7 SSR** with JWT-based authentication via HTTP-only cookies.
-   **SSR Loaders**: Must manually extract and forward cookies from the incoming browser request to the backend.
-   **Networking**: Client-side fetches use `http://localhost:5001`, but Server-Side fetches (in loaders/actions) MUST use the internal Docker network `http://backend:5001`. Use the `getApiUrl` utility in `ssr-helpers.ts`.

## 💻 Local Development Setup

If you prefer to run the services outside of Docker:

### Backend Setup
1.  Navigate to `backend/`.
2.  Install dependencies: `uv sync`.
3.  Set environment variables in `.env`.
4.  Run migrations: `uv run alembic upgrade head`.
5.  Start server: `uv run fastapi dev src/main.py`.

### Frontend Setup
1.  Navigate to `frontend/`.
2.  Install dependencies: `pnpm install`.
3.  Set environment variables in `.env`.
4.  Start dev server: `pnpm run dev`.

## 🛠 Development Standards

### Data Fetching
-   **Paradigm**: Use React Router v7 Loaders for data fetching and Actions for mutations.
-   **Avoid `useEffect`**: Do not use `useEffect` for initial data fetching to maintain SSR compatibility and clean data flow.

### Styling
-   **Vanilla CSS + Tailwind 4**: Use Tailwind CSS for utility styling but favor custom CSS in `index.css` for complex design tokens.
-   **Premium UI**: Use vibrant color palettes, glassmorphism, and smooth transitions to maintain the "Premium" feel.

### Database Migrations
-   Always use `alembic` for schema changes.
-   Run `uv run alembic revision --autogenerate -m "description"` after modifying `models.py`.

## 🧪 Testing
-   **Backend**: Run tests using `uv run pytest`.
-   **Frontend**: (Add testing framework details if applicable, e.g., Vitest).

## 📊 Analytics
We use **Microsoft Clarity** for behavior analytics. The Project ID is managed via `VITE_CLARITY_ID` in the frontend environment files.

## ☁️ Cloud Deployment (GCP)

This project is deployed using **Google Cloud Run** and orchestrated via **Cloud Build**.

### Prerequisites
1.  **gcloud CLI**: Installed and authenticated (`gcloud auth login`).
2.  **Project ID**: Set your active project (`gcloud config set project [PROJECT_ID]`).
3.  **Artifact Registry**: Ensure a repository named `finance-tracker` exists in your chosen region.
4.  **Secret Manager**: `FINANCE_TRACKER_DB_URL` must be stored in Secret Manager.

### Deployment Command
Run the following from the project root to build and deploy both services:
```bash
gcloud builds submit --config cloudbuild.yaml
```

### Custom Substitutions
You can override default variables during build:
```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_TAG=v1.0.0
```

### CI/CD Integration
The `cloudbuild.yaml` is designed to be triggered by GitHub/GitLab actions or via direct console triggers on push to the `main` branch.

