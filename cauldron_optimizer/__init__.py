from datetime import timedelta

from flask import Flask, request, session, url_for
from flask_babel import Babel, get_locale
from flask_babel import gettext as _
from flask_wtf.csrf import CSRFError, CSRFProtect
from sqlalchemy.exc import SQLAlchemyError

from cauldron_optimizer.config import get_secret_key, select_locale
from cauldron_optimizer.constants import (
    MAX_SERVER_NAME_LENGTH,
    SHOW_EFFECT_SELECTION_BETA_BANNER,
)
from cauldron_optimizer.helpers import avatar_url, error, is_admin

# Create Flask app
app = Flask(__name__)
app.config["SESSION_PERMANENT"] = True
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=365)
app.config["SECRET_KEY"] = get_secret_key()
# CSRF tokens last as long as the login session instead of 1 hour, so a page
# left open (e.g. during a long "complete effects" search) can still save
app.config["WTF_CSRF_TIME_LIMIT"] = None

# Initialize extensions
csrf = CSRFProtect(app)
babel = Babel(app, locale_selector=select_locale)


@app.context_processor
def inject_i18n():
    """Make translation functions available in templates."""
    return {
        "_": _,
        "get_locale": get_locale,
        "show_beta_banner": SHOW_EFFECT_SELECTION_BETA_BANNER,
        "is_admin": is_admin,
        "avatar_url": avatar_url,
        "max_server_name": MAX_SERVER_NAME_LENGTH,
        "user_avatar_url": lambda: avatar_url(session.get("avatar")),
    }


@app.errorhandler(CSRFError)
def handle_csrf_error(e: CSRFError):
    """Handle CSRF token errors gracefully."""
    message = _("Sesión expirada. Recarga la página e inténtalo de nuevo.")
    # Requests made with fetch (saving) expect JSON, not an error page
    if request.accept_mimetypes.best == "application/json":
        return {"ok": False, "error": message}, 400
    return (
        error(message, url=url_for("login")),
        400,
    )


@app.errorhandler(SQLAlchemyError)
def handle_sqlalchemy_error(e: SQLAlchemyError):
    """Centralized handler for SQLAlchemy errors.
    Rolls back in `db_session` and shows a friendly message here.
    """
    target = request.referrer or url_for("index")
    return (error(_("Error de base de datos"), url=target), 500)


# Import routes after app and extensions are initialized
from cauldron_optimizer import analytics as analytics  # noqa: E402
from cauldron_optimizer import routes as routes  # noqa: E402
