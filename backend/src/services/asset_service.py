"""
Editing an asset's identity (ticker, name, type, currency, pricing mode).

Assets are global rows keyed by ticker, so a correction here ripples further
than a normal update. Two of the five fields carry cached state behind them:

* **ticker** keys ``market_prices`` (there is no asset_id on that table), so a
  rename has to take the price history with it -- or, for market-priced assets,
  drop it so the snapshot engine refetches under the *new* symbol. Leaving the
  old rows behind would price the renamed asset from the wrong listing.
* **currency** is what ``snapshot_engine`` converts by. It reads the asset's
  currency and the daily FX rate rather than the rate recorded on each trade,
  which is what makes a currency correction fixable at all: replaying snapshots
  from the first trade rewrites every home-currency valuation and cost basis.

Both therefore end with a snapshot replay for each household holding the asset
-- see ``asset_edit_replay_range``. The trades themselves are left alone: their
``exchange_rate`` is the rate the user recorded when the money actually moved,
and the funding transaction it produced already hit a real account balance.
"""

import uuid
from datetime import date
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models import (
    Asset,
    MarketPrice,
    PRICING_MODE_MANUAL,
    Trade,
)

# Fields a caller may correct. `id` is not one of them -- trades, dividends and
# snapshots all point at it.
EDITABLE_ASSET_FIELDS = ("ticker", "name", "type", "currency", "pricing_mode")


def normalize_asset_edit(changes: Dict) -> Dict:
    """Uppercase/trim the identity fields the same way create_asset does."""
    normalized = dict(changes)
    for field in ("ticker", "currency"):
        value = normalized.get(field)
        if isinstance(value, str):
            normalized[field] = value.strip().upper()
    name = normalized.get("name")
    if isinstance(name, str):
        normalized["name"] = name.strip()
    return normalized


def asset_edit_replay_range(db: Session, asset_id: uuid.UUID) -> List[Tuple[uuid.UUID, date]]:
    """
    (household_id, first trade date) for every household holding this asset.

    Replays start at the first trade rather than today: a currency correction
    invalidates the whole history of home-currency values, not just the tail.
    """
    rows = db.execute(
        select(Trade.household_id, Trade.date)
        .where(Trade.asset_id == asset_id)
        .order_by(Trade.date.asc())
    ).all()

    earliest: Dict[uuid.UUID, date] = {}
    for household_id, trade_date in rows:
        if household_id is None or trade_date is None:
            continue
        day = trade_date.date() if hasattr(trade_date, "date") else trade_date
        if household_id not in earliest or day < earliest[household_id]:
            earliest[household_id] = day
    return sorted(earliest.items(), key=lambda pair: str(pair[0]))


def migrate_market_prices(
    db: Session,
    *,
    old_ticker: str,
    new_ticker: str,
    old_currency: Optional[str],
    new_currency: Optional[str],
    pricing_mode: Optional[str],
) -> None:
    """
    Keep the ``market_prices`` cache consistent with an asset's new identity.

    A *ticker* change invalidates a market-priced asset's cache -- those closes
    belong to the old symbol -- so the rows are dropped and the snapshot engine
    refills them from yfinance. Manually-priced assets carry their history
    across the rename instead: those rows are the user's own observations and
    there is nothing to refetch them from.

    A *currency* change never discards anything. The closes were always quoted
    in the listing's real currency; it was only the label that was wrong.
    """
    ticker_changed = old_ticker != new_ticker
    currency_changed = (old_currency or "") != (new_currency or "")
    if not ticker_changed and not currency_changed:
        return

    if ticker_changed and pricing_mode != PRICING_MODE_MANUAL:
        # The cached closes are the *old* symbol's. Drop them; the snapshot
        # engine refetches under the new one on the replay that follows.
        db.query(MarketPrice).filter(MarketPrice.ticker == old_ticker).delete(
            synchronize_session=False
        )
        return

    rows = db.query(MarketPrice).filter(MarketPrice.ticker == old_ticker).all()
    taken = (
        {d for (d,) in db.query(MarketPrice.date).filter(MarketPrice.ticker == new_ticker).all()}
        if ticker_changed
        else set()
    )
    for row in rows:
        if ticker_changed and row.date in taken:
            # A price already recorded under the new ticker wins over the old
            # one for that day; two rows would breach uq_market_price_ticker_date.
            db.delete(row)
            continue
        row.ticker = new_ticker
        if currency_changed:
            # A currency correction relabels rather than discards: the closes
            # were always quoted in the listing's real currency, only the label
            # on them was wrong. Deleting them would blank the valuations for
            # exactly as long as it takes the next fetch to refill.
            row.currency = new_currency
