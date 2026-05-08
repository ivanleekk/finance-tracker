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

### CI/CD & Environments

We use a single `cloudbuild.yaml` to manage multiple environments (e.g., `prod` and `dev`). This is achieved using **Cloud Build Substitutions**.

#### 1. Deployment Environments
-   **Production**: Service names: `backend`, `frontend`.
-   **Development**: Service names: `backend-dev`, `frontend-dev`.

#### 2. Setting up Triggers
To automate this, set up two triggers in the [Google Cloud Build Console](https://console.cloud.google.com/cloud-build/triggers):

**Trigger A: Production (Main Branch)**
-   **Event**: Push to branch
-   **Branch**: `^main$`
-   **Configuration**: `cloudbuild.yaml`
-   **Substitutions**: (Default values in `cloudbuild.yaml` are set for production).

**Trigger B: Development (Dev Branch)**
-   **Event**: Push to branch
-   **Branch**: `^dev$`
-   **Configuration**: `cloudbuild.yaml`
-   **Substitutions**:
    -   `_SERVICE_SUFFIX`: `-dev`
    -   `_TAG`: `dev`
    -   `_API_URL`: `https://dev-api.yourdomain.com` (Your dev URL)
    -   `_ENV_CORS_ORIGIN`: `https://dev.yourdomain.com` (Your dev frontend URL)
    -   `_DB_SECRET`: `FINANCE_TRACKER_DB_URL_DEV` (Your dev database secret)

> [!TIP]
> **Dev Database Setup**: Create a second secret in Google Secret Manager (e.g., `FINANCE_TRACKER_DB_URL_DEV`) containing the connection string for your dev database before setting up the trigger.

#### 3. Manual Dev Deployment
You can manually deploy the dev environment from your local machine:
```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_SERVICE_SUFFIX=-dev,_TAG=dev,_API_URL=https://dev-api.yourdomain.com,_ENV_CORS_ORIGIN=https://dev.yourdomain.com,_DB_SECRET=FINANCE_TRACKER_DB_URL_DEV
```

