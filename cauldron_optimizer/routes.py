import json
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, cast

import numpy as np
from flask import Response, abort, redirect, render_template, request, session, url_for
from flask_babel import gettext as _
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from cauldron_optimizer import app
from cauldron_optimizer.analytics import log_optimization_run
from cauldron_optimizer.constants import (
    AVATARS,
    EFFECT_NAMES,
    INGREDIENT_NAMES,
    LANGUAGES,
    MAX_PREMIUM_INGREDIENTS,
    MAX_SERVER_NAME_LENGTH,
    MAX_SERVERS_PER_USER,
    MAX_STARTS,
    MIN_CHECKED_EFFECTS,
)
from cauldron_optimizer.database import db_session
from cauldron_optimizer.db_model import ComplementSearch, Server, User, UserSettings
from cauldron_optimizer.forms import LoginForm, RegisterForm, SearchForm
from cauldron_optimizer.helpers import (
    avatar_url,
    error,
    first_form_error,
    is_avatar,
    login_required,
)
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
        # Set dynamic max bound for diplomas based on available effects
        # (preserve type/min/step)
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
            # Premium choices live only in the session, never in the database
            premiums=session.get("premium_ingredients", []),
            servers=[(s.server_number, server_label(s)) for s in settings.user.servers],
            active_server=settings.server_number,
            server_name=server_label(settings),
            next_server_name=suggest_server_name(settings.user.servers),
            can_add_server=account.n_servers < MAX_SERVERS_PER_USER,
            # For the in-browser "complete effects" search (solver.js)
            solver_matrices={
                "B": CauldronOptimizer.B_full.tolist(),
                "V": CauldronOptimizer.V_full.tolist(),
            },
            avatars=AVATARS,
            avatar=settings.avatar,
        )


def get_active_server(db_sa: Session, user_id: int) -> tuple[UserSettings, Server]:
    """Return the user's account settings and their selected server.

    Creates whatever is missing: the account settings row, and a first server
    if the user has none. Falls back to the first server if the selected one
    no longer exists.
    """
    user = db_sa.get(User, user_id)
    if user is None:
        # The session points to an account that no longer exists: log out
        abort(redirect(url_for("logout")))

    account = db_sa.get(UserSettings, user_id)
    if account is None:
        account = UserSettings(user_id=user_id, language=session.get("lang", "es"))
        db_sa.add(account)
        db_sa.flush()

    if not user.servers:
        user.servers.append(Server(server_number=1))
        db_sa.flush()

    server = next(
        (s for s in user.servers if s.server_number == account.active_server),
        user.servers[0],
    )
    account.active_server = server.server_number
    account.n_servers = len(user.servers)
    # The navbar shows the active server's avatar on every page
    session["avatar"] = server.avatar
    return account, server


def server_label(server: Server) -> str:
    """Name shown for a server (servers made before names existed have none)"""
    return server.name or _("Mundo %(n)s", n=server.server_number)


def clean_server_name(
    raw: str | None, servers: list[Server], current: Server | None
) -> str:
    """Validate a server name; raises ValueError with a user-facing message."""
    name = " ".join((raw or "").split())
    if not 1 <= len(name) <= MAX_SERVER_NAME_LENGTH:
        raise ValueError(
            _(
                "El nombre del mundo debe tener entre 1 y %(n)s caracteres",
                n=MAX_SERVER_NAME_LENGTH,
            )
        )
    taken = {server_label(s).casefold() for s in servers if s is not current}
    if name.casefold() in taken:
        raise ValueError(_("Ya tienes un mundo con ese nombre"))
    return name


def suggest_server_name(servers: list[Server]) -> str:
    """A free "Server N" name to prefill when adding a server"""
    taken = {server_label(s).casefold() for s in servers}
    n = len(servers) + 1
    while _("Mundo %(n)s", n=n).casefold() in taken:
        n += 1
    return _("Mundo %(n)s", n=n)


@app.route("/servers/add", methods=["POST"])
@login_required
def add_server():
    """Add a server with the chosen name and avatar, and select it (via fetch)"""
    avatar = request.form.get("avatar")
    if not is_avatar(avatar):
        return {"ok": False, "error": _("Avatar no válido")}, 400
    try:
        with db_session() as db_sa:
            account, current = get_active_server(db_sa, session["user_id"])
            servers = current.user.servers
            if len(servers) >= MAX_SERVERS_PER_USER:
                return {
                    "ok": False,
                    "error": _(
                        "Puedes tener como máximo %(n)s mundos",
                        n=MAX_SERVERS_PER_USER,
                    ),
                }, 400
            try:
                name = clean_server_name(request.form.get("name"), servers, None)
            except ValueError as e:
                return {"ok": False, "error": str(e)}, 400

            # Next free id after the highest one (deleted servers leave gaps);
            # the new server starts as a copy of the selected server's settings
            server = Server(
                server_number=max(s.server_number for s in servers) + 1,
                name=name,
                avatar=avatar,
                effect_weights=list(current.effect_weights),
                excluded_effects=list(current.excluded_effects or []),
                max_ingredients=current.max_ingredients,
                max_effects=current.max_effects,
                search_depth=current.search_depth,
            )
            servers.append(server)
            account.active_server = server.server_number
            account.n_servers = len(servers)
    except SQLAlchemyError:
        return {"ok": False, "error": _("Error de base de datos")}, 500
    session["avatar"] = avatar
    return {"ok": True}


@app.route("/servers/profile", methods=["POST"])
@login_required
def update_server():
    """Set the name and avatar of the active server (called via fetch)"""
    # No avatar sent: keep the current one (e.g. only renaming)
    avatar = request.form.get("avatar") or None
    if avatar is not None and not is_avatar(avatar):
        return {"ok": False, "error": _("Avatar no válido")}, 400
    try:
        with db_session() as db_sa:
            _account, server = get_active_server(db_sa, session["user_id"])
            try:
                name = clean_server_name(
                    request.form.get("name"), server.user.servers, server
                )
            except ValueError as e:
                return {"ok": False, "error": str(e)}, 400
            server.name = name
            if avatar is not None:
                server.avatar = avatar
            avatar = server.avatar
    except SQLAlchemyError:
        return {"ok": False, "error": _("Error de base de datos")}, 500
    session["avatar"] = avatar
    return {"ok": True, "url": avatar_url(avatar), "name": name}


@app.route("/servers/delete", methods=["POST"])
@login_required
def delete_server():
    """Delete the active server and its settings (called via fetch)"""
    number = request.form.get("server_number", type=int)
    try:
        with db_session() as db_sa:
            account, server = get_active_server(db_sa, session["user_id"])
            # Guards against a stale page showing another server
            if number != server.server_number:
                return {"ok": False, "error": _("Mundo no válido")}, 400
            servers = server.user.servers
            if len(servers) <= 1:
                return {
                    "ok": False,
                    "error": _("No puedes eliminar tu único mundo"),
                }, 400
            servers.remove(server)  # delete-orphan: deletes the row
            account.active_server = servers[0].server_number
            account.n_servers = len(servers)
            session["avatar"] = servers[0].avatar
    except SQLAlchemyError:
        return {"ok": False, "error": _("Error de base de datos")}, 500
    return {"ok": True}


@app.route("/servers/select", methods=["POST"])
@login_required
def select_server():
    """Select which server's settings to use"""
    number = request.form.get("server_number", type=int)
    try:
        with db_session() as db_sa:
            account, server = get_active_server(db_sa, session["user_id"])
            if number not in {s.server_number for s in server.user.servers}:
                return error(_("Mundo no válido"), url=url_for("index"))
            account.active_server = number
    except SQLAlchemyError:
        return error(_("Error de base de datos"), url=url_for("index"))
    return redirect(url_for("index"))


def keep_across_logout():
    """Clear the session except the language and the analytics visitor id."""
    kept = {k: session[k] for k in ("lang", "vid") if k in session}
    session.clear()
    session.update(kept)


@app.route("/login", methods=["GET", "POST"])
def login():
    """Log user in"""

    # Preserve language selection and visitor id across logout
    keep_across_logout()

    # Login form handling
    form = LoginForm()
    if form.validate_on_submit():
        with db_session() as db_sa:
            user = db_sa.execute(
                select(User).where(User.username == form.username.data)
            ).scalar_one_or_none()

            if user is None or not user.check_password(form.password.data or ""):
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
        msg = cast(list[str], next(iter(form.errors.values())))[0]
        return error(msg, url=url_for("login"))

    return render_template("login.html", form=form)


@app.route("/logout")
def logout():
    keep_across_logout()
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
                avatar = form.avatar.data or None
                db_sa.add(
                    Server(
                        user=new_user,
                        server_number=1,
                        avatar=avatar,
                        name=form.server_name.data or None,
                    )
                )
                # commit handled by context manager
                # Automatically log in the user after registration

                session.permanent = True

                session["user_id"] = new_user.id
                session["username"] = new_user.username
                session["premium_ingredients"] = []
                session["avatar"] = avatar
        except IntegrityError:
            return error(
                _("El nombre de usuario ya está en uso"), url=url_for("register")
            )
        return redirect(url_for("index"))
    if form.errors:
        return error(first_form_error(form), url=url_for("register"))

    return render_template("register.html", form=form, avatars=AVATARS)


def parse_search_form(include_premium: bool = True) -> dict[str, Any]:
    """Validate the optimizer form and return its settings.

    Raises ValueError with a user-facing message if anything is invalid.
    """
    form = SearchForm()
    if not form.validate_on_submit():
        raise ValueError(first_form_error(form))

    premium_ingr: list[int] = []
    if include_premium:
        premium_ingr = sorted(
            set(request.form.getlist("premium_ingredients[]", type=int))
        )
        if any(i < 0 or i >= len(INGREDIENT_NAMES) for i in premium_ingr):
            raise ValueError(_("Ingredientes premium no válidos"))
        if len(premium_ingr) > MAX_PREMIUM_INGREDIENTS:
            raise ValueError(
                _(
                    "Puedes evitar como máximo %(n)s ingredientes",
                    n=MAX_PREMIUM_INGREDIENTS,
                )
            )

    return {
        "effect_weights": [
            float(w) for w in getattr(form, "_parsed_effect_weights", [])
        ],
        "excluded_effects": getattr(form, "_parsed_excluded_effects", []),
        "premium_ingr": premium_ingr,
        # Never None here: the fields are DataRequired
        "alpha_ub": int(form.alpha_UB.data or 0),
        "prob_ub": int(form.prob_UB.data or 0),
        "n_starts": int(form.n_starts.data or 0),
        "language": form.language.data,
    }


@app.route("/settings/save", methods=["POST"])
@login_required
def save_settings():
    """Save the optimizer settings for the active server (called via fetch)"""
    try:
        s = parse_search_form(include_premium=False)
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
            server.updated_at = datetime.now(timezone.utc)
    except SQLAlchemyError:
        return {"ok": False, "error": _("Error de base de datos")}, 500

    session["lang"] = s["language"]
    return {"ok": True}


@app.route("/settings/reset", methods=["POST"])
@login_required
def reset_settings():
    """Clear temporary ingredient selections before reloading saved settings."""
    session["premium_ingredients"] = []
    return {"ok": True}


# ---------------------------------------------------------------------------
# "Complete effects" search: runs in the browser, progress saved per world
# ---------------------------------------------------------------------------

# A saved state holds 3 lists of 5 results (~3 KB); anything far bigger is
# not ours
MAX_COMPLEMENT_STATE_BYTES = 50_000


def clean_complement_params(raw: Any) -> dict[str, Any]:
    """Validate the search parameters; raises ValueError."""
    if not isinstance(raw, dict):
        raise ValueError
    p = cast(dict[str, Any], raw)
    n = int(p["n"])
    effects = [int(i) for i in p["effects"]]
    weights = [float(w) for w in p["weights"]]
    params: dict[str, Any] = {
        "n": n,
        "effects": effects,
        "weights": weights,
        "alpha_ub": int(p["alpha_ub"]),
        "prob_ub": int(p["prob_ub"]),
        "depth": int(p["depth"]),
    }
    ok = (
        MIN_CHECKED_EFFECTS <= n <= len(EFFECT_NAMES)
        and 1 <= len(effects) < MIN_CHECKED_EFFECTS
        and len(set(effects)) == len(effects) == len(weights)
        and all(0 <= i < n for i in effects)
        and all(0 <= w <= 1 for w in weights)
        and sum(weights) > 0
        and 1 <= params["alpha_ub"] <= CauldronOptimizer.sum_ingredients
        and 1 <= params["prob_ub"] <= 100
        and 1 <= params["depth"] <= MAX_STARTS
    )
    if not ok:
        raise ValueError
    return params


@app.route("/complement/state")
@login_required
def complement_state():
    """Saved search of the active world, or null"""
    with db_session() as db_sa:
        _account, server = get_active_server(db_sa, session["user_id"])
        saved = db_sa.get(ComplementSearch, (server.username, server.server_number))
        if saved is None:
            return {"ok": True, "search": None}
        return {
            "ok": True,
            "search": {"params": saved.params, "state": saved.state},
        }


@app.route("/complement/save", methods=["POST"])
@login_required
def complement_save():
    """Save the search progress of the active world (called via fetch)"""
    if (request.content_length or 0) > MAX_COMPLEMENT_STATE_BYTES:
        return {"ok": False, "error": _("Datos no válidos")}, 400
    data = request.get_json(silent=True)
    try:
        if not isinstance(data, dict):
            raise ValueError
        body = cast(dict[str, Any], data)
        params = clean_complement_params(body.get("params"))
        state = body.get("state")
        if not isinstance(state, dict):
            raise ValueError
        state = cast(dict[str, Any], state)
        done, total = int(state["done"]), int(state["total"])
        if not 0 <= done <= total:
            raise ValueError
    except (ValueError, KeyError, TypeError):
        return {"ok": False, "error": _("Datos no válidos")}, 400

    try:
        with db_session() as db_sa:
            _account, server = get_active_server(db_sa, session["user_id"])
            key = (server.username, server.server_number)
            saved = db_sa.get(ComplementSearch, key)
            if saved is None:
                saved = ComplementSearch(username=key[0], server_number=key[1])
                db_sa.add(saved)
            saved.params = params
            saved.state = state
            saved.done = done
            saved.total = total
            saved.updated_at = datetime.now(timezone.utc)
    except SQLAlchemyError:
        return {"ok": False, "error": _("Error de base de datos")}, 500
    return {"ok": True}


@app.route("/complement/clear", methods=["POST"])
@login_required
def complement_clear():
    """Forget the saved search of the active world (called via fetch)"""
    try:
        with db_session() as db_sa:
            _account, server = get_active_server(db_sa, session["user_id"])
            saved = db_sa.get(ComplementSearch, (server.username, server.server_number))
            if saved is not None:
                db_sa.delete(saved)
    except SQLAlchemyError:
        return {"ok": False, "error": _("Error de base de datos")}, 500
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

    start = time.perf_counter()
    alpha_best, val_best = opt.multistart(n_starts)
    duration_ms = round((time.perf_counter() - start) * 1000)
    alpha_matrix = alpha_best.reshape(3, 4).astype(int).tolist()
    score = float(val_best)
    log_optimization_run(s, alpha_matrix, score, duration_ms)
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
