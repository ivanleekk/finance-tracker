from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from src.database import get_db

app = FastAPI(title="Finance Tracker API")


@app.get("/")
def read_root():
    return {"message": "Finance Tracker API is running"}


@app.get("/health/db")
def check_db(db: Session = Depends(get_db)):
    # A quick test to ensure Postgres is connected
    result = db.execute("SELECT 1").fetchone()
    return {"status": "connected" if result else "failed"}
