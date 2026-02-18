# AI Coding Agent Instructions for RBM Resource Module

## Big picture

- Two apps: FastAPI backend in backend/ and React + Vite frontend in rbm-rfm-frontend/.
- Backend exposes REST under /api; frontend talks to it via Axios in rbm-rfm-frontend/src/api/client.ts.
- Auth uses JWT: token stored in localStorage as authToken and injected by the Axios request interceptor.

## Backend conventions (FastAPI + SQLAlchemy)

- Routers live in backend/api/\*.py and are registered in backend/main.py with prefix="/api".
- Route handlers always inject DB sessions via `db: Session = Depends(get_db)` from backend/database.py.
- SQLAlchemy models are in backend/db/models; Pydantic schemas in backend/schemas (Create/Update/Response split).
- Response schemas use `class Config: from_attributes = True` for ORM mapping.
- IMPORTANT: new models must be imported in backend/db/models/**init**.py for Alembic autogenerate.
- DB config reads backend/.env (DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME) and URL-encodes credentials with `quote_plus`.
- Enum-like fields typically use `CheckConstraint` (see employee status in models).
- Known cleanup: backend/api/requisitions.py contains duplicate imports; consolidate when editing.

## Frontend conventions (React + Vite)

- Entry points: rbm-rfm-frontend/src/main.tsx and App.tsx; routing in rbm-rfm-frontend/src/routes.
- API calls go through the shared Axios client in rbm-rfm-frontend/src/api/client.ts (base URL via VITE_API_BASE_URL).
- Auth state is managed in contexts/ (see AuthContext pattern referenced in TECH_STACK_AND_ARCHITECTURE.md).
- Styles are plain CSS under rbm-rfm-frontend/src/styles/.

## Workflows & scripts (from repo config)

- Root package.json provides npm run dev/build to run frontend commands in rbm-rfm-frontend/.
- Database migrations live in backend/alembic; use Alembic from backend/ (revision/upgrade head).
- FastAPI CORS is configured in backend/main.py for localhost:5173/3000.

## Cross-component integration points

- Auth endpoints in backend/api/auth.py with JWT utilities in backend/utils/jwt.py and password hashing in backend/utils/security.py.
- Requisition workflow splits header/items across backend/api/requisitions.py and requisition_items.py.
- Audit trail is tracked in backend/api/audit_log.py and requisition_status_history.py.
