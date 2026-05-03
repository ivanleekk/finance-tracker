import logging
from datetime import date, timedelta
from typing import List
import uuid

import yfinance as yf
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from src.models import MarketPrice

logger = logging.getLogger(__name__)

def fetch_and_cache_market_prices(db: Session, tickers: List[str], target_date: date):
    """
    Fetches end-of-day closing prices for a list of tickers on a specific date 
    and upserts them into the market_prices table.
    """
    if not tickers:
        return

    # Convert to standard format
    tickers = list(set([t.upper() for t in tickers]))

    # yfinance uses a start and end date interval. 
    # To get data for target_date, we query from target_date to target_date + 1 day
    start_date = target_date.strftime('%Y-%m-%d')
    end_date = (target_date + timedelta(days=1)).strftime('%Y-%m-%d')

    logger.info(f"Fetching market data for {len(tickers)} tickers on {start_date}")
    
    try:
        # Download data
        data = yf.download(tickers, start=start_date, end=end_date, group_by='ticker', progress=False)
    except Exception as e:
        logger.error(f"Error fetching data from yfinance: {e}")
        raise

    if data.empty:
        logger.warning(f"No market data returned for {start_date}")
        return

    records_to_upsert = []

    # Handle single ticker vs multiple tickers response structure in pandas DataFrame
    if len(tickers) == 1:
        ticker = tickers[0]
        if 'Close' in data and not data['Close'].dropna().empty:
            # We take the first available close price in that window
            # .item() extracts the scalar value safely
            close_price = float(data['Close'].dropna().iloc[0].item() if hasattr(data['Close'].dropna().iloc[0], 'item') else data['Close'].dropna().iloc[0])
            records_to_upsert.append({
                "id": uuid.uuid7(),
                "ticker": ticker,
                "date": target_date,
                "close_price": close_price,
                "currency": "USD" # Assuming USD by default for yfinance
            })
    else:
        for ticker in tickers:
            if ticker in data and 'Close' in data[ticker] and not data[ticker]['Close'].dropna().empty:
                val = data[ticker]['Close'].dropna().iloc[0]
                close_price = float(val.item() if hasattr(val, 'item') else val)
                records_to_upsert.append({
                    "id": uuid.uuid7(),
                    "ticker": ticker,
                    "date": target_date,
                    "close_price": close_price,
                    "currency": "USD"
                })

    if not records_to_upsert:
        logger.warning("No valid closing prices found in the downloaded data.")
        return

    # Prepare PostgreSQL UPSERT
    stmt = insert(MarketPrice).values(records_to_upsert)
    
    # On conflict (ticker, date), update the close price and currency
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
        logger.info(f"Successfully upserted {len(records_to_upsert)} market prices.")
    except Exception as e:
        db.rollback()
        logger.error(f"Database error during market price upsert: {e}")
        raise
