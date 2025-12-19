from sqlalchemy import TIMESTAMP, BigInteger, Column, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(BigInteger, primary_key=True)
    username = Column(Text, unique=True, nullable=False)
    hash = Column(Text, nullable=False)
    settings = relationship(
        "UserSettings",
        back_populates="user",
        uselist=False,
        cascade="all, delete",
    )


class UserSettings(Base):
    __tablename__ = "user_settings"
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    effect_weights = Column(JSONB, nullable=False, server_default="[0,0,0,0,0]")
    max_ingredients = Column(Integer, nullable=False, server_default="25")
    max_effects = Column(Integer, nullable=False, server_default="100")
    search_depth = Column(Integer, nullable=False, server_default="50")
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())

    user = relationship("User", back_populates="settings")
