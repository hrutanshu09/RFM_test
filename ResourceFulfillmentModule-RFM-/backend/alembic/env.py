from __future__ import with_statement

import sys
from pathlib import Path
from logging.config import fileConfig
import os

from sqlalchemy import engine_from_config, pool, create_engine
from alembic import context
from dotenv import load_dotenv

# Path setup so Alembic can see backend modules

BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(BASE_DIR))

# Load environment variables

load_dotenv(BASE_DIR / ".env")

# Alembic Config

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import SQLAlchemy Base metadata

from db.base import Base  # noqa: E402

import db.models  # noqa: F401


target_metadata = Base.metadata

# Database URL (single source of truth)

from urllib.parse import quote_plus

DB_USER = quote_plus(os.getenv("DB_USER"))
DB_PASSWORD = quote_plus(os.getenv("DB_PASSWORD"))

DATABASE_URL = (
    f"postgresql://{DB_USER}:{DB_PASSWORD}@"
    f"{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/"
    f"{os.getenv('DB_NAME')}"
)


# Migration runners


def run_migrations_offline() -> None:
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(
        DATABASE_URL,
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


# Entry point

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
