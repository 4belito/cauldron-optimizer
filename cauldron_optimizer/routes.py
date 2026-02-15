import json

import numpy as np
from flask import redirect, render_template, request, session, url_for
from flask_babel import gettext as _
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from cauldron_optimizer import app
from cauldron_optimizer.constants import EFFECT_NAMES, INGREDIENT_NAMES, LANGUAGES
from cauldron_optimizer.database import db_session
from cauldron_optimizer.db_model import User, UserSettings
from cauldron_optimizer.forms import LoginForm, RegisterForm, SearchForm
from cauldron_optimizer.helpers import error, first_form_error, login_required
from cauldron_optimizer.optimizer.optimizer import CauldronOptimizer


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
        form.language.data = session.get("lang", "es")

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

            if user is None or not user.check_password(form.password.data):
                return error(_("nombre de usuario o contraseña incorrectos"), url=url_for("login"))

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
                # commit handled by context manager
                # Automatically log in the user after registration
                session["user_id"] = new_user.id
                session["username"] = new_user.username
                session["premium_ingredients"] = []
        except IntegrityError:
            return error(_("El nombre de usuario ya está en uso"), url=url_for("register"))
        return redirect(url_for("index"))
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
        lang_choice = form.language.data
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
            settings.language = lang_choice
            settings.updated_at = func.now()
    except SQLAlchemyError:
        return error(_("Error de base de datos"), url=url_for("index"))

    # Persist language choice in session for future requests
    session["lang"] = lang_choice

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
