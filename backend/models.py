from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
import datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    full_name = Column(String)
    age = Column(Integer)
    profile_photo = Column(String) # Base64 string for simplicity
    role = Column(String, default="user") # "user" or "admin"
    status = Column(String, default="INACTIVE") # "ACTIVE" or "INACTIVE"
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    last_update = Column(DateTime, default=datetime.datetime.utcnow)

class SOSSession(Base):
    __tablename__ = "sos_sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    start_time = Column(DateTime, default=datetime.datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)

    user = relationship("User")
