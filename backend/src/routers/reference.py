from fastapi import APIRouter, Depends
from typing import List, Dict
import pycountry
from sqlalchemy.orm import Session
from src.database import get_db
from src import schemas

router = APIRouter(prefix="/reference", tags=["Reference Data"])

@router.get("/currencies", response_model=List[Dict[str, str]])
def get_currencies():
    """
    Returns a list of all official ISO 4217 currencies.
    """
    currencies = []
    for c in pycountry.currencies:
        # Some currencies might not have a name or alpha_3
        if hasattr(c, 'alpha_3') and hasattr(c, 'name'):
            currencies.append({
                "code": c.alpha_3,
                "name": c.name,
                "symbol": getattr(c, 'symbol', c.alpha_3)
            })
    return sorted(currencies, key=lambda x: x['code'])

@router.get("/countries", response_model=List[Dict[str, str]])
def get_countries():
    """
    Returns a list of all official ISO 3166 countries.
    """
    countries = []
    for c in pycountry.countries:
        countries.append({
            "code": c.alpha_2,
            "name": c.name
        })
    return sorted(countries, key=lambda x: x['name'])

@router.get("/exchange_rate")
def get_exchange_rate(base: str, target: str, date: str, db: Session = Depends(get_db)):
    """
    Fetch the exchange rate for a given base and target currency on a specific date.
    """
    from datetime import datetime
    from src.services.market_data import fetch_and_cache_exchange_rates
    
    target_date = datetime.strptime(date, "%Y-%m-%d").date()
    rate = fetch_and_cache_exchange_rates(db, base, target, target_date)
    return {"rate": rate}

@router.get("/timezones", response_model=List[Dict[str, str]])
def get_timezones():
    """
    Returns a list of all common timezones with their GMT offsets using pytz.
    """
    import pytz
    from datetime import datetime
    
    timezones = []
    now = datetime.now()
    for tz_name in pytz.common_timezones:
        tz = pytz.timezone(tz_name)
        offset = tz.utcoffset(now)
        offset_hours = int(offset.total_seconds() / 3600)
        offset_minutes = int((offset.total_seconds() % 3600) / 60)
        offset_str = f"GMT{'+' if offset_hours >= 0 else ''}{offset_hours:02d}:{abs(offset_minutes):02d}"
        timezones.append({
            "name": tz_name,
            "label": f"{tz_name} ({offset_str})"
        })
    return sorted(timezones, key=lambda x: x['name'])
