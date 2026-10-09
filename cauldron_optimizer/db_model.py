from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    ForeignKey,
    Integer,
    Text,
    func,
)
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
    servers = relationship(
        "Server",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="Server.server_number",
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
    excluded_effects: Mapped[list[int]] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    # Number of servers the user plays on, and the one currently selected
    n_servers: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    active_server: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1"
    )

    user = relationship("User", back_populates="settings")


class Server(Base):
    """One of a user's game servers, each with its own search settings.

    Keyed by (username, server_number): server 2 of "4bel" is row ("4bel", 2).
    """

    __tablename__ = "servers"

    username: Mapped[str] = mapped_column(
        Text,
        ForeignKey("users.username", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
    )
    server_number: Mapped[int] = mapped_column(Integer, primary_key=True)
    effect_weights: Mapped[list[float]] = mapped_column(
        JSONB, nullable=False, server_default="[0,0,0,0]"
    )
    excluded_effects: Mapped[list[int]] = mapped_column(
        JSONB, nullable=False, server_default="[]"
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

    user = relationship("User", back_populates="servers")
