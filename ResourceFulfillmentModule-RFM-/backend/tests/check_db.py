"""Check what test data exists in database."""
import os
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(Path(__file__).parent.parent / ".env")

url = (
    f"postgresql://{quote_plus(os.getenv('DB_USER'))}:"
    f"{quote_plus(os.getenv('DB_PASSWORD'))}@"
    f"{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"
)
engine = create_engine(url)

with engine.connect() as conn:
    # Check requisitions
    r = conn.execute(text("SELECT req_id FROM requisitions WHERE req_id >= 90000"))
    reqs = [row[0] for row in r]
    print(f"Requisitions >= 90000: {reqs}")
    
    # Check users
    r = conn.execute(text("SELECT user_id, username FROM users WHERE user_id >= 9000"))
    users = [(row[0], row[1]) for row in r]
    print(f"Users >= 9000: {users}")
