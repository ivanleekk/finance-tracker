from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.orm import Session
from datetime import date
import os

from src.database import get_db
from src.models import Household, PortfolioSnapshot, Trade
from sqlalchemy import select, func
from src.services.snapshot_engine import run_snapshot_range
from src.services.dividend_engine import sync_dividends_range
from src.services.recurring_service import materialize_due

router = APIRouter(prefix="/internal", tags=["Internal"])

def verify_scheduler_secret(x_scheduler_secret: str = Header(None)):
    expected_secret = os.getenv("SCHEDULER_SECRET")
    if not expected_secret:
        # If no secret is configured, deny all requests for safety
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server configuration error: SCHEDULER_SECRET not set"
        )
    if x_scheduler_secret != expected_secret:
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
            # Post any recurring transactions that have come due. This runs for
            # every household, including ones with no portfolio activity — a
            # household can have rent and salary without ever placing a trade.
            recurring_posted = materialize_due(db, hh_id, today)
            db.commit()

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
                # Record any dividends that went ex within the caught-up range
                dividends_recorded = sync_dividends_range(db, hh_id, last_snapshot_date, today)
                results.append({"household_id": hh_id, "status": "updated", "from": last_snapshot_date, "to": today, "dividends_recorded": dividends_recorded, "recurring_posted": recurring_posted})
            else:
                results.append({"household_id": hh_id, "status": "no_data", "recurring_posted": recurring_posted})
                
        return {"status": "success", "processed": len(results), "details": results}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
