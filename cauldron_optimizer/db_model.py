from datetime import datetime

from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    Float,
    ForeignKey,
    Integer,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from werkzeug.security import check_password_hash, generate_password_hash


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    settings: Mapped["UserSettings | None"] = relationship(
        "UserSettings",
        back_populates="user",
        uselist=False,
        cascade="all, delete",
    )
    servers: Mapped[list["Server"]] = relationship(
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
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    language: Mapped[str | None] = mapped_column(Text, nullable=True)
    excluded_effects: Mapped[list[int]] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    # Number of servers the user plays on, and the one currently selected
    n_servers: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    active_server: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1"
    )

    user: Mapped["User"] = relationship("User", back_populates="settings")


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
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )

    user: Mapped["User"] = relationship("User", back_populates="servers")


class PageView(Base):
    """One request to a page of the app (static files are not logged).

    No IP address is stored: visitors are told apart by a random id kept in
    their session cookie.
    """

    __tablename__ = "page_views"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    visitor_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    method: Mapped[str] = mapped_column(Text, nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    language: Mapped[str | None] = mapped_column(Text, nullable=True)
    device: Mapped[str | None] = mapped_column(Text, nullable=True)
    country: Mapped[str | None] = mapped_column(Text, nullable=True)
    referrer_host: Mapped[str | None] = mapped_column(Text, nullable=True)


class OptimizationRun(Base):
    """The settings and result of one optimizer run."""

    __tablename__ = "optimization_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    server_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    language: Mapped[str | None] = mapped_column(Text, nullable=True)
    n_diplomas: Mapped[int] = mapped_column(Integer, nullable=False)
    effect_weights: Mapped[list[float]] = mapped_column(JSONB, nullable=False)
    excluded_effects: Mapped[list[int]] = mapped_column(JSONB, nullable=False)
    premium_ingredients: Mapped[list[int]] = mapped_column(JSONB, nullable=False)
    max_ingredients: Mapped[int] = mapped_column(Integer, nullable=False)
    max_effects: Mapped[int] = mapped_column(Integer, nullable=False)
    search_depth: Mapped[int] = mapped_column(Integer, nullable=False)
    recipe: Mapped[list[list[int]]] = mapped_column(JSONB, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
