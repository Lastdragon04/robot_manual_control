from sqlalchemy import Column, Integer, String,REAL
from .database import Base

class MotorConfig(Base):
    __tablename__ = "control_config"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    name_index = Column(String, unique=True, index=True)
    can_rx_id = Column(String)
    current_position = Column(REAL)
    offset = Column(REAL)
    max_position = Column(REAL)
    min_position = Column(REAL)