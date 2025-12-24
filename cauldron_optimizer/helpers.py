from functools import wraps

from flask import redirect, render_template, session
from flask_babel import gettext as _


def error(text, url="/"):
    """Render message as an apology to user."""

    return render_template("error.html", text=text, url=url)


def login_required(f):
    """
    Decorate routes to require login.
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if session.get("user_id") is None:
            return redirect("/login")
        return f(*args, **kwargs)

    return decorated_function


def first_form_error(form) -> str:
    """Return the first validation error message, with CSRF handled first."""
    if "csrf_token" in form.errors:
        return _(
            "Sesión expirada o formulario inválido. Por favor recarga la página e inténtalo de nuevo."
        )

    for errors in form.errors.values():
        return errors[0]

    return _("Formulario inválido")
