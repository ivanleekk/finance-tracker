# Finance Tracker

A modern, premium finance management platform designed for young adults to track milestones, visualize long-term goals, and manage household finances with ease.

![Finance Tracker Dashboard](https://placehold.co/1200x600/2563eb/white?text=Finance+Tracker+Dashboard)

## 🚀 Key Features

-   **Multi-Currency Support**: Automated conversion using historical exchange rates (via yfinance).
-   **Portfolio Analytics**: Advanced performance metrics including TWR, MWR/IRR, and risk-adjusted ratios (Sharpe, Sortino, Treynor).
-   **Household Management**: Collaborate on finances with family or partners.
-   **Real-time Insights**: Dynamic charting for net worth, equity curves, and historical balances.
-   **Automated Snapshots**: Daily financial snapshots for long-term progress visualization.

## 🏗 Architecture

The project is built as a monorepo with a decoupled frontend and backend:

-   **Backend**: FastAPI (Python 3.14) with SQLAlchemy, Polars for high-performance analytics, and Alembic for migrations.
-   **Frontend**: React 19 + Vite 8, utilizing React Router v7 SSR, Tailwind CSS 4, and Framer Motion for a premium UX.
-   **Database**: PostgreSQL 18.
-   **Orchestration**: Docker Compose for local development and containerized deployment.

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
├── frontend/           # React application
│   ├── src/            # Source code (pages, components, lib)
│   ├── public/         # Static assets
│   └── tailwind.config.ts
├── docker-compose.yml  # Local infrastructure
└── README.md           # This file
```

## 📖 Documentation

For more detailed guides, check the following:
-   [Developer Guide](./DEVELOPER_GUIDE.md)
-   [Backend README](./backend/README.md)
-   [Frontend README](./frontend/README.md)
