from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.orm import Session
from datetime import date
import os
import secrets

from src.database import get_db
from src.models import Household, PortfolioSnapshot, Trade
from sqlalchemy import select, func
from src.services.snapshot_engine import run_snapshot_range

router = APIRouter(prefix="/internal", tags=["Internal"])

def verify_scheduler_secret(x_scheduler_secret: str = Header(None)):
    expected_secret = os.getenv("SCHEDULER_SECRET")
    if not expected_secret:
        # If no secret is configured, deny all requests for safety
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server configuration error: SCHEDULER_SECRET not set"
        )
    # SECURITY FIX: Use secrets.compare_digest for constant-time comparison to prevent timing attacks.
    # Also explicitly check for None to avoid runtime type errors with compare_digest.
    if x_scheduler_secret is None or not secrets.compare_digest(x_scheduler_secret, expected_secret):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid scheduler secret"
        )

@router.post("/tasks/daily-snapshot", dependencies=[Depends(verify_scheduler_secret)])
def scheduled_snapshot_job(db: Session = Depends(get_db)):
    try:
        # Find all households and their last snapshot date
        households = db.execute(select(Household.id)).scalars().all()
        today = date.today()
        
        results = []
        for hh_id in households:
            # Find the last snapshot date for this household
            last_snapshot_date = db.execute(
                select(func.max(PortfolioSnapshot.date))
                .where(PortfolioSnapshot.household_id == hh_id)
            ).scalar()
            
            if not last_snapshot_date:
                # If no snapshots, check for the earliest trade
                last_snapshot_date = db.execute(
                    select(func.min(func.date(Trade.date)))
                    .where(Trade.household_id == hh_id)
                ).scalar()
                
            if last_snapshot_date:
                # Catch up from last_snapshot_date to today
                run_snapshot_range(db, hh_id, last_snapshot_date, today)
                results.append({"household_id": hh_id, "status": "updated", "from": last_snapshot_date, "to": today})
            else:
                results.append({"household_id": hh_id, "status": "no_data"})
                
        return {"status": "success", "processed": len(results), "details": results}
    except Exception:
        # SECURITY FIX: Do not expose raw exception details to prevent information leakage.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An internal server error occurred while processing the daily snapshot."
        )
