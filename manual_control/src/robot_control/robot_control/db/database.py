# database.py
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

import time
import threading

# 定义全局可配置对象
_engine = None
_SessionLocal = None
Base = declarative_base()

def configure_db(db_path: str):
    """在main.py中调用此函数初始化数据库"""
    global _engine, _SessionLocal
    SQLALCHEMY_DATABASE_URL = f"sqlite:///{db_path}"
    
    _engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False}
    )
    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    # 创建所有关联的表（如果不存在）
    Base.metadata.create_all(bind=_engine)

def get_db_session():
    if _SessionLocal is None:
        raise RuntimeError("Database not configured! Call configure_db() first.")
    return _SessionLocal()