"""
Lightweight in-process response cache for expensive, read-heavy computations
(portfolio performance metrics, net worth projections) whose inputs rarely
change between requests.

The backend runs as a single process in both dev (`fastapi dev`) and prod
(`uvicorn` with no --workers flag), so a plain in-memory dict is safe — there
is no second worker that could see stale data the first worker doesn't know
about.

Entries expire after a short TTL regardless of invalidation, so a missed
invalidation call self-heals within seconds rather than serving stale net
worth or performance numbers indefinitely. Callers should still invalidate
explicitly on writes (see `invalidate_household`) so an edit is reflected
immediately on the next request instead of waiting out the TTL.
"""
import threading
import time
from typing import Any, Callable, Optional

_lock = threading.Lock()
_store: dict[str, tuple[float, Any]] = {}

DEFAULT_TTL_SECONDS = 20.0


def cache_get(key: str) -> Optional[Any]:
    with _lock:
        entry = _store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            del _store[key]
            return None
        return value


def cache_set(key: str, value: Any, ttl: float = DEFAULT_TTL_SECONDS) -> None:
    with _lock:
        _store[key] = (time.monotonic() + ttl, value)


def cache_get_or_compute(key: str, compute: Callable[[], Any], ttl: float = DEFAULT_TTL_SECONDS) -> Any:
    cached = cache_get(key)
    if cached is not None:
        return cached
    value = compute()
    cache_set(key, value, ttl)
    return value


def invalidate_prefix(prefix: str) -> None:
    """Drop every cached entry whose key starts with `prefix`."""
    with _lock:
        keys = [k for k in _store if k.startswith(prefix)]
        for k in keys:
            del _store[k]


def invalidate_household(household_id: Any) -> None:
    """
    Drop every cached response scoped to this household. Called at the write
    funnels that change trades, transactions, balances, or snapshots — see
    AGENTS.md's "Recurring Transactions, Budgets & Emergency Fund" section for
    why `create_transaction`, trade execute/update/delete, and
    `run_snapshot_range` are the funnels that matter.
    """
    invalidate_prefix(f"household:{household_id}:")
