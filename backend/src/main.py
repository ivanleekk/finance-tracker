# src/main.py

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from src.routers import accounts, cashflow, portfolio, users, auth, reference
from src.database import SessionLocal
from src.services.snapshot_engine import run_snapshot_range
from src.models import Household, PortfolioSnapshot
from sqlalchemy import func, select
from datetime import datetime, timezone, date

def scheduled_snapshot_job():
    db = SessionLocal()
    try:
        # Find all households and their last snapshot date
        households = db.execute(select(Household.id)).scalars().all()
        today = date.today()
        
        for hh_id in households:
            # Find the last snapshot date for this household
            last_snapshot_date = db.execute(
                select(func.max(PortfolioSnapshot.date))
                .where(PortfolioSnapshot.household_id == hh_id)
            ).scalar()
            
            if not last_snapshot_date:
                # If no snapshots, check for the earliest trade
                from src.models import Trade
                last_snapshot_date = db.execute(
                    select(func.min(func.date(Trade.date)))
                    .where(Trade.household_id == hh_id)
                ).scalar()
                
            if last_snapshot_date:
                # Catch up from last_snapshot_date to today
                run_snapshot_range(db, hh_id, last_snapshot_date, today)
    finally:
        db.close()

scheduler = BackgroundScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: configure and start the scheduler
    scheduler.add_job(
        scheduled_snapshot_job,
        CronTrigger(hour=23, minute=50, timezone=timezone.utc),
        id="daily_portfolio_snapshot",
        replace_existing=True,
    )
    scheduler.start()
    yield
    # Shutdown: cleanly stop the scheduler
    scheduler.shutdown()

# 1. Grab the current API URL from the environment (default to localhost for dev)
api_url = os.getenv("API_URL", "http://localhost:5001")

app = FastAPI(
    title="Finance Tracker API",
    description="Multi-tenant wealth, banking, and portfolio tracking.",
    version="1.0.0",
    lifespan=lifespan,
    # 2. Pass the dynamic variable here
    servers=[
        {
            "url": api_url, 
            "description": "Finance Tracker API Server"
        },
    ],
)

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connect the modular routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(accounts.router)
app.include_router(cashflow.router)
app.include_router(portfolio.router)
app.include_router(reference.router)


@app.get("/")
def read_root():
    return {"status": "online", "message": "Welcome to the Finance Tracker API"}
