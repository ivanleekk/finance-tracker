import os
from sqlalchemy import create_engine, MetaData
from sqlalchemy.orm import declarative_base, sessionmaker

from dotenv import load_dotenv
# Explicitly load from the backend root
env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
load_dotenv(dotenv_path=env_path)

DATABASE_URL = os.getenv("DATABASE_URL")

# Handle the case where the URL starts with 'postgres://' (common in cloud providers)
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if not DATABASE_URL:
    DATABASE_URL = "postgresql://{user}:{password}@{host}:{port}/{database}".format(
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "postgres"),
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=os.getenv("POSTGRES_PORT", "5432"),
        database=os.getenv("POSTGRES_DB", "postgres"),
    )

# Neon suspends its compute when the app goes quiet and drops the connections
# it was holding. The pool is never told: it keeps sockets that are already dead
# and hands one to the next request, which fails with "server closed the
# connection unexpectedly" — a 500, and the web app's error page. The refresh a
# second later works only because that failure discards the dead connection, so
# the cost of a quiet spell lands entirely on whoever arrives first.
#
# `pool_pre_ping` spends a round trip checking a pooled connection is alive
# before handing it over, and transparently reconnects when it isn't: the
# request that used to fail now just takes slightly longer. `pool_recycle`
# retires connections before a serverless provider is likely to have given up
# on them, so the ping usually has nothing to fix.
POOL_RECYCLE_SECONDS = 300


def create_app_engine(url: str):
    return create_engine(url, pool_pre_ping=True, pool_recycle=POOL_RECYCLE_SECONDS)


engine = create_app_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

metadata = MetaData(schema="finance_tracker")
Base = declarative_base(metadata=metadata)


# Dependency to inject the database session into your routes
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
