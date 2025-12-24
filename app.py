# ---- stdlib ----
import json
import os
from contextlib import contextmanager

import numpy as np

# ---- third-party ----
from dotenv import load_dotenv
from flask import Flask, redirect, render_template, request, session, url_for
from flask_babel import Babel, get_locale
from flask_babel import gettext as _
from flask_wtf.csrf import CSRFError, CSRFProtect
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from werkzeug.security import check_password_hash, generate_password_hash

from constants import EFFECT_NAMES, INGREDIENT_NAMES, LANGUAGES
from db_model import User, UserSettings
from flask_session import Session
from forms import LoginForm, RegisterForm, SearchForm
from helpers import error, login_required

# ---- app / domain ----
from optimizer.cauldron_optimizer import CauldronOptimizer

load_dotenv()  ## Load environment variables from .env file(it is used only vlocally)
DATABASE_URL = os.environ["NEONDB_USER"]
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


app = Flask(__name__)
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
app.config["SECRET_KEY"] = os.environ["SECRET_KEY"]
Session(app)
csrf = CSRFProtect(app)


@contextmanager
def db_session():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def select_locale():
    # 1) Override manual: /?lang=en o /?lang=es
    lang = request.args.get("lang")
    if lang in LANGUAGES:
        session["lang"] = lang
        return lang

    # 2) Preferencia guardada en sesión
    lang = session.get("lang")
    if lang in LANGUAGES:
        return lang

    # 3) Detección automática por navegador
    browser_lang = request.accept_languages.best_match(LANGUAGES)
    if browser_lang:
        return browser_lang

    # 4) Fallback final: español
    return "es"


babel = Babel(app, locale_selector=select_locale)


@app.context_processor
def inject_i18n():
    return {
        "_": _,
        "get_locale": get_locale,
    }


def first_form_error(form) -> str:
    if "csrf_token" in form.errors:
        return _(
            "Sesión expirada o formulario inválido. Por favor recarga la página e inténtalo de nuevo."
        )

    for errors in form.errors.values():
        return errors[0]

    return _("Formulario inválido")


@app.errorhandler(CSRFError)
def handle_csrf_error(e):
    # Common if user stays too long on page, opens in new tab, etc.
    return (
        error(_("Sesión expirada. Recarga la página e inténtalo de nuevo."), url=url_for("login")),
        400,
    )


@app.route("/lang/<lang>")
def set_lang(lang):
    if lang not in LANGUAGES:
        lang = "es"
    session["lang"] = lang

    # Use 'next' parameter if provided, otherwise fallback to referrer
    next_page = request.args.get("next")
    if next_page:
        return redirect(next_page)

    referrer = request.referrer or ""
    # Avoid redirecting back to POST-only routes like /optimize after a form submit
    if "/optimize" in referrer:
        return redirect(url_for("index"))
    return redirect(referrer or url_for("index"))


@app.after_request
def after_request(response):
    """Ensure responses aren't cached"""
    if session.get("user_id"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Expires"] = 0
        response.headers["Pragma"] = "no-cache"
    return response


# constants.py
@app.route("/")
@app.route("/home")
@login_required
def index():
    """Show recipe input form"""
    user_id = session["user_id"]
    with db_session() as db_sa:
        settings = db_sa.get(UserSettings, user_id)
        if settings is None:
            return error(_("No se encontró la configuracion del ususario"), url=url_for("logout"))

        form = SearchForm()
        form.n_diploma.data = len(settings.effect_weights)
        # Set dynamic max bound for diplomas based on available effects (preserve type/min/step)
        form.n_diploma.render_kw = {
            **(form.n_diploma.render_kw or {}),
            "max": len(EFFECT_NAMES),
        }
        form.alpha_UB.data = int(settings.max_ingredients)
        form.prob_UB.data = int(settings.max_effects)
        form.n_starts.data = int(settings.search_depth)
        form.effect_weights_json.data = json.dumps(settings.effect_weights)

        return render_template(
            "index.html",
            form=form,
            effect_names=EFFECT_NAMES,
            ingredient_names=INGREDIENT_NAMES,
        )


@app.route("/login", methods=["GET", "POST"])
def login():
    """Log user in"""

    ## Preserve language selection across logout
    lang = session.get("lang")
    session.clear()
    if lang:
        session["lang"] = lang

    # Login form handling
    form = LoginForm()
    if form.validate_on_submit():
        with db_session() as db_sa:
            user = db_sa.execute(
                select(User).where(User.username == form.username.data)
            ).scalar_one_or_none()

            if user is None or not check_password_hash(user.hash, form.password.data):
                return error(_("nombre de usuario o contraseña incorrectos"), url=url_for("login"))

            session["user_id"] = user.id
            return redirect(url_for("index"))
    if form.errors:
        msg = next(iter(form.errors.values()))[0]
        return error(msg, url=url_for("login"))

    return render_template("login.html", form=form)


@app.route("/logout")
def logout():
    lang = session.get("lang")
    session.clear()
    if lang:
        session["lang"] = lang
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    """Register user"""

    form = RegisterForm()
    if form.validate_on_submit():
        try:
            with db_session() as db_sa:
                new_user = User(
                    username=form.username.data, hash=generate_password_hash(form.password.data)
                )
                db_sa.add(new_user)
                db_sa.flush()  # makes new_user.id available without committing
                db_sa.add(UserSettings(user=new_user))
                # commit handled by context manager
            return redirect(url_for("login"))
        except IntegrityError:
            return error(_("El nombre de usuario ya existe"), url=url_for("register"))
        except SQLAlchemyError:
            return error(_("Error de base de datos"), url=url_for("register"))
    if form.errors:
        return error(first_form_error(form), url=url_for("register"))

    return render_template("register.html", form=form)


@app.route("/optimize", methods=["GET", "POST"])
@login_required
def optimize():
    # Redirect GET requests to index (user should only POST here)
    if request.method == "GET":
        return redirect(url_for("index"))

    form = SearchForm()
    if not form.validate_on_submit():
        return error(first_form_error(form), url=url_for("index"))

    try:
        # Parse validated form inputs
        # effect weights are validated and parsed by the form validator
        effect_weights = np.array(getattr(form, "_parsed_effect_weights", []), dtype=np.float64)
        alpha_ub = int(form.alpha_UB.data)
        prob_ub = int(form.prob_UB.data)
        n_starts = int(form.n_starts.data)
        premium_ingr = request.form.getlist("premium_ingredients[]", type=int)
    except ValueError as e:
        return error(str(e), url=url_for("index"))

    user_id = session["user_id"]

    try:
        with db_session() as db_sa:
            settings = db_sa.get(UserSettings, user_id)
            if settings is None:
                return error(
                    _("No se encontró la configuracion del ususario"), url=url_for("index")
                )

            settings.effect_weights = effect_weights.tolist()
            settings.max_ingredients = alpha_ub
            settings.max_effects = prob_ub
            settings.search_depth = n_starts
            settings.updated_at = func.now()
    except SQLAlchemyError:
        return error(_("Error de base de datos"), url=url_for("index"))

    # Run optimizer using the persisted settings
    opt = CauldronOptimizer(
        effect_weights=effect_weights,
        premium_ingr=premium_ingr,
        alpha_UB=alpha_ub,
        prob_UB=prob_ub,
    )

    alpha_best, val_best = opt.multistart(n_starts)
    alpha_matrix = alpha_best.reshape(3, 4).astype(int).tolist()
    score = float(val_best)
    out_effects = opt.effect_probabilities(alpha_best)
    order = np.argsort(out_effects)[::-1]

    # Filter non-zero effects for cleaner template
    filtered_effects = []
    for i in order:
        val = out_effects[i]
        if val > 0:
            filtered_effects.append(
                {
                    "value": val.round(2),
                    "name": EFFECT_NAMES[i],
                    "index": i,
                    "weight": effect_weights[i],
                }
            )

    # Store results in session for language switching
    session["last_results"] = {
        "alpha_matrix": alpha_matrix,
        "effects": filtered_effects,
        "score": score,
    }

    return redirect(url_for("results"))


@app.route("/results")
@login_required
def results():
    """Display optimization results"""
    last_results = session.get("last_results")
    if not last_results:
        return redirect(url_for("index"))

    return render_template(
        "results.html",
        alpha_matrix=last_results["alpha_matrix"],
        effects=last_results["effects"],
        score=last_results["score"],
    )


@app.route("/contact")
def contact():
    return render_template("contact.html")
