from fastapi.params import Depends
from fastapi.security import OAuth2PasswordBearer
from fastapi import HTTPException, status

from core.config import settings

SECRET_KEY  = settings.JWT_SECRET_KEY
ALGORITHM = "HS256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def authenticate_user(email: str, password: str, db:Session = Depends(get_db)):
    user = get_user_by_email(db, email)
    if not user:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    return user