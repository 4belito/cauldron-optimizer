from functools import wraps

from flask import redirect, render_template, session


def error(text, url="/"):
    """Render message as an apology to user."""

    return render_template("error.html", text=text, url=url)


def login_required(f):
    """
    Decorate routes to require login.

    https://flask.palletsprojects.com/en/latest/patterns/viewdecorators/
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if session.get("user_id") is None:
            return redirect("/login")
        return f(*args, **kwargs)

    return decorated_function
