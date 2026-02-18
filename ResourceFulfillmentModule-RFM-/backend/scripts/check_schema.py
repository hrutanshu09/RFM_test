"""Check actual database schema for requisition_items table."""
import sys
sys.path.insert(0, '.')

from sqlalchemy import text
from database import SessionLocal

db = SessionLocal()
try:
    result = db.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'requisitions' ORDER BY ordinal_position"
    ))
    print("Columns in requisitions:")
    for row in result:
        print(f"  - {row[0]}")
finally:
    db.close()
