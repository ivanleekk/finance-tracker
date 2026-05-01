import os
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from fastapi.security.utils import get_authorization_scheme_param
from sqlalchemy.orm import Session
import uuid

from src.database import get_db
from src import models

SECRET_KEY = os.environ.get("SECRET_KEY", "your-secret-key-for-development-32")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

class OAuth2PasswordBearerWithCookie(OAuth2PasswordBearer):
    async def __call__(self, request: Request) -> str | None:
        authorization = request.headers.get("Authorization")
        if authorization:
            scheme, param = get_authorization_scheme_param(authorization)
            if scheme.lower() == "bearer":
                return param

        cookie_token = request.cookies.get("access_token")
        if cookie_token:
            return cookie_token

        if self.auto_error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
                headers={"WWW-Authenticate": "Bearer"},
            )
        else:
            return None

oauth2_scheme = OAuth2PasswordBearerWithCookie(tokenUrl="auth/token")

def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    if salt is None:
        salt = os.urandom(16)
    key = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return salt.hex(), key.hex()

def verify_password(plain_password: str, stored_salt_hex: str, stored_hash_hex: str) -> bool:
    salt_bytes = bytes.fromhex(stored_salt_hex)
    _, computed_hash_hex = hash_password(plain_password, salt=salt_bytes)
    return secrets.compare_digest(computed_hash_hex, stored_hash_hex)

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id_str: str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
    except jwt.InvalidTokenError:
        raise credentials_exception
        
    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise credentials_exception
        
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise credentials_exception
    return user

def verify_household_access(
    household_id: uuid.UUID,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
    required_roles: list[models.HouseholdRoleType] | None = None
) -> models.HouseholdMember:
    """Verifies if the current user has access to the specified household."""
    print(current_user)
    owner = db.query(models.Household).filter(
        models.Household.id == household_id,
        models.Household.owner_id == current_user.id
    ).first()
    if owner:
        return owner
    member = db.query(models.HouseholdMember).filter(
        models.HouseholdMember.user_id == current_user.id,
        models.HouseholdMember.household_id == household_id
    ).first()
    
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Not authorized to access this household"
        )
        
    if required_roles and member.role not in required_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Insufficient permissions for this household"
        )
        
    return member
