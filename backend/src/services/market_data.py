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

def fetch_and_cache_market_prices_range(db: Session, tickers: List[str], start_date: date, end_date: date):
    """
    Fetches historical closing prices for a list of tickers over a date range
    and upserts them into the market_prices table.
    """
    if not tickers:
        return

    # Convert to standard format
    tickers = list(set([t.upper() for t in tickers]))

    start_str = start_date.strftime('%Y-%m-%d')
    end_str = (end_date + timedelta(days=1)).strftime('%Y-%m-%d')

    logger.info(f"Fetching market data for {len(tickers)} tickers from {start_str} to {end_str}")
    
    try:
        data = yf.download(tickers, start=start_str, end=end_str, group_by='ticker', progress=False)
    except Exception as e:
        logger.error(f"Error fetching range data from yfinance: {e}")
        raise

    if data.empty:
        logger.warning(f"No market data returned for range {start_str} to {end_str}")
        return

    records_to_upsert = []

    for ticker in tickers:
        # yfinance structure depends on number of tickers
        if len(tickers) == 1:
            ticker_data = data
        else:
            if ticker not in data: continue
            ticker_data = data[ticker]
            
        if 'Close' in ticker_data:
            # Get all non-NaN closing prices
            closes = ticker_data['Close'].dropna()
            for dt, price in closes.items():
                records_to_upsert.append({
                    "id": uuid.uuid7(),
                    "ticker": ticker,
                    "date": dt.date(),
                    "close_price": float(price.item() if hasattr(price, 'item') else price),
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
