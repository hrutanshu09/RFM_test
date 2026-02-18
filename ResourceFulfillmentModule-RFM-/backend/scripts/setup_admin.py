"""
Setup script to create an admin user with all roles.
Run from backend directory: python scripts/setup_admin.py
"""

from sqlalchemy.orm import Session
from db.session import SessionLocal
from db.models.auth import User, Role, UserRole
from utils.security import hash_password

def setup_admin_user():
    """Create admin user with all roles"""
    db: Session = SessionLocal()
    
    try:
        # Step 1: Create roles if they don't exist
        roles_to_create = ["Admin", "HR", "Manager", "Employee"]
        
        print("📋 Creating roles...")
        for role_name in roles_to_create:
            existing_role = db.query(Role).filter(Role.role_name == role_name).first()
            if not existing_role:
                role = Role(role_name=role_name)
                db.add(role)
                print(f"   ✅ Created role: {role_name}")
            else:
                print(f"   ⏭️  Role already exists: {role_name}")
        
        db.commit()
        
        # Step 2: Create admin user
        print("\n👤 Creating admin user...")
        username = "admin"
        password = "admin123"
        
        # Check if user already exists
        existing_user = db.query(User).filter(User.username == username).first()
        if existing_user:
            print(f"   ⚠️  User '{username}' already exists!")
            admin_user = existing_user
        else:
            hashed_password = hash_password(password)
            admin_user = User(
                username=username,
                password_hash=hashed_password,
                is_active=True
            )
            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
            print(f"   ✅ Created user: {username}")
        
        # Step 3: Assign all roles to admin user
        print("\n🔑 Assigning roles to admin user...")
        roles = db.query(Role).all()
        
        for role in roles:
            # Check if role is already assigned
            existing_assignment = db.query(UserRole).filter(
                UserRole.user_id == admin_user.user_id,
                UserRole.role_id == role.role_id
            ).first()
            
            if not existing_assignment:
                user_role = UserRole(
                    user_id=admin_user.user_id,
                    role_id=role.role_id
                )
                db.add(user_role)
                print(f"   ✅ Assigned role: {role.role_name}")
            else:
                print(f"   ⏭️  Role already assigned: {role.role_name}")
        
        db.commit()
        
        print("\n" + "="*50)
        print("✨ ADMIN USER SETUP COMPLETE!")
        print("="*50)
        print(f"\n📝 Credentials:")
        print(f"   Username: {username}")
        print(f"   Password: {password}")
        print(f"\n🔓 Login at: POST /auth/login")
        print(f"   Body: {{'username': '{username}', 'password': '{password}'}}")
        print(f"\n✅ Roles assigned: {', '.join([r.role_name for r in roles])}")
        print("="*50)
        
    except Exception as e:
        print(f"❌ Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    setup_admin_user()
