"""Cleanup test data from the database."""
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
    # Cleanup test data in dependency order
    # Covers both concurrency tests (90000+) and chaos tests (91000+)
    conn.execute(text("DELETE FROM workflow_transition_audit WHERE entity_id >= 90000 OR performed_by >= 9000"))
    conn.execute(text("DELETE FROM requisition_items WHERE req_id >= 90000 OR item_id >= 90000"))
    conn.execute(text("DELETE FROM requisition_status_history WHERE req_id >= 90000"))
    conn.execute(text("DELETE FROM requisitions WHERE req_id >= 90000"))
    conn.execute(text("DELETE FROM employees WHERE emp_id LIKE 'TEST-EMP-%'"))
    conn.execute(text("DELETE FROM user_roles WHERE user_id >= 9000"))
    conn.execute(text("DELETE FROM users WHERE user_id >= 9000"))
    conn.commit()
    print("Test data cleaned up successfully!")
