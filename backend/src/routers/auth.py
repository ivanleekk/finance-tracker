from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
import os
import uuid

from src.database import get_db
from src import models, schemas
from src.auth import (
    verify_password,
    create_access_token,
    create_refresh_token,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_EXPIRE_DAYS,
    get_current_user,
    SECRET_KEY,
    ALGORITHM,
)
from src.routers.users import resolve_pending_invites
import jwt

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/token", status_code=status.HTTP_200_OK)
def login_for_access_token(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    # OAuth2PasswordRequestForm expects 'username', we use it as 'email'
    print(f"Login attempt for email: {form_data.username}")
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user or not verify_password(
        form_data.password, user.salt, user.salted_hashed_password
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    resolve_pending_invites(db, user)
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(user.id)}, expires_delta=access_token_expires
    )
    
    refresh_token_expires = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    refresh_token = create_refresh_token(
        data={"sub": str(user.id)}, expires_delta=refresh_token_expires
    )

    # Set the cookies in the response
    cookie_domain = os.getenv("AUTH_COOKIE_DOMAIN", None)
    is_prod = os.getenv("NODE_ENV") == "production"
    
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        samesite="lax",
        secure=is_prod,
        domain=cookie_domain,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=is_prod,
        domain=cookie_domain,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
    )

    return {
        "access_token": access_token, 
        "refresh_token": refresh_token,
        "token_type": "bearer"
    }


@router.post("/refresh", status_code=status.HTTP_200_OK)
def refresh_token(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    # Web uses the httponly cookie; mobile (no cookie jar) sends the refresh token as a bearer header.
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            refresh_token = auth_header[7:]
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing",
        )

    try:
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id_str: str = payload.get("sub")
        token_type: str = payload.get("type")
        
        if user_id_str is None or token_type != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token",
            )
            
        user_id = uuid.UUID(user_id_str)
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )
            
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    # Issue new tokens (Token Rotation)
    access_token = create_access_token(data={"sub": str(user.id)})
    new_refresh_token = create_refresh_token(data={"sub": str(user.id)})

    cookie_domain = os.getenv("AUTH_COOKIE_DOMAIN", None)
    is_prod = os.getenv("NODE_ENV") == "production"

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        samesite="lax",
        secure=is_prod,
        domain=cookie_domain,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    
    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        samesite="lax",
        secure=is_prod,
        domain=cookie_domain,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
    )

    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/logout", status_code=status.HTTP_200_OK)
def logout(response: Response):
    cookie_domain = os.getenv("AUTH_COOKIE_DOMAIN", None)
    response.delete_cookie(
        "access_token",
        domain=cookie_domain,
        httponly=True,
        samesite="lax",
        secure=os.getenv("NODE_ENV") == "production"
    )
    response.delete_cookie(
        "refresh_token",
        domain=cookie_domain,
        httponly=True,
        samesite="lax",
        secure=os.getenv("NODE_ENV") == "production"
    )
    return {"message": "Logout successful"}


@router.get("/me", response_model=schemas.UserResponse)
def read_users_me(current_user: models.User = Depends(get_current_user)):
    return current_user
