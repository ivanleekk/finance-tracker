# src/main.py

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from src.routers import accounts, cashflow, portfolio, users, auth
from src.database import SessionLocal
from src.services.snapshot_engine import run_daily_snapshot

def scheduled_snapshot_job():
    db = SessionLocal()
    try:
        # We process the snapshot for the current UTC date at 11:50 PM
        target_date = datetime.now(timezone.utc).date()
        run_daily_snapshot(db, target_date)
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

app = FastAPI(
    title="Finance Tracker API",
    description="Multi-tenant wealth, banking, and portfolio tracking.",
    version="1.0.0",
    lifespan=lifespan,
    servers=[
        {
            "url": "http://localhost:5001", 
            "description": "Local Development Server"
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


@app.get("/")
def read_root():
    return {"status": "online", "message": "Welcome to the Finance Tracker API"}
