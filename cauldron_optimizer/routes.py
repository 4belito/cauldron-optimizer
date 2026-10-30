import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

import numpy as np
from flask import (
    Response,
    abort,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from flask_babel import get_locale
from flask_babel import gettext as _
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from cauldron_optimizer import app
from cauldron_optimizer.analytics import log_complement_run, log_optimization_run
from cauldron_optimizer.constants import (
    AVATARS,
    EFFECT_NAMES,
    ELVENASSIST_PANELS,
    INGREDIENT_NAMES,
    LANGUAGES,
    MAX_PREMIUM_INGREDIENTS,
    MAX_ROUNDS,
    MAX_SERVER_NAME_LENGTH,
    MAX_SERVERS_PER_USER,
    MAX_STARTS,
    MIN_CHECKED_EFFECTS,
    SITE_URL,
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
from cauldron_optimizer.optimizer.optimizer import (
    MEAN_EFFECTS,
    WONDER_REDUCTION,
    CauldronOptimizer,
    ingredient_witch_points,
    rounds_probability,
    wp_block_table,
)

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


# Browser cache time of static files without a ?v= version (images, fonts)
STATIC_MAX_AGE = 7 * 24 * 3600


@app.after_request
def after_request(response: Response) -> Response:
    """Set how long browsers and Vercel's CDN may keep each response.

    Pages are never stored (they depend on the session). Static files are:
    - with ?v= (versioned): kept a year, a new version changes the URL
    - .js/.css without ?v=: checked with the server on each use (a short
      "not modified" answer when unchanged), so a deploy is seen at once
    - other files (images, fonts): kept a week
    Vercel's CDN may keep any static file: it is emptied on every deploy.
    """
    if request.endpoint in ("static", "docs_image"):
        if request.args.get("v"):
            browser = "public, max-age=31536000, immutable"
        elif request.path.endswith((".js", ".css")):
            browser = "no-cache"
        else:
            browser = f"public, max-age={STATIC_MAX_AGE}"
        response.headers["Cache-Control"] = browser
        response.headers["CDN-Cache-Control"] = "public, max-age=31536000"
        return response

    response.headers["Cache-Control"] = (
        "no-store, no-cache, must-revalidate, max-age=0, private"
    )
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# Images in the project's docs/ folder the pages show
DOCS_DIR = Path(app.root_path).parent / "docs"
DOCS_IMAGES = {"effects.png"}


@app.template_global()
def docs_image_url(name: str) -> dict[str, Any]:
    """URL and size of a docs/ image (a PNG). The URL has the file's change
    time as ?v=, so browsers fetch it again when the file changes."""
    path = DOCS_DIR / name
    with path.open("rb") as f:
        header = f.read(24)  # the PNG header has the width and height
    return {
        "src": url_for("docs_image", name=name, v=int(path.stat().st_mtime)),
        "width": int.from_bytes(header[16:20], "big"),
        "height": int.from_bytes(header[20:24], "big"),
    }


@app.route("/docs/<name>")
def docs_image(name: str) -> Response:
    """Serve an image from docs/ (only those in DOCS_IMAGES)."""
    if name not in DOCS_IMAGES:
        abort(404)
    return send_from_directory(DOCS_DIR, name)


# Pages search engines may index; each one exists in every language
PUBLIC_PAGES = ["index", "contact"]


@app.route("/robots.txt")
def robots_txt() -> Response:
    """Tell search engines what to crawl: the public pages, not the app."""
    private = [
        "/lang/",
        "/home",
        "/logout",
        "/optimize",
        "/results",
        "/manual",
        "/formula",
        "/servers/",
        "/settings/",
        "/complement/",
        "/integration/",
        "/stats",
    ]
    lines = ["User-agent: *", "Allow: /"]
    lines += [f"Disallow: {path}" for path in private]
    lines += ["", f"Sitemap: {SITE_URL}/sitemap.xml", ""]
    return Response("\n".join(lines), mimetype="text/plain")


@app.route("/sitemap.xml")
def sitemap_xml() -> Response:
    """List the public pages in each language, linked to each other."""
    urls = []
    for endpoint in PUBLIC_PAGES:
        base = SITE_URL + url_for(endpoint)
        hreflangs = [(lang, lang) for lang in LANGUAGES] + [("x-default", "en")]
        alternates = "".join(
            f'<xhtml:link rel="alternate" hreflang="{tag}" href="{base}?lang={lang}"/>'
            for tag, lang in hreflangs
        )
        for lang in LANGUAGES:
            urls.append(f"<url><loc>{base}?lang={lang}</loc>{alternates}</url>")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
        + "\n".join(urls)
        + "\n</urlset>\n"
    )
    return Response(xml, mimetype="application/xml")


@app.route("/home")
@app.route("/")  # registered first: url_for("index") gives "/"
def index():
    """Show the recipe input form, or the public presentation page to
    visitors not logged in (also what search engines see)"""
    user_id = session.get("user_id")
    if user_id is None:
        return render_template("landing.html")
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
        form.exact_search.data = bool(settings.exact_search)
        form.all_effects.data = bool(settings.all_effects)
        form.n_rounds.data = int(settings.n_rounds)
        form.min_effects.data = int(settings.min_effects)
        form.n_premium.data = int(settings.n_premium)
        form.wp_max.data = settings.max_witch_points
        form.wonder_level.data = settings.wonder_level
        form.elvenassist_off_json.data = json.dumps(settings.elvenassist_off or [])
        form.wp_owned.data = settings.owned_witch_points
        form.effect_weights_json.data = json.dumps(settings.effect_weights)
        form.excluded_effects_json.data = json.dumps(settings.excluded_effects or [])
        form.language.data = str(get_locale())
        # Back from the results: the form shows the settings of that search
        # (maybe unsaved), not the saved ones. Only for the world it ran on
        last = session.get("last_search")
        unsaved = False
        if last and last.get("server") == settings.server_number:
            form.n_diploma.data = len(last["effect_weights"])
            form.alpha_UB.data = last["alpha_ub"]
            form.prob_UB.data = last["prob_ub"]
            form.n_starts.data = last["n_starts"]
            form.exact_search.data = last["exact"]
            form.all_effects.data = last.get("all_effects", False)
            form.n_rounds.data = last.get("n_rounds", settings.n_rounds)
            form.min_effects.data = last.get("min_effects", settings.min_effects)
            form.n_premium.data = last.get("n_premium", settings.n_premium)
            form.wp_max.data = last.get("wp_max")
            form.wonder_level.data = last.get("wonder_level", settings.wonder_level)
            form.elvenassist_off_json.data = json.dumps(
                last.get("elvenassist_off", settings.elvenassist_off or [])
            )
            form.wp_owned.data = last.get("wp_owned", settings.owned_witch_points)
            form.effect_weights_json.data = json.dumps(last["effect_weights"])
            form.excluded_effects_json.data = json.dumps(last["excluded_effects"])
            unsaved = True

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
            # The form differs from the saved settings: restore button on
            unsaved=unsaved,
            # For the in-browser "complete effects" search (solver.js)
            solver_matrices={
                "B": CauldronOptimizer.B_full.tolist(),
                "V": CauldronOptimizer.V_full.tolist(),
            },
            avatars=AVATARS,
            avatar=settings.avatar,
            max_rounds=MAX_ROUNDS,
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
        account = UserSettings(user_id=user_id, language=str(get_locale()))
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


# The name a world gets when the player does not choose one: none, or the
# suggested "Mundo 1" / "World 1" left as it was
DEFAULT_SERVER_NAME_RE = re.compile(r"(mundo|world) \d+", re.IGNORECASE)


def has_default_name(server: Server) -> bool:
    """True if the player never named this world (it may be renamed for them)"""
    return server.name is None or bool(
        DEFAULT_SERVER_NAME_RE.fullmatch(" ".join(server.name.split()))
    )


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
                exact_search=current.exact_search,
                all_effects=current.all_effects,
                n_rounds=current.n_rounds,
                min_effects=current.min_effects,
                max_witch_points=current.max_witch_points,
                # Each world has its own school: a new one starts not built
                wonder_level=None,
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
        session.pop("last_search", None)
    except SQLAlchemyError:
        return error(_("Error de base de datos"), url=url_for("index"))
    return redirect(url_for("index"))


@app.route("/integration/world/select", methods=["POST"])
@login_required
def select_world_integration():
    """Select the world of a city for the page's postMessage API.

    A world of that name is selected. Otherwise (with create) no world is
    made: the active one is used, renamed to the city only if the player
    never named it (no name, or "Mundo N" / "World N" as suggested); a name
    the player chose stays.
    """
    create = request.form.get("create") == "1"
    raw_name = request.form.get("name")

    try:
        with db_session() as db_sa:
            account, current = get_active_server(db_sa, session["user_id"])
            servers = current.user.servers
            normalized_name = " ".join((raw_name or "").split())
            target = next(
                (
                    server
                    for server in servers
                    if server_label(server).casefold() == normalized_name.casefold()
                ),
                None,
            )
            renamed = False

            if target is None:
                # code: stable, for the extension; error: for the player
                if not create:
                    return {
                        "ok": False,
                        "code": "not_found",
                        "error": _("Mundo no válido"),
                    }, 404
                target = current
                if has_default_name(current):
                    try:
                        current.name = clean_server_name(raw_name, servers, current)
                    except ValueError as e:
                        return {
                            "ok": False,
                            "code": "invalid_name",
                            "error": str(e),
                        }, 400
                    renamed = True

            # Renamed: the page reloads too, to show the new name
            changed = account.active_server != target.server_number or renamed
            account.active_server = target.server_number
            avatar = target.avatar
            world = {
                "name": server_label(target),
                "number": target.server_number,
            }
    except SQLAlchemyError:
        return {
            "ok": False,
            "code": "db_error",
            "error": _("Error de base de datos"),
        }, 500

    session["avatar"] = avatar
    if changed:
        session.pop("last_search", None)
    return {
        "ok": True,
        # Worlds are never made here (kept for the extension's API)
        "created": False,
        "renamed": renamed,
        "changed": changed,
        "world": world,
    }


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
                        language=str(get_locale()),
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


def clean_elvenassist_off(raw: str | None) -> list[str]:
    """What ElvenAssist may not do, from its JSON list: known names only"""
    try:
        value = json.loads(raw or "[]")
    except ValueError:
        return []
    if not isinstance(value, list):
        return []
    return [p for p in ELVENASSIST_PANELS if p in value]


@app.route("/settings/elvenassist", methods=["POST"])
@login_required
def save_elvenassist():
    """Save the ElvenAssist switches of the active world at once (called via
    fetch when one is clicked): a reload by the extension must not undo them"""
    off = clean_elvenassist_off(request.form.get("elvenassist_off_json"))
    try:
        with db_session() as db_sa:
            _account, server = get_active_server(db_sa, session["user_id"])
            server.elvenassist_off = off
    except SQLAlchemyError:
        return {"ok": False, "error": _("Error de base de datos")}, 500
    last = session.get("last_search")
    if last:
        last["elvenassist_off"] = off
        session["last_search"] = last
    return {"ok": True, "off": off}


def parse_search_form(include_premium: bool = True) -> dict[str, Any]:
    """Validate the optimizer form and return its settings.

    Raises ValueError with a user-facing message if anything is invalid.
    """
    form = SearchForm()
    # Saving (no ingredients) accepts fewer checked effects than a search
    form.require_min_effects = include_premium
    if not form.validate_on_submit():
        raise ValueError(first_form_error(form))

    n_premium = (
        MAX_PREMIUM_INGREDIENTS if form.n_premium.data is None else form.n_premium.data
    )
    premium_ingr: list[int] = []
    if include_premium:
        premium_ingr = sorted(
            set(request.form.getlist("premium_ingredients[]", type=int))
        )
        if any(i < 0 or i >= len(INGREDIENT_NAMES) for i in premium_ingr):
            raise ValueError(_("Ingredientes premium no válidos"))
        # Exactly as many as the world avoids
        if len(premium_ingr) != n_premium:
            raise ValueError(
                _("Elige exactamente %(n)s ingredientes para evitar", n=n_premium)
            )

    elvenassist_off = clean_elvenassist_off(form.elvenassist_off_json.data)

    return {
        "effect_weights": [
            float(w) for w in getattr(form, "_parsed_effect_weights", [])
        ],
        "excluded_effects": getattr(form, "_parsed_excluded_effects", []),
        "premium_ingr": premium_ingr,
        "n_premium": n_premium,
        # Never None here: the fields are DataRequired
        "alpha_ub": int(form.alpha_UB.data or 0),
        "prob_ub": int(form.prob_UB.data or 0),
        "n_starts": int(form.n_starts.data or 0),
        "exact": bool(form.exact_search.data),
        "all_effects": bool(form.all_effects.data),
        "n_rounds": int(form.n_rounds.data or 0),
        "min_effects": int(form.min_effects.data or 0),
        # None: no Witch Point limit
        "wp_max": form.wp_max.data,
        "wonder_level": int(form.wonder_level.data or 0),
        "elvenassist_off": elvenassist_off,
        # None: not known
        "wp_owned": form.wp_owned.data,
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
            server.exact_search = s["exact"]
            server.all_effects = s["all_effects"]
            server.n_rounds = s["n_rounds"]
            server.min_effects = s["min_effects"]
            server.n_premium = s["n_premium"]
            server.max_witch_points = s["wp_max"]
            server.wonder_level = s["wonder_level"]
            server.elvenassist_off = s["elvenassist_off"]
            server.owned_witch_points = s["wp_owned"]
            server.updated_at = datetime.now(UTC)
    except SQLAlchemyError:
        return {"ok": False, "error": _("Error de base de datos")}, 500

    session["lang"] = s["language"]
    session.pop("last_search", None)  # the form now matches the saved settings
    return {"ok": True}


@app.route("/settings/reset", methods=["POST"])
@login_required
def reset_settings():
    """Clear temporary ingredient selections before reloading saved settings."""
    session["premium_ingredients"] = []
    session.pop("last_search", None)
    return {"ok": True}


# ---------------------------------------------------------------------------
# "Complete effects" search: runs in the browser, progress saved per world
# ---------------------------------------------------------------------------

# A saved state holds 3 lists of 5 results (~3 KB) and, climbing, the mean
# of every set tried (~40 bytes each: tens of thousands of sets fit);
# anything far bigger is not ours
MAX_COMPLEMENT_STATE_BYTES = 8_000_000
# Climbs of the effects search (complement.js maxEffectDepth: up to as
# many as would try every set)
MAX_EFFECT_DEPTH = 1000


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
        # "Óptima": exact runs; searches saved before it have none: off
        "exact": p.get("exact") is True,
        # Effects: every set (searches saved before the climb), or climbing
        "effect_exact": p.get("effect_exact") is not False,
        "effect_depth": int(p.get("effect_depth") or 1),
        # Searches saved before the Witch Point limit have neither: no limit
        "wp_max": None if p.get("wp_max") is None else int(p["wp_max"]),
        "wonder_level": int(p.get("wonder_level") or 0),
        # "Todos en" goblets; searches saved before it have none: 0, by the weights
        "n_rounds": int(p.get("n_rounds") or 0),
        # ...and at least this many wanted effects (0, or none saved: all)
        "min_effects": int(p.get("min_effects") or 0),
        # Avoided ingredients per run; searches saved before it avoided 4
        "n_avoid": int(p.get("n_avoid", MAX_PREMIUM_INGREDIENTS)),
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
        and 1 <= params["effect_depth"] <= MAX_EFFECT_DEPTH
        and (params["wp_max"] is None or params["wp_max"] >= 1)
        and 0 <= params["wonder_level"] < len(WONDER_REDUCTION)
        and 0 <= params["n_rounds"] <= MAX_ROUNDS
        and -1 <= params["min_effects"] <= MAX_ROUNDS
        and 0 <= params["n_avoid"] <= MAX_PREMIUM_INGREDIENTS
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
            saved.updated_at = datetime.now(UTC)
    except SQLAlchemyError:
        return {"ok": False, "error": _("Error de base de datos")}, 500
    log_complement_run(state.get("run_id"), params, done, total)
    return {"ok": True}


@app.route("/complement/started", methods=["POST"])
@login_required
def complement_started():
    """A search started or was continued in the browser, for the stats
    (called via fetch; the search itself is not saved here)"""
    data = request.get_json(silent=True)
    try:
        if not isinstance(data, dict):
            raise ValueError
        body = cast(dict[str, Any], data)
        params = clean_complement_params(body.get("params"))
        done, total = int(body["done"]), int(body["total"])
        if not 0 <= done <= total:
            raise ValueError
    except (ValueError, KeyError, TypeError):
        return {"ok": False, "error": _("Datos no válidos")}, 400
    log_complement_run(body.get("run_id"), params, done, total, started=True)
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


def browser_recipe(
    opt: CauldronOptimizer, s: dict[str, Any]
) -> tuple[np.ndarray, int] | None:
    """The recipe found by the browser and its search time, if valid.

    Only the recipe is taken from the browser: the server checks it against
    the limits and computes its score and probabilities itself.
    """
    try:
        recipe = [int(x) for x in json.loads(request.form.get("recipe_json", ""))]
        search_ms = int(request.form.get("search_ms", 0))
    except (ValueError, TypeError):
        return None
    ok = (
        len(recipe) == CauldronOptimizer.n_ingredients
        and all(0 <= x <= s["alpha_ub"] for x in recipe)
        and 0 < sum(recipe) <= CauldronOptimizer.sum_ingredients
        and all(recipe[j] == 0 for j in s["premium_ingr"])
        and (s["wp_max"] is None or opt.witch_points(recipe) <= s["wp_max"])
    )
    if not ok:
        return None
    return np.array(recipe, dtype=int), max(0, min(search_ms, 600_000))


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
    # "Todos": a weight only says the effect is wanted (0 or 1), the score is
    # the chance of getting them within the goblets, and there is no cap
    rounds = s["n_rounds"] if s["all_effects"] else 0
    min_effects = s["min_effects"] if rounds else 0
    if rounds:
        effect_weights = (effect_weights > 0).astype(np.float64)

    opt = CauldronOptimizer(
        effect_weights=effect_weights,
        premium_ingr=premium_ingr,
        excluded_effects=s["excluded_effects"],
        alpha_UB=s["alpha_ub"],
        prob_UB=100 if rounds else s["prob_ub"],
        wp_max=s["wp_max"],
        wonder_level=s["wonder_level"],
        n_rounds=rounds,
        min_effects=min_effects,
    )

    # The browser normally searches (static/js/search.js) and sends its recipe;
    # without one (no JavaScript) the server searches
    browser = browser_recipe(opt, s)
    # Guaranteed optimum: the browser checked every recipe (search.js)
    exact = False
    if browser is not None:
        alpha_best, duration_ms = browser
        exact = s["exact"] and request.form.get("recipe_exact") == "1"
    else:
        start = time.perf_counter()
        alpha_best, _val = opt.multistart(n_starts)
        duration_ms = round((time.perf_counter() - start) * 1000)
    alpha_matrix = alpha_best.reshape(3, 4).astype(int).tolist()
    score = opt.score(opt.effect_probabilities(alpha_best))
    # "Todos en": the chance of at least k of the wanted effects for every k,
    # from 1 to all that can come out, and their expected number (the sum of
    # those chances): shown on hovering the score's label
    chances: list[float] = []
    most = 0
    if rounds:
        q = np.minimum(opt.effect_probabilities(alpha_best), 100.0)[opt.wanted] / 100
        most = min(len(q), rounds)
        chances = [100 * rounds_probability(q, rounds, k) for k in range(1, most + 1)]
    mean = bool(rounds) and min_effects == MEAN_EFFECTS
    log_optimization_run(
        {**s, "n_rounds": rounds, "min_effects": min_effects},
        alpha_matrix,
        score,
        duration_ms,
        exact=exact,
        searched_in="browser" if browser is not None else "server",
    )
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
        "exact": exact,
        # What the score is: the weighted probability (n_rounds 0) or the
        # chance (%) of getting at least n_got different wanted effects in
        # n_rounds brews (all of them that can be, or min_effects)
        "n_rounds": rounds,
        "n_got": most if mean or not min_effects else min(most, min_effects),
        # "Media": the score is the expected number of different wanted
        # effects (of at most `most`), not a chance
        "mean": mean,
        "most": most,
        "chances": chances,
        # Kept with the recipe: the form's selection can be reset meanwhile
        "premiums": premium_ingr,
        # The school's level the costs are priced with
        "wonder_level": s["wonder_level"],
    }
    session["premium_ingredients"] = premium_ingr
    # The settings of this search, shown again when going back to the form
    with db_session() as db_sa:
        _account, server = get_active_server(db_sa, session["user_id"])
        session["last_search"] = {
            "server": server.server_number,
            "effect_weights": s["effect_weights"],
            "excluded_effects": s["excluded_effects"],
            "alpha_ub": s["alpha_ub"],
            "prob_ub": s["prob_ub"],
            "n_starts": n_starts,
            "exact": s["exact"],
            "all_effects": s["all_effects"],
            "n_rounds": s["n_rounds"],
            "min_effects": s["min_effects"],
            "n_premium": s["n_premium"],
            "wp_max": s["wp_max"],
            "wonder_level": s["wonder_level"],
            "elvenassist_off": s["elvenassist_off"],
            "wp_owned": s["wp_owned"],
        }

    return redirect(url_for("results"))


@app.template_filter("amount")
def format_amount(n: int) -> str:
    """As the game shows amounts: up to 4 digits as they are, then 175K, 1.2M
    (same as formatWitchPoints in cauldron-order.js)."""
    if n >= 1_000_000:
        return f"{round(n / 1_000_000, 1):g}M"
    if n >= 10_000:
        return f"{n // 1000}K"
    return str(n)


@app.template_filter("precise")
def format_precise(x: float) -> str:
    """A score with all the decimals that matter (up to 12, no trailing
    zeros): shown on hover, where "100.00" may be 99.999999769."""
    return f"{x:.12f}".rstrip("0").rstrip(".")


@app.route("/results")
@login_required
def results():
    """Display optimization results"""
    last_results = session.get("last_results")
    if not last_results:
        return redirect(url_for("index"))

    # Witch Points of each ingredient and in all, bought in the cheapest order
    # with the school's discount of the search (results from before it: none)
    wonder_level = int(last_results.get("wonder_level", 0))
    block = wp_block_table(
        CauldronOptimizer.sum_ingredients, WONDER_REDUCTION[wonder_level]
    )
    ingredient_wp = ingredient_witch_points(
        [x for row in last_results["alpha_matrix"] for x in row], block
    )

    return render_template(
        "results.html",
        ingredient_wp=ingredient_wp,
        recipe_wp=sum(ingredient_wp),
        wonder_level=wonder_level,
        wonder_discount=WONDER_REDUCTION[wonder_level],
        alpha_matrix=last_results["alpha_matrix"],
        effects=last_results["effects"],
        score=last_results["score"],
        exact=last_results.get("exact", False),
        n_rounds=last_results.get("n_rounds", 0),
        n_got=last_results.get("n_got", 0),
        chances=last_results.get("chances", []),
        mean=last_results.get("mean", False),
        most=last_results.get("most", 0),
        premiums=last_results.get("premiums", session.get("premium_ingredients", [])),
        max_ingredients=CauldronOptimizer.sum_ingredients,
    )


@app.route("/contact")
def contact():
    return render_template("contact.html")


# Manual recipe test bench: recipe, premiums and effects in play are picked in
# the page, which computes the chances and the cost itself (static/js/formula.js)
@app.route("/manual")
@login_required
def manual():
    return render_template(
        "manual.html",
        effect_names=EFFECT_NAMES,
        ingredient_names=INGREDIENT_NAMES,
        max_ingredients=CauldronOptimizer.sum_ingredients,
        matrices={
            "B": CauldronOptimizer.B_full.tolist(),
            "V": CauldronOptimizer.V_full.tolist(),
        },
    )


@app.route("/formula")
@login_required
def formula():
    return redirect(url_for("manual"))
