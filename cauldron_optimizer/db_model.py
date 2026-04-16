from sqlalchemy import TIMESTAMP, BigInteger, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, declarative_base, mapped_column, relationship
from werkzeug.security import check_password_hash, generate_password_hash

Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id: Mapped[BigInteger] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[Text] = mapped_column(Text, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    settings = relationship(
        "UserSettings",
        back_populates="user",
        uselist=False,
        cascade="all, delete",
    )

    @property
    def password(self):
        return self.password

    @password.setter
    def password(self, password_plaintext: str):
        self.password_hash = generate_password_hash(password_plaintext)

    def check_password(self, attempted_password: str) -> bool:
        return check_password_hash(self.password_hash, attempted_password)


class UserSettings(Base):
    __tablename__ = "user_settings"
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    effect_weights: Mapped[list[int]] = mapped_column(
        JSONB, nullable=False, server_default="[0,0,0,0]"
    )
    max_ingredients: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="25"
    )
    max_effects: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="100"
    )
    search_depth: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="50"
    )
    updated_at: Mapped[str] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    language: Mapped[str] = mapped_column(Text, nullable=True)

    user = relationship("User", back_populates="settings")
