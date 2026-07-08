# Finance Tracker

A modern, premium finance management platform designed for young adults to track milestones, visualize long-term goals, and manage household finances with ease.

![Finance Tracker Dashboard](https://placehold.co/1200x600/2563eb/white?text=Finance+Tracker+Dashboard)

## 🚀 Key Features

-   **Multi-Currency Support**: Automated conversion using historical exchange rates (via yfinance).
-   **Portfolio Analytics**: Advanced performance metrics including TWR, MWR/IRR, and risk-adjusted ratios (Sharpe, Sortino, Treynor).
-   **Private vs. Shared Finances**: Every account and goal is either private to you or shared with your household. The Private/Household/Blended switch only appears once a household actually has a second member or pending invite — solo users never see it.
-   **Household Management**: Collaborate on finances with family or partners, with email-based invites, default expense splits, and per-account sharing controls.
-   **⌘K Command Bar**: Log an expense, trade, balance update, dividend, or transfer from a single parsed input (`coffee 5.20`, `buy 10 VOO`, `transfer 500 from DBS to IBKR`) — on web via `⌘K`, on mobile via a quick-add sheet. Includes receipt scanning and ticker autocomplete.
-   **Dividends & Goals**: Dividend income calendar with yield-on-cost, and goal tracking with projected completion dates.
-   **Real-time Insights**: Dynamic charting for net worth, equity curves, and historical balances.
-   **Automated Snapshots**: Daily financial snapshots for long-term progress visualization.

## 🏗 Architecture

The project is built as a monorepo with a decoupled backend and two frontends:

-   **Backend**: FastAPI (Python 3.14) with SQLAlchemy, Polars for high-performance analytics, and Alembic for migrations.
-   **Frontend (web)**: React 19 + Vite 8, utilizing React Router v7 SSR, Tailwind CSS 4, and Framer Motion for a premium UX.
-   **Mobile**: Expo / React Native (TypeScript), covering the same screens and backend as the web app — see [mobile/](./mobile).
-   **Database**: PostgreSQL 18.
-   **Orchestration**: Docker Compose for local development and containerized deployment (backend + web frontend; the mobile app runs via Expo separately, see below).

## 🛠 Prerequisites

Ensure you have the following installed:

-   [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/)
-   [uv](https://github.com/astral-sh/uv) (Python package manager)
-   [pnpm](https://pnpm.io/) (Node package manager)

## 🚦 Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/your-username/finance-tracker.git
cd finance-tracker
```

### 2. Environment Configuration
Create `.env` files in both `frontend/` and `backend/` directories. Refer to the `.env.development` files in each directory for required variables.

### 3. Run with Docker Compose
```bash
docker-compose up --build
```
The application will be available at:
-   **Frontend**: `http://localhost:5173`
-   **Backend API**: `http://localhost:8000`
-   **API Docs**: `http://localhost:8000/docs`

## ☁️ Deployment (Cloud Run)

The project is configured for automated deployment via Google Cloud Build.

### Automated Deployment
To trigger a full build and deployment of both services:
```bash
gcloud builds submit --config cloudbuild.yaml
```

### Deployment Configuration
-   **Region**: `asia-southeast1` (Default)
-   **Services**: `frontend` and `backend`
-   **Container Registry**: Artifact Registry
-   **Secrets**: Uses Google Secret Manager for `DATABASE_URL`.

## 📂 Project Structure

```text
.
├── backend/            # FastAPI application
│   ├── src/            # Source code (routers, models, services)
│   ├── alembic/        # Database migrations
│   └── tests/          # Pytest suite
├── frontend/           # React (web) application
│   ├── src/            # Source code (pages, components, lib)
│   ├── public/         # Static assets
│   └── tailwind.config.ts
├── mobile/              # Expo / React Native application
│   └── src/             # Screens, navigation, lib (mirrors frontend/src where practical)
├── docker-compose.yml  # Local infrastructure (backend + web frontend)
└── README.md           # This file
```

## 📱 Running the mobile app

The mobile app is a separate Expo project and isn't part of `docker-compose`:

```bash
cd mobile
npm install
echo "EXPO_PUBLIC_API_URL=http://localhost:8000" > .env   # or your LAN IP for a physical device
npx expo start
```

Note: `expo-secure-store` (used for auth tokens) has no web implementation; on `expo start --web` the app falls back to `localStorage` for local testing (see `mobile/src/lib/storage.ts`). On iOS/Android it uses the real secure keychain/keystore.

## 📖 Documentation

For more detailed guides, check the following:
-   [Developer Guide](./DEVELOPER_GUIDE.md)
-   [Backend README](./backend/README.md)
-   [Frontend README](./frontend/README.md)
