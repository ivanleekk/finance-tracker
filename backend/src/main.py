# src/main.py

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.routers import accounts, cashflow, portfolio, users, auth, reference, internal

# 1. Grab the current API URL from the environment (default to localhost for dev)
api_url = os.getenv("API_URL", "http://localhost:8000")

app = FastAPI(
    title="Finance Tracker API",
    description="Multi-tenant wealth, banking, and portfolio tracking.",
    version="1.0.0",
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

# Beyond the explicit origins above, also allow any localhost/127.0.0.1 port.
# The frontend dev server doesn't always land on the configured port (another
# process already holds it, a second worktree, ad hoc preview tooling, ...),
# and CORS_ORIGINS being a fixed list turns that into an opaque network error
# instead of a clear CORS failure. Scoped to loopback hosts only, so this can't
# widen access for a real deployment - no external origin can present as
# "localhost" to a browser's CORS check.
cors_origin_regex = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
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
app.include_router(internal.router)


@app.get("/")
def read_root():
    return {"status": "online", "message": "Welcome to the Finance Tracker API"}
