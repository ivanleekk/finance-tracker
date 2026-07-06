import os
from sqlalchemy import create_engine, inspect

DATABASE_URL = "postgresql://fin:fin@localhost:5432/fin"
engine = create_engine(DATABASE_URL)
inspector = inspect(engine)

columns = inspector.get_columns('trades', schema='finance_tracker')
for column in columns:
    print(f"Column: {column['name']}, Type: {column['type']}")
