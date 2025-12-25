# ---- stdlib ----

# ---- third-party ----
from flask import Flask, request, url_for
from flask_babel import Babel, get_locale
from flask_babel import gettext as _
from flask_wtf.csrf import CSRFError, CSRFProtect
from sqlalchemy.exc import SQLAlchemyError

# ---- app / domain ----
from cauldron_optimizer.config import get_secret_key, select_locale
from cauldron_optimizer.helpers import error
from flask_session import Session

# Create Flask app
app = Flask(__name__)
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
app.config["SECRET_KEY"] = get_secret_key()

# Initialize extensions
Session(app)
csrf = CSRFProtect(app)
babel = Babel(app, locale_selector=select_locale)


@app.context_processor
def inject_i18n():
    """Make translation functions available in templates."""
    return {
        "_": _,
        "get_locale": get_locale,
    }


@app.errorhandler(CSRFError)
def handle_csrf_error(e):
    """Handle CSRF token errors gracefully."""
    return (
        error(_("Sesión expirada. Recarga la página e inténtalo de nuevo."), url=url_for("login")),
        400,
    )


@app.errorhandler(SQLAlchemyError)
def handle_sqlalchemy_error(e):
    """Centralized handler for SQLAlchemy errors.
    Rolls back in `db_session` and shows a friendly message here.
    """
    target = request.referrer or url_for("index")
    return (error(_("Error de base de datos"), url=target), 500)


# Import routes after app and extensions are initialized
from cauldron_optimizer import routes  # noqa: E402, F401
