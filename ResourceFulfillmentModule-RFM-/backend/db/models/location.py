from sqlalchemy import Column, Integer, String
from db.base import Base


class Location(Base):
    __tablename__ = "locations"

    location_id = Column(Integer, primary_key=True)
    city = Column(String(50), nullable=True)
    country = Column(String(50), nullable=True)
