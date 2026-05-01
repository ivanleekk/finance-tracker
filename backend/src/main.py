# src/main.py

from fastapi import FastAPI
from src.routers import accounts, cashflow, portfolio, users, auth

app = FastAPI(
    title="Finance Tracker API",
    description="Multi-tenant wealth, banking, and portfolio tracking.",
    version="1.0.0",
    servers=[
        {
            "url": "http://localhost:8000", 
            "description": "Local Development Server"
        },
    ],
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
