"""
Surviving a database that went away while we weren't looking.

Production runs on Neon, whose compute suspends when idle and drops the
connections it was holding. Nothing tells the pool: the sockets it has cached
are simply dead, and the next request checks one out, tries to use it, and
raises `OperationalError: server closed the connection unexpectedly` — a 500
to the client, and React Router's default error page to anyone using the web
app. The refresh a second later works, because the failure itself invalidates
the dead connection and the pool dials a fresh one. That is the whole bug: the
first person back after a quiet spell eats an error page for everyone else's
convenience.

These tests kill the server side of a pooled connection the way Neon does and
insist the next checkout still works.
"""

from sqlalchemy import text

from src.database import create_app_engine
from tests.conftest import TEST_DATABASE_URL


def _terminate_server_side(killer_engine, pid: int) -> None:
    """
    Hang up on one specific backend, the way a suspending Neon hangs up on the
    connections it was holding.

    Deliberately one pid rather than every connection to the database: the rest
    of the suite holds open connections of its own (the session-scoped engine,
    and each test's outer transaction), and killing those makes this test fail
    other people's tests several files later.
    """
    with killer_engine.connect() as conn:
        conn.execute(
            text("SELECT pg_terminate_backend(:pid)"),
            {"pid": pid},
        )
        conn.commit()


def test_a_pooled_connection_that_died_while_idle_is_replaced_not_handed_out(db_session):
    """
    The regression, at the layer where the bug lives.

    Deliberately not driven through `client`: that fixture pins one connection
    open inside a transaction for the whole test, so the app never checks out of
    the pool and the pre-ping this is about would never run. A request in
    production checks out per call, which is what this reproduces.
    """
    engine = create_app_engine(TEST_DATABASE_URL)
    killer = create_app_engine(TEST_DATABASE_URL)
    try:
        with engine.connect() as conn:
            assert conn.execute(text("SELECT 1")).scalar() == 1
            pooled_pid = conn.execute(text("SELECT pg_backend_pid()")).scalar()
        # The connection is back in the pool, and now the server hangs up on it.
        _terminate_server_side(killer, pooled_pid)

        with engine.connect() as conn:
            assert conn.execute(text("SELECT 1")).scalar() == 1
    finally:
        engine.dispose()
        killer.dispose()


def test_the_engine_retires_connections_before_the_provider_does(db_session):
    """
    Pre-ping recovers from a dead connection; recycling avoids handing one out
    in the first place. Both matter: pre-ping costs a round trip per checkout
    only when the pool is cold, recycling keeps the pool from filling with
    sockets a serverless provider has already given up on.
    """
    engine = create_app_engine(TEST_DATABASE_URL)
    try:
        assert engine.pool._pre_ping is True
        assert 0 < engine.pool._recycle <= 300
    finally:
        engine.dispose()
