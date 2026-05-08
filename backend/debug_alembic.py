import alembic
print(f"Alembic file: {alembic.__file__}")
try:
    from alembic import command
    print("Successfully imported alembic.command")
except ImportError as e:
    print(f"Failed to import alembic.command: {e}")
