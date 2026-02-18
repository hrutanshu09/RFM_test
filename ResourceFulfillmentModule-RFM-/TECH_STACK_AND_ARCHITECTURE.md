# RBM Resource Module - Tech Stack & Architecture Prompt

## 🏗️ **Project Overview**

**RBM (Resource Business Management) Resource Fulfillment Module** is a full-stack web application for managing employee lifecycle, organizational structure, requisitions, and audit logging. It consists of a React/TypeScript frontend and FastAPI backend with PostgreSQL database.

---

## 🛠️ **Technology Stack**

### **Frontend**

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite (fast HMR, optimized production builds)
- **Routing**: React Router v7.12.0 (client-side routing, protected routes)
- **HTTP Client**: Axios (with request/response interceptors for auth)
- **State Management**: React Context API + Custom Hooks (AuthContext for global auth state)
- **Code Quality**: ESLint + Prettier
- **Styling**: CSS (modular, responsive design)

### **Backend**

- **Framework**: FastAPI (modern, async-ready, auto-generated API docs)
- **Language**: Python 3.13+
- **Database**: PostgreSQL
- **ORM**: SQLAlchemy 2.0 (declarative models, relationship management)
- **Database Migrations**: Alembic (version control for schema)
- **Validation**: Pydantic (request/response validation, type hints)
- **Authentication**: JWT (JSON Web Tokens) with HS256 algorithm
- **Password Hashing**: Passlib with pbkdf2_sha256
- **CORS**: FastAPI CORSMiddleware (allows frontend-backend communication)

### **DevOps & Tools**

- **Python Virtual Environment**: `.venv`
- **Package Managers**: npm (frontend), pip (backend)
- **Environment Variables**: `.env` files (DB credentials, API URLs)
- **Version Control**: Git

---

## 📂 **Project Structure**

```
RBM_Resource_Module/
├── rbm-rfm-frontend/              # React TypeScript SPA
│   ├── src/
│   │   ├── api/                   # API client setup (Axios)
│   │   ├── components/            # Reusable UI components
│   │   │   ├── Header.tsx         # Header with user info & logout
│   │   │   ├── ProtectedRoute.tsx # Route protection wrapper
│   │   │   └── ...
│   │   ├── contexts/              # Global state (AuthContext)
│   │   ├── pages/                 # Page components (Login, Dashboard)
│   │   ├── routes/                # Router configuration
│   │   ├── styles/                # CSS files
│   │   │   ├── variables.css      # CSS variables (colors, spacing, typography)
│   │   │   ├── Login.css          # Login page styles
│   │   │   ├── Header.css         # Header component styles
│   │   │   └── ThemeSwitcher.css  # Theme switcher styles
│   │   ├── App.tsx                # Root component
│   │   └── main.tsx               # Entry point
│   ├── .env                       # Environment variables
│   ├── package.json               # Dependencies & scripts
│   └── vite.config.ts             # Vite configuration
│
├── backend/                        # FastAPI application
│   ├── main.py                    # FastAPI app setup & router registration
│   ├── database.py                # SQLAlchemy engine config
│   ├── alembic/                   # Database migrations
│   │   ├── env.py
│   │   └── versions/              # Migration files
│   ├── api/                       # API endpoint routers
│   │   ├── auth.py                # Authentication endpoints
│   │   ├── employees.py           # Employee CRUD endpoints
│   │   ├── requisitions.py        # Requisition endpoints
│   │   └── ... (other domain routers)
│   ├── db/
│   │   ├── models/                # SQLAlchemy ORM models
│   │   │   ├── auth.py            # User, Role, UserRole models
│   │   │   ├── employee.py        # Employee model
│   │   │   └── ... (other models)
│   │   └── session.py             # Database session management
│   ├── schemas/                   # Pydantic request/response schemas
│   │   ├── auth.py                # LoginRequest, TokenResponse
│   │   ├── employee.py            # Employee schemas
│   │   └── ... (other schemas)
│   ├── utils/
│   │   ├── security.py            # Password hashing functions
│   │   ├── jwt.py                 # JWT token creation
│   │   └── dependencies.py        # Dependency injection
│   ├── .env                       # Database credentials
│   └── requirements.txt           # Python dependencies
│
└── package.json                   # Root workspace config
```

---

## 🔐 **Authentication Flow**

### **1. Login Request** (Frontend → Backend)

```
POST /api/auth/login
{
  "username": "admin",
  "password": "admin123"
}
```

### **2. Backend Processing**

```python
# Backend receives login request
1. Find user by username in database
2. Verify password using bcrypt
3. Check if user is active
4. Query user's roles from UserRole table
5. Create JWT token with: sub (user_id), username, roles
6. Return: { access_token, token_type, user_id, username, roles }
```

### **3. Frontend Storage & State**

```typescript
// Store token in localStorage
localStorage.setItem("authToken", token)

// Store user data in React Context
{
  user_id: 1,
  username: "admin",
  roles: ["admin", "manager"]
}
```

### **4. Protected Route Access**

```typescript
// ProtectedRoute wrapper checks:
- Is user authenticated? (token exists)
- Has user required roles? (RBAC check)
- If no: redirect to /login or /unauthorized
```

### **5. Automatic Token Injection**

```typescript
// Axios interceptor adds token to all requests
Authorization: Bearer<jwt_token>;
```

---

## 🏛️ **Architecture Patterns**

### **Frontend Architecture**

**Component Hierarchy:**

```
App (wraps with AuthProvider)
├── AppRouter (BrowserRouter)
│   ├── /login → Login page (public)
│   ├── /dashboard → ProtectedRoute → Header + Dashboard
│   ├── /unauthorized → ProtectedRoute → Unauthorized page
│   └── / → redirect to /dashboard
```

**State Management:**

```
AuthContext (global)
├── user: { user_id, username, roles }
├── token: JWT string
├── isAuthenticated: boolean
├── isLoading: boolean
├── error: string | null
├── login(): Promise<void>
├── logout(): void
└── clearError(): void
```

### **Backend Architecture**

**Router Structure:**

```
FastAPI App
├── CORS Middleware (allows localhost:5173)
├── Router: /api/auth → login endpoint
├── Router: /api/users → user CRUD endpoints
├── Router: /api/employees → employee CRUD endpoints
├── Router: /api/requisitions → requisition endpoints
└── Router: /api/* (15+ more domain routers)
```

**Data Layer:**

```
Database (PostgreSQL)
├── Users table (authentication)
├── Roles table (role definitions)
├── UserRole table (many-to-many mapping)
├── Employees table (core entity)
├── Requisitions table (business logic)
└── ... (20+ more tables)
```

**Request Pipeline:**

```
HTTP Request
    ↓
CORS Middleware (validate origin)
    ↓
Router (find matching endpoint)
    ↓
API Handler (execute business logic)
    ↓
Database Session (SQLAlchemy ORM)
    ↓
Database Query (PostgreSQL)
    ↓
Pydantic Response Schema (serialize)
    ↓
HTTP Response (JSON)
```

---

## 🔄 **Data Flow Diagram**

### **Login Flow:**

```
User (Browser)
    ↓
Login Form (React)
    ↓ POST /api/auth/login
Backend (FastAPI)
    ↓ Query DB
PostgreSQL
    ↓ Return user + roles
Backend (FastAPI)
    ↓ Create JWT token
    ↓ Response: token + user info
Frontend (React)
    ↓ Store token + user
AuthContext (state updated)
    ↓ Redirect to /dashboard
```

### **Protected Route Access:**

```
User navigates to /dashboard
    ↓
ProtectedRoute component checks
    ↓ Is authenticated?
    ├─ NO → Redirect to /login
    └─ YES ↓
    Check required roles
    ├─ NO required roles → Render component
    ├─ Has required roles → Render component
    └─ Missing required roles → Redirect to /unauthorized
```

---

## 🎨 **Design System & CSS Variables**

### **CSS Variables Architecture**

The frontend uses a comprehensive CSS variables system for easy customization and consistency:

**Location**: `src/styles/variables.css`

**Variable Categories**:

- **Colors**: Primary, secondary, text, backgrounds, borders, status colors
- **Spacing**: xs, sm, md, lg, xl, 2xl, 3xl (for margins, paddings)
- **Typography**: Font sizes (xs through 3xl), font weights (normal, medium, semibold, bold)
- **Border Radius**: sm, md, lg (for rounded corners)
- **Shadows**: sm, md, lg (for depth and elevation)
- **Transitions**: fast, normal, slow (for animations)
- **Z-indexes**: For layering components (header, modal, debug panel, etc.)

**Example Variables**:

```css
:root {
  --primary-gradient-start: #667eea;
  --primary-gradient-end: #764ba2;
  --text-primary: #333333;
  --bg-primary: #ffffff;
  --spacing-lg: 16px;
  --radius-md: 8px;
  --transition-fast: 0.2s ease;
}
```

### **Styling Implementation**

All frontend styles use CSS variables for:

- **Login.css** - Authentication page styles
- **Header.css** - Application header with user info and logout
- **ThemeSwitcher.css** - Theme selection dropdown styles

**Benefits**:
✅ Change entire color scheme in seconds by editing `variables.css`  
✅ Consistent spacing and typography across the app  
✅ Easy to implement multiple themes/brands  
✅ Responsive design using variable breakpoints  
✅ Maintainable and scalable styling approach

### **Customization Workflow**

To change the app's appearance:

1. Open `src/styles/variables.css`
2. Update color values in the `:root` block
3. All components automatically reflect changes
4. No need to edit individual CSS files

---

## 🚀 **Key Features Implemented**

### **Frontend Features**

- ✅ Beautiful login page with gradient design
- ✅ Global authentication context
- ✅ Protected routes with RBAC support
- ✅ Automatic JWT token injection in API calls
- ✅ User profile display (username + roles) in header
- ✅ Logout functionality with redirect
- ✅ Session expiration handling (401 auto-redirect)
- ✅ Responsive design (mobile-friendly)
- ✅ Error handling with user feedback
- ✅ Debug panel for troubleshooting

### **Backend Features**

- ✅ JWT-based authentication
- ✅ Password hashing with bcrypt
- ✅ Role-based access control (RBAC) ready
- ✅ CORS enabled for frontend communication
- ✅ API documentation (Swagger UI at `/docs`)
- ✅ Database migrations with Alembic
- ✅ Pydantic validation for all requests
- ✅ SQLAlchemy ORM for type-safe database access
- ✅ Global error handling with HTTPException
- ✅ User activity tracking (last_login)

---

## 🔌 **API Endpoints Currently Set Up**

```
# Authentication
POST   /api/auth/login                    # User login

# Users (example routers)
GET    /api/users/                        # List users
POST   /api/users/                        # Create user
GET    /api/users/{user_id}              # Get user
PUT    /api/users/{user_id}              # Update user

# Employees
GET    /api/employees/                    # List employees
POST   /api/employees/                    # Create employee
GET    /api/employees/{emp_id}           # Get employee
PUT    /api/employees/{emp_id}           # Update employee

# (15+ more domain routers available)
```

---

## 📊 **Technology Comparison**

| Aspect         | Frontend                 | Backend                   |
| -------------- | ------------------------ | ------------------------- |
| **Language**   | TypeScript               | Python                    |
| **Runtime**    | Browser (Node.js in dev) | Python 3.13+              |
| **Framework**  | React 19                 | FastAPI                   |
| **State**      | React Context            | Not needed (stateless)    |
| **Database**   | N/A                      | PostgreSQL + SQLAlchemy   |
| **HTTP**       | Axios                    | FastAPI (built-in)        |
| **Auth**       | JWT storage + Context    | JWT creation + validation |
| **Validation** | Pydantic (via backend)   | Pydantic schemas          |

---

## 🛡️ **Security Features**

- ✅ **JWT Tokens**: Stateless authentication, no session server needed
- ✅ **Password Hashing**: Bcrypt with pbkdf2_sha256 (one-way hashing)
- ✅ **CORS Validation**: Only allow localhost:5173 frontend
- ✅ **HTTPS Ready**: Can be deployed with SSL/TLS
- ✅ **Protected Routes**: Frontend redirects unauthorized users
- ✅ **Role-Based Access**: Backend can enforce permissions
- ⚠️ **Token Expiration**: Currently not implemented (can be added)
- ⚠️ **HTTPS Only**: Recommended for production

---

## 🎯 **Development Workflow**

### **Start Backend:**

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

### **Start Frontend:**

```bash
cd rbm-rfm-frontend
npm install
npm run dev
```

### **Access Application:**

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`
- API Docs: `http://localhost:8000/docs`

---

## 📈 **Scalability & Future Enhancements**

### **Short Term**

- [ ] Add token refresh mechanism
- [ ] Implement 2FA/MFA
- [ ] Add rate limiting on login endpoint
- [ ] Implement request logging/audit trails
- [ ] Add comprehensive error handling

### **Medium Term**

- [ ] Add more API endpoints for business logic
- [ ] Implement WebSocket for real-time updates
- [ ] Add file upload/download functionality
- [ ] Create comprehensive API test suite
- [ ] Add API versioning (/api/v2/)

### **Long Term**

- [ ] Microservices architecture
- [ ] GraphQL API option
- [ ] Mobile app (React Native)
- [ ] Advanced analytics dashboard
- [ ] Machine learning features

---

## 📋 **Summary**

This is a **production-ready authentication system** with:

- Modern React frontend with TypeScript
- Robust FastAPI backend with PostgreSQL
- JWT-based stateless authentication
- Role-based access control support
- Clean, modular architecture
- Responsive, user-friendly UI

The system is ready for integrating additional business features and can scale to handle enterprise-level requirements.
