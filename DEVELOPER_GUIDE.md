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
-   **Networking**: Client-side fetches use `http://localhost:8000`, but Server-Side fetches (in loaders/actions) MUST use the internal Docker network `http://backend:8000`. Use the `getApiUrl` utility in `ssr-helpers.ts`.

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


## 🚀 Production Deployment (VPS, Docker Compose)

Production is fully dockerized on a VPS — no cloud-specific services. The
stack (`docker-compose.prod.yml`) runs Caddy for automatic HTTPS, the frontend
SSR server, the FastAPI backend (which applies Alembic migrations on boot),
Postgres 18, a cron container that fires the daily snapshot job
(`POST /internal/tasks/daily-snapshot`, replacing Cloud Scheduler), and a
nightly `pg_dump` backup service.

```bash
# On the VPS, from the repo root:
cp .env.production.example .env.production   # fill in domains + secrets
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Deploying an update is `git pull` followed by the same `up -d --build`.

The complete runbook — VPS provisioning, DNS, migrating data off the old
gcloud database, backups/restore, and decommissioning Cloud Run — lives in
[DEPLOYMENT.md](DEPLOYMENT.md).

> **Deprecated**: the Cloud Run / Cloud Build flow (`cloudbuild.yaml`) is no
> longer the production path; the file is kept for reference until the gcloud
> project is wound down.

## 📱 Native Mobile Clients

`ios/` (SwiftUI) and `android/` (Jetpack Compose) are the active mobile clients — deliberate
ports of each other, sharing the same backend and the same behavioural rules. `mobile/` (Expo)
is frozen.

### Android

```bash
cd android
./gradlew :app:installDebug        # build + install on a running device/emulator
./gradlew :app:testDebugUnitTest   # unit tests
```

`local.properties` needs `sdk.dir=$HOME/Library/Android/sdk`. Debug builds point at
`http://10.0.2.2:8000` — the host's loopback as seen from the emulator — so a
`docker compose up` backend is reachable with no configuration. For a physical device on the
LAN, set the override in **More ▸ API server** (debug builds only). See
[android/AGENTS.md](android/AGENTS.md).

### iOS Release Build & On-Device Install

To test a Release build on your own iPhone/iPad:

```bash
cd ios
xcodebuild archive \
  -project FinanceTracker.xcodeproj -scheme FinanceTracker -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/FinanceTracker.xcarchive
xcodebuild -exportArchive -archivePath build/FinanceTracker.xcarchive \
  -exportOptionsPlist exportOptions.plist -exportPath build/export   # method: development
xcrun devicectl device install app --device <device-udid> build/export/FinanceTracker.ipa
```

For the fastest path (no archive/IPA at all — just a Release build run over a cable), the
`exportOptions.plist` template, and how a device gets registered with the signing team in the
first place, see the **Release Build & Install on Your Own Device** section in
[ios/AGENTS.md](ios/AGENTS.md).
