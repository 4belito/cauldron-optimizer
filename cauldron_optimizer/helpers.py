from collections.abc import Callable
from functools import wraps
from typing import Any, cast

from flask import abort, redirect, render_template, session, url_for
from flask_babel import gettext as _
from flask_wtf import FlaskForm

from cauldron_optimizer.constants import ADMIN_USERNAMES, AVATARS

_AVATAR_SET = frozenset(AVATARS)


# this may be enhenced later using bootstrap Modal dialogs
def error(text: str, url: str = "/") -> str:
    """Render message as an apology to user."""

    return render_template("error.html", text=text, url=url)


# flask_login library may replace this in the future
def login_required(f: Callable[..., Any]) -> Callable[..., Any]:
    """
    Decorate routes to require login.
    """

    @wraps(f)
    def decorated_function(*args: Any, **kwargs: Any) -> Any:
        if session.get("user_id") is None:
            return redirect("/login")
        return f(*args, **kwargs)

    return decorated_function


def is_avatar(name: str | None) -> bool:
    return name in _AVATAR_SET


def avatar_url(name: str | None) -> str:
    """URL of an avatar portrait, or of the default avatar."""
    if is_avatar(name):
        return url_for("static", filename=f"portraits/{name}")
    return url_for("static", filename="potrait.png")


def is_admin() -> bool:
    """Whether the logged-in user may see the admin pages."""
    return session.get("username") in ADMIN_USERNAMES


def admin_required(f: Callable[..., Any]) -> Callable[..., Any]:
    """
    Decorate routes to require an admin user. Others get a 404, so the page
    looks like it does not exist.
    """

    @wraps(f)
    def decorated_function(*args: Any, **kwargs: Any) -> Any:
        if not is_admin():
            abort(404)
        return f(*args, **kwargs)

    return decorated_function


def first_form_error(form: FlaskForm) -> str:
    """Return the first validation error message, with CSRF handled first."""
    if "csrf_token" in form.errors:
        return _(
            "Sesión expirada o formulario inválido. Por favor recarga la página e inténtalo de nuevo."  # noqa: E501
        )

    for errors in form.errors.values():
        return cast(list[str], errors)[0]

    return _("Formulario inválido")
