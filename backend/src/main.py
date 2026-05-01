# src/main.py

from fastapi import FastAPI
from src.routers import accounts, cashflow, portfolio, users, auth

tags_metadata = [
    {"name": "Authentication", 'description': 'Authentication Routes'},
    {"name": "Users", 'description': 'User and Household Management Routes'},
    {"name": "Financial Accounts", 'description': 'Financial Account Management Routes'},
    {"name": "Income & Expenses", 'description': 'Income and Expense Management Routes'},
    {"name": "Investments & Trades", 'description': 'Investment and Trade Management Routes'}
]

app = FastAPI(
    title="Finance Tracker API",
    description="Multi-tenant wealth, banking, and portfolio tracking.",
    version="1.0.0",
    openapi_tags=tags_metadata,
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
