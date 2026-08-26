from fastapi import APIRouter, Depends
from functools import lru_cache
from typing import List, Dict
import iso18245
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


# The 3000–3999 band is "reserved for private use" in ISO's own words, but in
# practice acquirers fill it with airline, hotel and car-rental *brands* — 3000 is
# United Airlines, 3501 is Holiday Inn Express. Labelling it by what it actually
# holds is more use to someone scrolling a picker than repeating "reserved".
_BRAND_RANGE_START = "3000"
_BRAND_GROUP = "Airline, hotel and car rental brands"


@lru_cache(maxsize=1)
def _mcc_catalogue() -> List[Dict[str, str]]:
    """
    Every merchant category code that has a usable name, with its ISO range as a
    group.

    Wording comes from the first source that has one, preferring Stripe's over
    ISO's: ISO's descriptions are terse and occasionally truncated mid-word
    ("Miscellaneous personal services -- not elsew"), where Stripe's are written
    to be shown to a person ("Miscellaneous General Services"). The four-digit
    code is the fact; the name is only a label for finding it.

    Codes with no description from any source (3780, for one) are dropped rather
    than rendered as "(no description)", which is noise in a list this long.
    """
    catalogue: List[Dict[str, str]] = []
    for mcc in iso18245.get_all_mccs():
        name = mcc.stripe_description or mcc.usda_description or mcc.iso_description
        if not name:
            continue
        is_brand = mcc.range.start == _BRAND_RANGE_START
        catalogue.append({
            "code": mcc.mcc,
            "name": name,
            "group": _BRAND_GROUP if is_brand else mcc.range.description,
            # Lets a client show the ~300 general codes first and leave the ~400
            # brand entries to search, without hardcoding the range boundary.
            "is_brand": "true" if is_brand else "false",
        })
    return sorted(catalogue, key=lambda row: row["code"])


@router.get("/mccs", response_model=List[Dict[str, str]])
def get_mccs():
    """
    Merchant category codes (ISO 18245), for the optional MCC field on a card
    transaction.

    Static reference data — the same shape as /currencies and /timezones, so the
    clients' existing searchable reference picker renders it with no new UI.
    """
    return _mcc_catalogue()
