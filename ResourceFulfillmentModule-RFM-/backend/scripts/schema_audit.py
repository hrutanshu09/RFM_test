"""Database schema introspection script for audit."""
import sys
sys.path.insert(0, ".")

from sqlalchemy import inspect
from database import engine

inspector = inspect(engine)

print("=== DATABASE SCHEMA AUDIT ===\n")

tables_of_interest = [
    "requisitions", "requisition_items", "requisition_status_history",
    "skills", "employees", "users", "roles", "user_roles", "audit_log"
]

for table in tables_of_interest:
    if table not in inspector.get_table_names():
        print(f"TABLE: {table} - NOT FOUND IN DATABASE\n")
        continue
        
    print(f"TABLE: {table}")
    print("  COLUMNS:")
    for col in inspector.get_columns(table):
        name = col["name"]
        col_type = str(col["type"])
        nullable = col["nullable"]
        default = col.get("default")
        print(f"    {name}: {col_type} nullable={nullable} default={default}")
    
    print("  INDEXES:")
    for idx in inspector.get_indexes(table):
        print(f"    {idx['name']}: columns={idx['column_names']} unique={idx['unique']}")
    
    print("  FOREIGN KEYS:")
    for fk in inspector.get_foreign_keys(table):
        ondelete = fk.get("options", {}).get("ondelete", "NO ACTION")
        print(f"    {fk['constrained_columns']} -> {fk['referred_table']}.{fk['referred_columns']} ondelete={ondelete}")
    
    print("  CHECK CONSTRAINTS:")
    for ck in inspector.get_check_constraints(table):
        sqltext = ck.get("sqltext", "")
        print(f"    {ck['name']}: {sqltext[:100]}...")
    
    print()
