"""
Role-based access control dependencies.
Three roles: admin > analyst > viewer
"""
from fastapi import Depends, HTTPException
from app.auth import get_current_user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Only admins may call this endpoint."""
    if user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail=f"Admin role required. Your role: {user['role']}",
        )
    if not user.get("terms_accepted"):
        raise HTTPException(
            status_code=403,
            detail="You must accept the Ethical Use Terms of Service before performing this action.",
        )
    return user


def require_analyst(user: dict = Depends(get_current_user)) -> dict:
    """Admins and analysts may call this endpoint."""
    if user["role"] not in ("admin", "analyst"):
        raise HTTPException(
            status_code=403,
            detail=f"Analyst role or higher required. Your role: {user['role']}",
        )
    if not user.get("terms_accepted"):
        raise HTTPException(
            status_code=403,
            detail="You must accept the Ethical Use Terms of Service before performing this action.",
        )
    return user


def require_viewer(user: dict = Depends(get_current_user)) -> dict:
    """All authenticated users (admin, analyst, viewer) may call this endpoint."""
    return user
