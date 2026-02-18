# Authentication & Authorization Setup Guide

## Overview
The RBM Resource Fulfillment Module now includes JWT-based authentication and Role-Based Access Control (RBAC).

## Installation

### 1. Install Required Dependencies

```bash
pip install python-jose[cryptography]
```

Or add to your `requirements.txt`:
```
python-jose[cryptography]
```

### 2. Environment Variables

**IMPORTANT**: Change the JWT secret key in production!

Update `backend/utils/jwt.py`:
```python
import os
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-this-in-production")
```

Or set environment variable:
```bash
export JWT_SECRET_KEY="your-very-secure-random-secret-key-here"
```

## Usage

### 1. Login Endpoint

**POST** `/auth/login`

Request body:
```json
{
  "username": "hr_user",
  "password": "password123"
}
```

Response:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "user_id": 1,
  "username": "hr_user",
  "roles": ["HR"]
}
```

### 2. Using Protected Endpoints

Include the token in the `Authorization` header:
```
Authorization: Bearer <access_token>
```

Example with curl:
```bash
curl -H "Authorization: Bearer <your_token>" http://localhost:8000/hr/employees
```

### 3. Protected Routes

#### HR Routes (Require HR or Admin role)
- `GET /hr/employees` - List all employee profiles
- `GET /hr/employees/{emp_id}` - Get employee profile

#### Finance Routes (Require HR or Admin role)
- `GET /employees/{emp_id}/finance` - View finance details
- `POST /employees/{emp_id}/finance` - Create/update finance

### 4. Role-Based Access Control

#### Available Dependencies

1. **`get_current_user`** - Get authenticated user (any logged-in user)
   ```python
   from utils.dependencies import get_current_user
   from db.models.auth import User
   
   @router.get("/protected")
   def protected_route(current_user: User = Depends(get_current_user)):
       return {"user_id": current_user.user_id}
   ```

2. **`require_role("HR")`** - Require specific role
   ```python
   from utils.dependencies import require_role
   
   @router.get("/hr-only")
   def hr_route(user: User = Depends(require_role("HR"))):
       return {"message": "HR access"}
   ```

3. **`require_any_role("HR", "Admin")`** - Require any of the specified roles
   ```python
   from utils.dependencies import require_any_role
   
   @router.get("/hr-or-admin")
   def hr_or_admin_route(user: User = Depends(require_any_role("HR", "Admin"))):
       return {"message": "Access granted"}
   ```

## Token Expiration

Default token expiration: **30 days** (configurable in `backend/utils/jwt.py`)

To change:
```python
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # 1 hour
```

## Security Notes

1. **Never commit secrets to version control**
2. **Use strong, random secret keys in production**
3. **Use HTTPS in production**
4. **Consider refresh tokens for better security**
5. **Implement rate limiting on login endpoint**

## Testing Authentication

### 1. Create a test user
```bash
POST /users/
{
  "username": "test_hr",
  "password": "test123"
}
```

### 2. Assign HR role
```bash
POST /users/{user_id}/roles
{
  "role_name": "HR"
}
```

### 3. Login
```bash
POST /auth/login
{
  "username": "test_hr",
  "password": "test123"
}
```

### 4. Use token in requests
```bash
GET /hr/employees
Headers: Authorization: Bearer <token_from_step_3>
```

## Next Steps

Consider adding:
- Refresh token endpoint
- Password reset functionality
- Account lockout after failed attempts
- Token blacklisting for logout
- Role-based route protection for more endpoints
