# ---- stdlib ----
import os

import numpy as np

# ---- third-party ----
from dotenv import load_dotenv
from flask import Flask, redirect, render_template, request, session, url_for
from flask_babel import Babel, force_locale, get_locale
from flask_babel import gettext as _
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from werkzeug.security import check_password_hash, generate_password_hash

# ---- app / domain ----
from cauldron_optimizer import CauldronOptimizer
from constants import EFFECT_NAMES, INGREDIENT_ICONS, INGREDIENT_NAMES, LANGUAGES
from db_model import User, UserSettings
from flask_session import Session
from helpers import error, login_required
from validators import (
    AuthData,
    parse_auth_form,
    parse_effect_weights,
    parse_int,
    parse_premium_ingredients,
)

load_dotenv()  ## Load environment variables from .env file(it is used only vlocally)
DATABASE_URL = os.environ["NEONDB_USER"]
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


app = Flask(__name__)
# Configure session to use filesystem (instead of signed cookies)
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
Session(app)


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
    db_sa = SessionLocal()
    try:
        settings = db_sa.get(UserSettings, user_id)
        if settings is None:
            return error(_("No se encontró la configuracion del ususario"), url=url_for("logout"))

        return render_template(
            "index.html",
            effect_weights=settings.effect_weights,
            n_diplomas=len(settings.effect_weights),
            max_ingredients=int(settings.max_ingredients),
            max_effect_prob=int(settings.max_effects),
            search_depth=int(settings.search_depth),
            effect_names=EFFECT_NAMES,
            ingredient_names=INGREDIENT_NAMES,
        )
    finally:
        db_sa.close()


@app.route("/login", methods=["GET", "POST"])
def login():
    """Log user in"""
    session.clear()

    if request.method == "POST":
        try:
            data: AuthData = parse_auth_form(request.form, mode="login")
        except ValueError as e:
            return error(str(e), url=url_for("login"))

        db_sa = SessionLocal()
        try:
            user = db_sa.execute(
                select(User).where(User.username == data.username)
            ).scalar_one_or_none()

            if user is None or not check_password_hash(user.hash, data.password):
                return error(_("nombre de usuario o contraseña incorrectos"), url=url_for("login"))

            session["user_id"] = user.id
            return redirect(url_for("index"))
        finally:
            db_sa.close()

    return render_template("login.html")


@app.route("/logout")
def logout():
    """Log user out"""
    session.clear()
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    """Register user"""
    if request.method == "POST":
        try:
            data: AuthData = parse_auth_form(request.form, mode="register")
        except ValueError as e:
            return error(str(e), url=url_for("register"))
        db_sa = SessionLocal()
        try:
            new_user = User(username=data.username, hash=generate_password_hash(data.password))
            db_sa.add(new_user)
            db_sa.flush()  # makes new_user.id available without committing
            db_sa.add(UserSettings(user=new_user))
            db_sa.commit()
        except IntegrityError:
            db_sa.rollback()
            return error(_("El nombre de usuario ya existe"), url=url_for("register"))
        finally:
            db_sa.close()
        return redirect(url_for("login"))
    return render_template("register.html")


@app.route("/optimize", methods=["POST"])
@login_required
def optimize():
    try:
        n_dipl = parse_int(
            request.form,
            "n_diploma",
            label=_("EL número de diplomas"),
            min_val=1,
            max_val=CauldronOptimizer.max_ndiplomas,
        )
        effect_weights = parse_effect_weights(request.form, n_dipl)
        alpha_ub = parse_int(
            request.form,
            "alpha_UB",
            label=_("El número máximo de ingtedientes"),
            min_val=1,
            max_val=25,
        )
        prob_ub = parse_int(
            request.form,
            "prob_UB",
            label=_("La probabilidad máxima por por efecto"),
            min_val=1,
            max_val=100,
        )
        n_starts = parse_int(
            request.form,
            "n_starts",
            label=_("La profundidad de la búsqueda"),
            min_val=1,
            max_val=100,
        )
        premium_ingr = parse_premium_ingredients(request.form)
    except ValueError as e:
        return error(str(e), url=url_for("index"))

    user_id = session["user_id"]

    db_sa = SessionLocal()
    try:
        settings = db_sa.get(UserSettings, user_id)
        if settings is None:
            return error(_("No se encontró la configuracion del ususario"), url=url_for("index"))
        settings.effect_weights = effect_weights.tolist()
        settings.max_ingredients = int(alpha_ub)
        settings.max_effects = int(prob_ub)
        settings.search_depth = int(n_starts)
        settings.updated_at = func.now()
        db_sa.commit()
    except SQLAlchemyError:
        db_sa.rollback()
        return error(_("Error de base de datos"), url=url_for("index"))
    finally:
        db_sa.close()

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

    return render_template(
        "results.html",
        alpha_matrix=alpha_matrix,
        ingredient_icons=INGREDIENT_ICONS,
        out_effects=out_effects[order].round(2).tolist(),
        effect_names=[EFFECT_NAMES[i] for i in order],
        effect_indices=order.tolist(),
        effect_weights=effect_weights[order].tolist(),
        score=score,
    )


@app.route("/contact")
def contact():
    return render_template("contact.html")
