from dotenv import load_dotenv
import os

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

# ---- Create app ----
app = FastAPI(title="RBM Resource Fulfillment Module")


@app.get("/api/health")
def health():
    """Quick health check: returns 200 if app is up and DB is reachable, 503 if DB is down."""
    try:
        from db.engine import engine
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "database": "unreachable",
                "detail": str(e),
            },
        )


def _db_exception_handler(request, exc):
    """Return 503 with clear message when DB is unreachable."""
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database is not responding. Check that PostgreSQL is running and DB_HOST/DB_PORT in .env are correct.",
        },
    )


from sqlalchemy.exc import OperationalError, DBAPIError
app.add_exception_handler(OperationalError, _db_exception_handler)
app.add_exception_handler(DBAPIError, _db_exception_handler)

# ---- Status Protection (GC-001 Enforcement) ----
# Register SQLAlchemy event listeners to block direct status mutations
from services.requisition import register_status_protection
register_status_protection()

# ---- CORS Configuration ----
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://192.168.1.108:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Core APIs ----
from api.users import router as users_router
from api.users import admin_router as admin_users_router
from api.employees import router as employees_router
from api.org import router as org_router
from api.company_roles import router as company_roles_router

# ---- Employee-related ----
from api.employee_contacts import router as employee_contacts_router
from api.employee_finance import router as employee_finance_router
from api.employee_availability import router as employee_availability_router

# ---- Skills & Education ----
from api.skills import router as skills_router
from api.employee_skills import router as employee_skills_router
from api.employee_education import router as employee_education_router

# ---- Requisitions ----
from api.requisitions import router as requisitions_router
from api.requisition_items import router as requisition_items_router
from api.requisition_status_history import router as requisition_status_history_router

# ---- Workflow (Specification v1.0.0) ----
from api.workflow_routes import requisition_workflow_router, item_workflow_router
from api.workflow_routes import item_reassign_router, requisition_reassign_router

# ---- Workflow Audit & Observability ----
from api.workflow_audit import router as workflow_audit_router

# ---- Audit ----
from api.audit_log import router as audit_log_router

# ---- HR ----
from api.hr import router as hr_router

# ---- Dashboard ----
from api.dashboard import router as dashboard_router

# ---- Admin Overview ----
from api.admin_overview import router as admin_overview_router

# ---- Authentication ----
from api.auth import router as auth_router

# ---- Uploads ----
from api.uploads import router as uploads_router

# ---- Candidates & Interviews ----
from api.candidates import router as candidates_router
from api.interviews import router as interviews_router


# ---- Include routers (EACH EXACTLY ONCE) ----
app.include_router(users_router, prefix="/api")
app.include_router(admin_users_router, prefix="/api")
app.include_router(employees_router, prefix="/api")
app.include_router(org_router, prefix="/api")
app.include_router(company_roles_router, prefix="/api")

app.include_router(employee_contacts_router, prefix="/api")
app.include_router(employee_finance_router, prefix="/api")
app.include_router(employee_availability_router, prefix="/api")

app.include_router(skills_router, prefix="/api")
app.include_router(employee_skills_router, prefix="/api")
app.include_router(employee_education_router, prefix="/api")

app.include_router(requisitions_router, prefix="/api")
app.include_router(requisition_items_router, prefix="/api")
app.include_router(requisition_status_history_router, prefix="/api")

# ---- Workflow API (Specification v1.0.0) ----
app.include_router(requisition_workflow_router, prefix="/api")
app.include_router(item_workflow_router, prefix="/api")
app.include_router(item_reassign_router, prefix="/api")
app.include_router(requisition_reassign_router, prefix="/api")
app.include_router(workflow_audit_router, prefix="/api")

app.include_router(audit_log_router, prefix="/api")
app.include_router(hr_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(admin_overview_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(uploads_router, prefix="/api")
app.include_router(candidates_router, prefix="/api")
app.include_router(interviews_router, prefix="/api")

