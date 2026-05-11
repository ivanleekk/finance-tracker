import logging
from datetime import date, timedelta
from typing import List
import uuid

import yfinance as yf
import pandas as pd
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from sqlalchemy import select, func, desc

from src.models import MarketPrice, ExchangeRate

logger = logging.getLogger(__name__)

def fetch_and_cache_market_prices(db: Session, tickers: List[str], target_date: date):
    """
    Fetches end-of-day closing prices for a list of tickers.
    If target_date fails, fetches the last 7 days to ensure we have a fallback price.
    """
    if not tickers:
        return

    tickers = list(set([t.upper() for t in tickers]))
    
    # Try fetching for the specific date first
    start_date = target_date.strftime('%Y-%m-%d')
    end_date = (target_date + timedelta(days=1)).strftime('%Y-%m-%d')

    logger.info(f"Fetching market data for {tickers} on {start_date}")
    
    try:
        data = yf.download(tickers, start=start_date, end=end_date, group_by='ticker', progress=False)
        
        # If empty, try fetching the last 7 days for these tickers
        if data.empty:
            logger.info(f"No data for {start_date}. Retrying with 7-day range for fallback...")
            fallback_start = (target_date - timedelta(days=7)).strftime('%Y-%m-%d')
            data = yf.download(tickers, start=fallback_start, end=end_date, group_by='ticker', progress=False)

        if data.empty:
            logger.warning(f"Failed to retrieve any market data for {tickers} in the 7-day window.")
            return

        records_to_upsert = []
        
        # Helper to process a ticker's data
        def process_ticker(ticker_name, ticker_df):
            if 'Close' in ticker_df and not ticker_df['Close'].dropna().empty:
                closes = ticker_df['Close'].dropna()
                for dt, price in closes.items():
                    close_val = float(price.item() if hasattr(price, 'item') else price)
                    records_to_upsert.append({
                        "id": uuid.uuid7(),
                        "ticker": ticker_name,
                        "date": dt.date(),
                        "close_price": close_val,
                        "currency": "USD"
                    })

        if len(tickers) == 1:
            process_ticker(tickers[0], data)
        else:
            for ticker in tickers:
                if ticker in data:
                    process_ticker(ticker, data[ticker])

        if not records_to_upsert:
            return

        stmt = insert(MarketPrice).values(records_to_upsert)
        upsert_stmt = stmt.on_conflict_do_update(
            constraint="uq_market_price_ticker_date",
            set_={"close_price": stmt.excluded.close_price}
        )
        db.execute(upsert_stmt)
        db.commit()
        logger.info(f"Successfully cached {len(records_to_upsert)} price points for {tickers}.")

    except Exception as e:
        db.rollback()
        logger.error(f"Error in fetch_and_cache_market_prices: {e}")

def fetch_and_cache_market_prices_range(db: Session, tickers: List[str], start_date: date, end_date: date):
    """
    Fetches historical closing prices for a list of tickers over a date range
    and upserts them into the market_prices table.
    """
    if not tickers:
        return

    # Convert to standard format
    tickers = list(set([t.upper() for t in tickers]))

    # Pad the start date by 7 days. If the requested range starts on a weekend/holiday,
    # or is just a single day that happens to be a weekend, this ensures we fetch the 
    # most recent preceding closing price to populate the cache.
    padded_start = start_date - timedelta(days=7)
    
    start_str = padded_start.strftime('%Y-%m-%d')
    end_str = (end_date + timedelta(days=1)).strftime('%Y-%m-%d')

    print(f"DEBUG: Market Range Fetch: {tickers} from {start_str} to {end_str}")
    
    try:
        data = yf.download(tickers, start=start_str, end=end_str, group_by='ticker', progress=False)
        print(f"DEBUG: yfinance returned {len(data)} rows of data.")
    except Exception as e:
        print(f"DEBUG: yfinance download FAILED for {tickers}: {e}")
        raise

    if data.empty:
        return

    records_to_upsert = []

    for ticker in tickers:
        # yfinance with group_by='ticker' returns a MultiIndex if multiple tickers 
        # or sometimes even for one. We'll handle both.
        if ticker in data.columns.get_level_values(0):
            ticker_data = data[ticker]
        else:
            # Fallback for older yfinance or different return structures
            ticker_data = data
            
        if 'Close' in ticker_data:
            # Get all non-NaN closing prices
            closes = ticker_data['Close'].dropna()
            for dt, price in closes.items():
                close_val = float(price.item() if hasattr(price, 'item') else price)
                records_to_upsert.append({
                    "id": uuid.uuid7(),
                    "ticker": ticker,
                    "date": dt.date(),
                    "close_price": close_val,
                    "currency": "USD"
                })

    if not records_to_upsert:
        return

    # Prepare PostgreSQL UPSERT
    stmt = insert(MarketPrice).values(records_to_upsert)
    upsert_stmt = stmt.on_conflict_do_update(
        constraint="uq_market_price_ticker_date",
        set_={
            "close_price": stmt.excluded.close_price,
            "currency": stmt.excluded.currency
        }
    )

    try:
        db.execute(upsert_stmt)
        db.commit()
        logger.info(f"Successfully upserted {len(records_to_upsert)} market prices for range.")
    except Exception as e:
        db.rollback()
        logger.error(f"Database error during market price range upsert: {e}")
        raise

def fetch_and_cache_treasury_rates(db: Session, ticker: str = "^IRX", days: int = 7300):
    """
    Fetches historical treasury yields (e.g. ^IRX for 13-week T-bills) 
    and stores them in market_prices. Yields are stored as decimals (e.g. 0.05 for 5%).
    """
    end_date = date.today()
    start_date = end_date - timedelta(days=days)
    
    start_str = start_date.strftime('%Y-%m-%d')
    end_str = (end_date + timedelta(days=1)).strftime('%Y-%m-%d')
    
    logger.info(f"Fetching treasury data for {ticker} from {start_str}")
    
    try:
        data = yf.download(ticker, start=start_str, end=end_str, progress=False)
        if data.empty:
            return
        
        records = []
        # yfinance might return a Series or DataFrame depending on columns
        closes = data['Close']
        if len(closes.shape) > 1:
            closes = closes.iloc[:, 0]
            
        closes = closes.dropna()
        for dt, price in closes.items():
            # Treasury yields in yfinance are often in percentage (e.g. 5.3)
            # Handle potential non-scalar prices
            try:
                val = price.item() if hasattr(price, 'item') else price
                yield_val = float(val) / 100.0
            except:
                # If it's an array/series of size 1, this should work
                yield_val = float(price) / 100.0
            records.append({
                "id": uuid.uuid7(),
                "ticker": ticker,
                "date": dt.date(),
                "close_price": yield_val,
                "currency": "PERCENT"
            })
            
        if not records:
            return
            
        stmt = insert(MarketPrice).values(records)
        upsert_stmt = stmt.on_conflict_do_update(
            constraint="uq_market_price_ticker_date",
            set_={"close_price": stmt.excluded.close_price}
        )
        db.execute(upsert_stmt)
        db.commit()
        logger.info(f"Successfully cached {len(records)} treasury rates.")
    except Exception as e:
        db.rollback()
        logger.error(f"Error fetching treasury rates: {e}")

def fetch_and_cache_exchange_rates(db: Session, base: str, target: str, target_date: date):
    """
    Fetches exchange rate between base and target currency. 
    If not in cache, fetches the entire YEAR of data to minimize future yfinance calls.
    Ticker format: {BASE}{TARGET}=X (e.g. EURUSD=X)
    """
    base = base.upper()
    target = target.upper()
    
    if base == target:
        return 1.0
        
    ticker = f"{base}{target}=X"
    
    from src.models import ExchangeRate
    from sqlalchemy import select
    
    # 1. Check if we have the specific date
    existing = db.execute(
        select(ExchangeRate)
        .where(ExchangeRate.base_currency == base)
        .where(ExchangeRate.target_currency == target)
        .where(ExchangeRate.date == target_date)
    ).scalar_one_or_none()
    
    if existing:
        return existing.rate

    # 2. If not found, fetch the entire YEAR of data for this pair
    year_start = date(target_date.year, 1, 1)
    year_end = date(target_date.year, 12, 31)
    
    start_str = year_start.strftime('%Y-%m-%d')
    # We add 1 day to end_date because yfinance end is exclusive
    end_str = (year_end + timedelta(days=1)).strftime('%Y-%m-%d')
    
    logger.info(f"Cache miss for {ticker} on {target_date}. Fetching entire year {target_date.year}...")
    print(f"DEBUG: Cache miss for {ticker} on {target_date}. Fetching from yfinance...")
    
    try:
        data = yf.download(ticker, start=start_str, end=end_str, progress=False)
        if not data.empty and 'Close' in data:
            # Handle MultiIndex columns (Attribute, Ticker) or (Ticker, Attribute)
            closes_raw = data['Close']
            if isinstance(closes_raw, pd.DataFrame):
                # If MultiIndex, it might have one column for the ticker
                closes = closes_raw.iloc[:, 0].dropna()
            else:
                closes = closes_raw.dropna()

            records = []
            for dt, price in closes.items():
                rate_val = float(price.item() if hasattr(price, 'item') else price)
                records.append({
                    "id": uuid.uuid7(),
                    "base_currency": base,
                    "target_currency": target,
                    "date": dt.date(),
                    "rate": rate_val
                })
            
            if records:
                # Upsert records
                stmt = insert(ExchangeRate).values(records)
                upsert_stmt = stmt.on_conflict_do_update(
                    constraint="uq_exchange_rate_base_target_date",
                    set_={"rate": stmt.excluded.rate}
                )
                db.execute(upsert_stmt)
                db.commit()
                
                # Try to find the exact date again after bulk insert
                for r in records:
                    if r["date"] == target_date:
                        return r["rate"]
                
                # If exact date not in the year's data (e.g. holiday/weekend), find the nearest preceding
                nearest = db.execute(
                    select(ExchangeRate.rate)
                    .where(ExchangeRate.base_currency == base)
                    .where(ExchangeRate.target_currency == target)
                    .where(ExchangeRate.date <= target_date)
                    .order_by(ExchangeRate.date.desc())
                    .limit(1)
                ).scalar()
                
                if nearest:
                    return nearest

    except Exception as e:
        logger.error(f"Error fetching yearly exchange rate {ticker}: {e}")
        db.rollback()
        
    # Fallback to reverse rate if forward fails
    ticker_rev = f"{target}{base}=X"
    try:
        data = yf.download(ticker_rev, start=start_str, end=end_str, progress=False)
        if not data.empty and 'Close' in data:
            closes = data['Close'].dropna()
            records = []
            for dt, price in closes.items():
                rate_rev = float(price.item() if hasattr(price, 'item') else price)
                records.append({
                    "id": uuid.uuid7(),
                    "base_currency": base,
                    "target_currency": target,
                    "date": dt.date(),
                    "rate": 1.0 / rate_rev
                })
            
            if records:
                stmt = insert(ExchangeRate).values(records)
                upsert_stmt = stmt.on_conflict_do_update(
                    constraint="uq_exchange_rate_base_target_date",
                    set_={"rate": stmt.excluded.rate}
                )
                db.execute(upsert_stmt)
                db.commit()
                
                for r in records:
                    if r["date"] == target_date:
                        return r["rate"]
                
                nearest = db.execute(
                    select(ExchangeRate.rate)
                    .where(ExchangeRate.base_currency == base)
                    .where(ExchangeRate.target_currency == target)
                    .where(ExchangeRate.date <= target_date)
                    .order_by(ExchangeRate.date.desc())
                    .limit(1)
                ).scalar()
                
                if nearest:
                    return nearest
    except Exception as e:
        print(f"DEBUG: Error fetching yearly reverse exchange rate {ticker_rev}: {e}")
        logger.error(f"Error fetching yearly reverse exchange rate {ticker_rev}: {e}")
        db.rollback()
        
    print(f"DEBUG: Exchange rate fallback for {base}->{target} on {target_date} is 1.0")
    return 1.0 # Last resort fallback

def fetch_and_cache_exchange_rates_range(db: Session, base: str, target: str, start_date: date, end_date: date):
    """
    Fetches exchange rates for a range and returns a lookup dict {(date, base, target): rate}.
    Uses local cache first, then fills gaps from yfinance.
    """
    if base == target:
        # Return 1.0 for all dates in the range
        lookup = {}
        curr = start_date
        while curr <= end_date:
            lookup[(curr, base, target)] = 1.0
            curr += timedelta(days=1)
        return lookup

    # 1. Check local cache for the range
    existing = db.execute(
        select(ExchangeRate.date, ExchangeRate.rate)
        .where(ExchangeRate.base_currency == base)
        .where(ExchangeRate.target_currency == target)
        .where(ExchangeRate.date >= start_date)
        .where(ExchangeRate.date <= end_date)
    ).all()
    
    lookup = {(row.date, base, target): float(row.rate) for row in existing}
    
    # 2. Identify missing years (we fetch in yearly batches for efficiency)
    years_to_fetch = set()
    curr = start_date
    while curr <= end_date:
        if (curr, base, target) not in lookup:
            years_to_fetch.add(curr.year)
        curr += timedelta(days=1)
        
    for year in sorted(years_to_fetch):
        # Use existing logic to fetch and cache a full year
        # This will fill the database for the whole year
        year_start = date(year, 1, 1)
        year_end = date(year, 12, 31)
        
        # Ensure we don't fetch into the future
        if year_end > date.today():
            year_end = date.today()
            
        ticker = f"{base}{target}=X"
        print(f"DEBUG: Filling exchange rate gap for {year} ({ticker})")
        
        try:
            data = yf.download(ticker, start=year_start, end=year_end + timedelta(days=1), progress=False)
            if not data.empty and 'Close' in data:
                # Handle MultiIndex columns (Attribute, Ticker) or (Ticker, Attribute)
                closes_raw = data['Close']
                if isinstance(closes_raw, pd.DataFrame):
                    # If MultiIndex, it might have one column for the ticker
                    closes = closes_raw.iloc[:, 0].dropna()
                else:
                    closes = closes_raw.dropna()

                if not closes.empty:
                    records = []
                    for dt, rate in closes.items():
                        r_val = float(rate.item() if hasattr(rate, 'item') else rate)
                        records.append({
                            "id": uuid.uuid7(),
                            "base_currency": base,
                            "target_currency": target,
                            "date": dt.date(),
                            "rate": r_val
                        })
                        lookup[(dt.date(), base, target)] = r_val
                        
                    if records:
                        stmt = insert(ExchangeRate).values(records)
                        upsert_stmt = stmt.on_conflict_do_update(
                            constraint="uq_exchange_rate_base_target_date",
                            set_={"rate": stmt.excluded.rate}
                        )
                        db.execute(upsert_stmt)
                        db.commit()
        except Exception as e:
            print(f"DEBUG: Failed to fetch yearly exchange rates for {year}: {e}")
            
    # 3. Fill any remaining gaps (weekends) with the nearest preceding rate
    # This ensures the lookup dict has a value for every single day in the range
    curr = start_date
    last_known_rate = None
    
    # Pre-populate with the very first available rate before start_date if needed
    if (start_date, base, target) not in lookup:
        prev = db.execute(
            select(ExchangeRate.rate)
            .where(ExchangeRate.base_currency == base)
            .where(ExchangeRate.target_currency == target)
            .where(ExchangeRate.date < start_date)
            .order_by(ExchangeRate.date.desc())
            .limit(1)
        ).scalar()
        if prev:
            last_known_rate = float(prev)

    while curr <= end_date:
        if (curr, base, target) in lookup:
            last_known_rate = lookup[(curr, base, target)]
        elif last_known_rate is not None:
            lookup[(curr, base, target)] = last_known_rate
        else:
            # If we STILL have no rate (e.g. at the very start of history), 
            # try to find the absolute first rate available
            first = db.execute(
                select(ExchangeRate.rate)
                .where(ExchangeRate.base_currency == base)
                .where(ExchangeRate.target_currency == target)
                .order_by(ExchangeRate.date.asc())
                .limit(1)
            ).scalar()
            if first:
                last_known_rate = float(first)
                lookup[(curr, base, target)] = last_known_rate
            else:
                # Default to 1.0 if absolutely no data exists
                lookup[(curr, base, target)] = 1.0
        curr += timedelta(days=1)
        
    return lookup
