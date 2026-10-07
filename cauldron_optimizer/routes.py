import json
from typing import TYPE_CHECKING

import numpy as np
from flask import Response, redirect, render_template, request, session, url_for
from flask_babel import gettext as _
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from cauldron_optimizer import app
from cauldron_optimizer.constants import (
    EFFECT_NAMES,
    INGREDIENT_NAMES,
    LANGUAGES,
    MAX_PREMIUM_INGREDIENTS,
    MAX_SERVERS_PER_USER,
)
from cauldron_optimizer.database import db_session
from cauldron_optimizer.db_model import Server, User, UserSettings
from cauldron_optimizer.forms import LoginForm, RegisterForm, SearchForm
from cauldron_optimizer.helpers import error, first_form_error, login_required
from cauldron_optimizer.optimizer.optimizer import CauldronOptimizer

if TYPE_CHECKING:
    from flask import Response


@app.route("/lang/<lang>")
def set_lang(lang: str):
    if lang not in LANGUAGES:
        lang = "en"
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
def after_request(response: Response) -> Response:
    """Force browsers and CDNs to re-validate everything."""
    response.headers["Cache-Control"] = (
        "no-store, no-cache, must-revalidate, max-age=0, private"
    )
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# constants.py
@app.route("/")
@app.route("/home")
@login_required
def index():
    """Show recipe input form"""
    user_id = session["user_id"]
    with db_session() as db_sa:
        account, settings = get_active_server(db_sa, user_id)

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
        form.excluded_effects_json.data = json.dumps(settings.excluded_effects or [])
        form.language.data = session.get("lang", "es")

        return render_template(
            "index.html",
            form=form,
            effect_names=EFFECT_NAMES,
            ingredient_names=INGREDIENT_NAMES,
            premiums=list(settings.premium_ingredients or []),
            n_servers=account.n_servers,
            active_server=settings.server_number,
            max_servers=MAX_SERVERS_PER_USER,
        )


def get_active_server(db_sa, user_id: int) -> tuple[UserSettings, Server]:
    """Return the user's account settings and their selected server.

    Creates whatever is missing: the account settings row and the server row
    (a new server starts as a copy of server 1).
    """
    account = db_sa.get(UserSettings, user_id)
    if account is None:
        account = UserSettings(user_id=user_id, language=session.get("lang", "es"))
        db_sa.add(account)
        db_sa.flush()

    username = db_sa.get(User, user_id).username
    n = min(max(account.n_servers or 1, 1), MAX_SERVERS_PER_USER)
    number = min(max(account.active_server or 1, 1), n)
    account.n_servers, account.active_server = n, number

    server = db_sa.get(Server, (username, number))
    if server is None:
        server = Server(username=username, server_number=number)
        first = db_sa.get(Server, (username, 1)) if number != 1 else None
        if first is not None:
            server.effect_weights = list(first.effect_weights)
            server.excluded_effects = list(first.excluded_effects or [])
            server.premium_ingredients = list(first.premium_ingredients or [])
            server.max_ingredients = first.max_ingredients
            server.max_effects = first.max_effects
            server.search_depth = first.search_depth
        db_sa.add(server)
        db_sa.flush()
    return account, server


@app.route("/servers/count", methods=["POST"])
@login_required
def set_server_count():
    """Set how many servers the user plays on (extra servers keep their settings)"""
    n = request.form.get("n_servers", type=int)
    if n is None or not 1 <= n <= MAX_SERVERS_PER_USER:
        return error(
            _(
                "El número de servidores debe estar entre 1 y %(n)s",
                n=MAX_SERVERS_PER_USER,
            ),
            url=url_for("index"),
        )
    try:
        with db_session() as db_sa:
            account, _server = get_active_server(db_sa, session["user_id"])
            account.n_servers = n
            account.active_server = min(account.active_server, n)
    except SQLAlchemyError:
        return error(_("Error de base de datos"), url=url_for("index"))
    return redirect(url_for("index"))


@app.route("/servers/select", methods=["POST"])
@login_required
def select_server():
    """Select which server's settings to use"""
    number = request.form.get("server_number", type=int)
    try:
        with db_session() as db_sa:
            account, _server = get_active_server(db_sa, session["user_id"])
            if number is None or not 1 <= number <= account.n_servers:
                return error(_("Servidor no válido"), url=url_for("index"))
            account.active_server = number
    except SQLAlchemyError:
        return error(_("Error de base de datos"), url=url_for("index"))
    return redirect(url_for("index"))


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

            if user is None or not user.check_password(form.password.data):
                return error(
                    _("nombre de usuario o contraseña incorrectos"),
                    url=url_for("login"),
                )

            session.permanent = True

            session["user_id"] = user.id
            session["username"] = user.username
            session["premium_ingredients"] = []
            # Apply stored language preference from database
            settings = db_sa.get(UserSettings, user.id)
            if settings and settings.language:
                session["lang"] = settings.language
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
                    username=form.username.data,
                    password=form.password.data,
                )
                db_sa.add(new_user)
                db_sa.flush()  # makes new_user.id available without committing
                db_sa.add(
                    UserSettings(
                        user=new_user,
                        language=session.get("lang", "es"),
                    )
                )
                db_sa.add(Server(user=new_user, server_number=1))
                # commit handled by context manager
                # Automatically log in the user after registration

                session.permanent = True

                session["user_id"] = new_user.id
                session["username"] = new_user.username
                session["premium_ingredients"] = []
        except IntegrityError:
            return error(
                _("El nombre de usuario ya está en uso"), url=url_for("register")
            )
        return redirect(url_for("index"))
    if form.errors:
        return error(first_form_error(form), url=url_for("register"))

    return render_template("register.html", form=form)


def parse_search_form() -> dict:
    """Validate the optimizer form and return its settings.

    Raises ValueError with a user-facing message if anything is invalid.
    """
    form = SearchForm()
    if not form.validate_on_submit():
        raise ValueError(first_form_error(form))

    # effect weights are validated and parsed by the form validator
    premium_ingr = sorted(
        set(request.form.getlist("premium_ingredients[]", type=int))
    )
    if any(i < 0 or i >= len(INGREDIENT_NAMES) for i in premium_ingr):
        raise ValueError(_("Ingredientes premium no válidos"))
    if len(premium_ingr) > MAX_PREMIUM_INGREDIENTS:
        raise ValueError(
            _("Puedes evitar como máximo %(n)s ingredientes", n=MAX_PREMIUM_INGREDIENTS)
        )

    return {
        "effect_weights": [
            float(w) for w in getattr(form, "_parsed_effect_weights", [])
        ],
        "excluded_effects": getattr(form, "_parsed_excluded_effects", []),
        "premium_ingr": premium_ingr,
        "alpha_ub": int(form.alpha_UB.data),
        "prob_ub": int(form.prob_UB.data),
        "n_starts": int(form.n_starts.data),
        "language": form.language.data,
    }


@app.route("/settings/save", methods=["POST"])
@login_required
def save_settings():
    """Save the optimizer settings for the active server (called via fetch)"""
    try:
        s = parse_search_form()
    except ValueError as e:
        return {"ok": False, "error": str(e)}, 400

    try:
        with db_session() as db_sa:
            # Search settings are saved per server; language per account
            account, server = get_active_server(db_sa, session["user_id"])
            account.language = s["language"]
            server.effect_weights = s["effect_weights"]
            server.excluded_effects = s["excluded_effects"]
            server.max_ingredients = s["alpha_ub"]
            server.max_effects = s["prob_ub"]
            server.search_depth = s["n_starts"]
            server.updated_at = func.now()
    except SQLAlchemyError:
        return {"ok": False, "error": _("Error de base de datos")}, 500

    session["lang"] = s["language"]
    return {"ok": True}


@app.route("/optimize", methods=["GET", "POST"])
@login_required
def optimize():
    # Redirect GET requests to index (user should only POST here)
    if request.method == "GET":
        return redirect(url_for("index"))

    try:
        s = parse_search_form()
    except ValueError as e:
        return error(str(e), url=url_for("index"))

    effect_weights = np.array(s["effect_weights"], dtype=np.float64)
    premium_ingr = s["premium_ingr"]
    n_starts = s["n_starts"]

    opt = CauldronOptimizer(
        effect_weights=effect_weights,
        premium_ingr=premium_ingr,
        excluded_effects=s["excluded_effects"],
        alpha_UB=s["alpha_ub"],
        prob_UB=s["prob_ub"],
    )

    alpha_best, val_best = opt.multistart(n_starts)
    alpha_matrix = alpha_best.reshape(3, 4).astype(int).tolist()
    score = float(val_best)
    out_effects = opt.effect_probabilities(alpha_best)
    order = sorted(range(len(out_effects)), key=lambda i: (-out_effects[i], i))

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
    session["premium_ingredients"] = premium_ingr

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


# Formula debugging route
@app.route("/formula", methods=["GET", "POST"])
@login_required
def formula():
    max_diplomas = len(EFFECT_NAMES)

    # Default values
    n_diplomas = min(5, max_diplomas)  # sane default
    alpha_matrix = np.zeros((3, 4), dtype=int)
    effects = []

    if request.method == "POST":
        try:
            # Read diplomas (same semantics as index)
            n_diplomas = int(request.form.get("n_diplomas", n_diplomas))
            n_diplomas = max(1, min(n_diplomas, max_diplomas))

            # Read ingredient grid (12 values)
            values = [int(request.form.get(f"alpha_{i}", 0)) for i in range(12)]
            alpha_matrix = np.array(values, dtype=int).reshape(3, 4)

            # Formula-only optimizer (NO optimization)
            opt = CauldronOptimizer(
                effect_weights=[1.0] * n_diplomas,
                premium_ingr=[],
            )

            out_effects = opt.effect_probabilities(alpha_matrix.flatten())
            order = sorted(range(len(out_effects)), key=lambda i: (-out_effects[i], i))

            for i in order:
                val = out_effects[i]
                if val > 0:
                    effects.append(
                        {
                            "value": round(float(val), 2),
                            "name": EFFECT_NAMES[i],
                            "index": i,
                            "weight": 1.0,
                        }
                    )

        except Exception as e:
            return error(str(e), url=url_for("formula"))

    return render_template(
        "formula.html",
        alpha_matrix=alpha_matrix.tolist(),
        effects=effects,
        n_diplomas=n_diplomas,
        max_diplomas=max_diplomas,
    )
