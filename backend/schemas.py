from pydantic import BaseModel
from typing import Optional
import datetime

class UserBase(BaseModel):
    username: str
    full_name: str
    age: int
    profile_photo: Optional[str] = None
    role: str = "user"

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class UserOut(UserBase):
    id: int
    status: str
    lat: Optional[float] = None
    lng: Optional[float] = None

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class LocationUpdate(BaseModel):
    lat: float
    lng: float
