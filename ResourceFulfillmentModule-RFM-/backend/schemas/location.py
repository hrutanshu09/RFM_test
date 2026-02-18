from pydantic import BaseModel
from typing import Optional

class LocationUpdate(BaseModel):
    city: Optional[str] = None
    country: Optional[str] = None
