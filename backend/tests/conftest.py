import os
import time
from pathlib import Path

import pytest
import sys

# Prevent the local 'alembic' directory from shadowing the alembic library
cwd = os.getcwd()
if cwd in sys.path:
    sys.path.remove(cwd)
elif "" in sys.path:
    sys.path.remove("")

from alembic import command
from alembic.config import Config

# Restore path for other imports
sys.path.insert(0, cwd)
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from src.main import app
from src.database import get_db

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql://fin:fin@127.0.0.1:5432/fin_test"
)
TEST_ADMIN_DATABASE = os.getenv("TEST_ADMIN_DATABASE", "fin")
SCHEMA_NAME = "finance_tracker"
BACKEND_DIR = Path(__file__).resolve().parents[1]

engine = create_engine(TEST_DATABASE_URL)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _admin_database_url() -> str:
    return make_url(TEST_DATABASE_URL).set(database=TEST_ADMIN_DATABASE).render_as_string(
        hide_password=False
    )


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _wait_for_database(admin_engine):
    deadline = time.monotonic() + 30
    while True:
        try:
            with admin_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return
        except OperationalError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.5)


def _ensure_test_database_exists():
    test_database = make_url(TEST_DATABASE_URL).database
    admin_engine = create_engine(_admin_database_url(), isolation_level="AUTOCOMMIT")
    try:
        _wait_for_database(admin_engine)
        with admin_engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :database_name"),
                {"database_name": test_database},
            ).scalar()
            if not exists:
                conn.execute(text(f"CREATE DATABASE {_quote_identifier(test_database)}"))
    finally:
        admin_engine.dispose()


def _run_migrations():
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    alembic_cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    command.upgrade(alembic_cfg, "head")


@pytest.fixture(scope="session")
def db_engine():
    _ensure_test_database_exists()
    with engine.begin() as conn:
        conn.execute(text(f"DROP SCHEMA IF EXISTS {SCHEMA_NAME} CASCADE"))
        conn.execute(text(f"CREATE SCHEMA {SCHEMA_NAME}"))
    _run_migrations()
    yield engine
    engine.dispose()


@pytest.fixture(scope="function")
def db_session(db_engine):
    connection = db_engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)

    try:
        yield session
    finally:
        session.close()
        if transaction.is_active:
            transaction.rollback()
        connection.close()

@pytest.fixture(scope="function")
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
