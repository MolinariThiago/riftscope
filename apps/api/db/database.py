import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./riftscope.db")

# ---- SQLite tuning ----
# When the worker is mid-parse and the API process polls /demos/<id>/status
# (the frontend does this every couple of seconds during processing), both
# processes try to hit the same SQLite file. Default SQLite mode serializes
# all access through a single lock, so any read that lands while the worker
# is committing a multi-row write raises ``database is locked``.
#
# Fix:
#   1. Enable WAL (Write-Ahead Logging) — readers no longer block writers
#      and vice versa.
#   2. Bump the busy timeout to 30 s so the rare contention still resolves
#      itself instead of failing the task.
#   3. ``check_same_thread=False`` lets us use the engine from the Celery
#      worker thread pool.
is_sqlite = DATABASE_URL.startswith("sqlite")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30} if is_sqlite else {},
)

if is_sqlite:
    # Apply PRAGMAs on every new connection — WAL mode is persistent on the
    # DB file itself, but synchronous + busy_timeout need to be set per
    # connection. Doing it via the connect event covers both the API
    # process and the worker.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_wal(dbapi_connection, _):  # noqa: D401
        cur = dbapi_connection.cursor()
        try:
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.execute("PRAGMA busy_timeout=30000")  # 30 seconds
        finally:
            cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
