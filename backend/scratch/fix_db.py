import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if not DATABASE_URL:
    DATABASE_URL = "postgresql://fin:fin@localhost:5432/fin"

engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    print("Checking for created_at column in portfolio_snapshots...")
    try:
        conn.execute(text("ALTER TABLE finance_tracker.portfolio_snapshots ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT now();"))
        conn.commit()
        print("Successfully added created_at column.")
    except Exception as e:
        print(f"Error or column already exists: {e}")
