"""Usage analytics: log page views and optimizer runs, and show them on /stats."""

import logging
import re
import secrets
import time
from collections import Counter
from collections.abc import Iterable, Sequence
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from flask import Response, g, render_template, request, session
from flask_babel import get_locale
from flask_babel import gettext as _
from sqlalchemy import func, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from cauldron_optimizer import app
from cauldron_optimizer.constants import EFFECT_NAMES, INGREDIENT_NAMES
from cauldron_optimizer.database import db_session
from cauldron_optimizer.db_model import (
    OptimizationRun,
    PageView,
    Server,
    User,
    UserSettings,
)
from cauldron_optimizer.helpers import admin_required

log = logging.getLogger(__name__)

# Endpoints that are not worth logging
SKIPPED_ENDPOINTS = {"static", "stats"}
STATS_PERIODS = [1, 7, 30, 90, 365]

BOT_RE = re.compile(
    r"bot|crawl|spider|slurp|preview|monitor|curl|wget|python|httpx|go-http"
    r"|headless|scan",
    re.I,
)
TABLET_RE = re.compile(r"ipad|tablet|kindle|silk", re.I)
MOBILE_RE = re.compile(r"mobi|android|iphone|ipod|phone", re.I)


def device_type(user_agent: str) -> str:
    if not user_agent or BOT_RE.search(user_agent):
        return "bot"
    if TABLET_RE.search(user_agent):
        return "tablet"
    if MOBILE_RE.search(user_agent):
        return "mobile"
    return "desktop"


def referrer_host() -> str | None:
    """Host of the referring site, or None when coming from this same site."""
    host = urlparse(request.referrer or "").hostname
    if not host or host == request.host.split(":")[0]:
        return None
    return host.removeprefix("www.")


@app.before_request
def start_timer():
    g.request_start = time.perf_counter()
    # Random id that tells visitors apart without storing their IP
    if "vid" not in session:
        session["vid"] = secrets.token_hex(8)


@app.after_request
def log_page_view(response: Response) -> Response:
    endpoint = request.endpoint or "not_found"
    if endpoint in SKIPPED_ENDPOINTS or request.method == "HEAD":
        return response
    start = g.get("request_start", time.perf_counter())
    try:
        with db_session() as db_sa:
            db_sa.add(
                PageView(
                    visitor_id=session.get("vid"),
                    user_id=session.get("user_id"),
                    endpoint=endpoint,
                    method=request.method,
                    status_code=response.status_code,
                    duration_ms=round((time.perf_counter() - start) * 1000),
                    language=str(get_locale()),
                    device=device_type(request.user_agent.string),
                    # Set by Vercel (or Cloudflare) from the visitor's IP
                    country=request.headers.get("X-Vercel-IP-Country")
                    or request.headers.get("CF-IPCountry"),
                    referrer_host=referrer_host(),
                )
            )
    except Exception:
        # Analytics must never break the page
        log.exception("Could not log page view")
    return response


def log_optimization_run(
    settings: dict[str, Any], recipe: list[list[int]], score: float, duration_ms: int
) -> None:
    """Record the settings and result of an optimizer run."""
    try:
        with db_session() as db_sa:
            account = db_sa.get(UserSettings, session["user_id"])
            db_sa.add(
                OptimizationRun(
                    user_id=session["user_id"],
                    server_number=account.active_server if account else None,
                    language=settings["language"],
                    n_diplomas=len(settings["effect_weights"]),
                    effect_weights=settings["effect_weights"],
                    excluded_effects=settings["excluded_effects"],
                    premium_ingredients=settings["premium_ingr"],
                    max_ingredients=settings["alpha_ub"],
                    max_effects=settings["prob_ub"],
                    search_depth=settings["n_starts"],
                    recipe=recipe,
                    score=score,
                    duration_ms=duration_ms,
                )
            )
    except Exception:
        log.exception("Could not log optimization run")


# ---------------------------------------------------------------------------
# Stats page
# ---------------------------------------------------------------------------


Row = tuple[Any, int, float]


def counted(values: Iterable[Any]) -> list[Row]:
    """(value, count, percent) rows, most common first."""
    counts = Counter(values)
    total = sum(counts.values()) or 1
    return [(v, n, 100 * n / total) for v, n in counts.most_common()]


def histogram(values: Iterable[Any]) -> list[Row]:
    """(value, count, percent) rows ordered by value."""
    return sorted(counted(values), key=lambda row: row[0])


def percentile(values: Sequence[float], p: float) -> float:
    if not values:
        return 0
    values = sorted(values)
    return values[min(len(values) - 1, int(p * len(values)))]


def grouped(
    db_sa: Session,
    column: InstrumentedAttribute[Any],
    since: datetime,
    limit: int = 15,
) -> list[Row]:
    """(value, count, percent) of human page views grouped by column."""
    rows = db_sa.execute(
        select(column, func.count())
        .where(PageView.created_at >= since, PageView.device != "bot")
        .group_by(column)
        .order_by(func.count().desc())
        .limit(limit)
    ).all()
    total = sum(n for _v, n in rows) or 1
    return [(v if v is not None else "—", n, 100 * n / total) for v, n in rows]


def traffic_stats(db_sa: Session, since: datetime) -> dict[str, Any]:
    human = (PageView.created_at >= since) & (PageView.device != "bot")
    views, visitors, users = db_sa.execute(
        select(
            func.count(),
            func.count(func.distinct(PageView.visitor_id)),
            func.count(func.distinct(PageView.user_id)),
        ).where(human)
    ).one()
    bots = db_sa.scalar(
        select(func.count()).where(
            PageView.created_at >= since, PageView.device == "bot"
        )
    )
    errors = db_sa.scalar(
        select(func.count()).where(human, PageView.status_code >= 500)
    )

    # Grouped by day in Python so it works on both Postgres and SQLite
    views_per_day: Counter[date] = Counter()
    visitors_per_day: dict[date, set[str | None]] = {}
    for created_at, visitor_id in db_sa.execute(
        select(PageView.created_at, PageView.visitor_id).where(human)
    ):
        views_per_day[created_at.date()] += 1
        visitors_per_day.setdefault(created_at.date(), set()).add(visitor_id)
    daily = [(d, n, len(visitors_per_day[d])) for d, n in sorted(views_per_day.items())]

    pages = db_sa.execute(
        select(
            PageView.endpoint,
            PageView.method,
            func.count(),
            func.count(func.distinct(PageView.visitor_id)),
            func.avg(PageView.duration_ms),
        )
        .where(human)
        .group_by(PageView.endpoint, PageView.method)
        .order_by(func.count().desc())
    ).all()

    return {
        "views": views,
        "visitors": visitors,
        "users": users,
        "bots": bots,
        "errors": errors,
        "daily": daily,
        "daily_max": max((v for _d, v, _u in daily), default=1),
        "pages": pages,
        "languages": grouped(db_sa, PageView.language, since),
        "devices": grouped(db_sa, PageView.device, since),
        "countries": grouped(db_sa, PageView.country, since),
        "referrers": grouped(db_sa, PageView.referrer_host, since),
        "statuses": grouped(db_sa, PageView.status_code, since),
    }


def usage_stats(db_sa: Session, since: datetime) -> dict[str, Any]:
    runs = db_sa.scalars(
        select(OptimizationRun).where(OptimizationRun.created_at >= since)
    ).all()
    n_runs = len(runs) or 1

    # Per effect: how often it is unlocked, wanted (weight > 0) and excluded,
    # and its mean weight
    effects = []
    for i, name in enumerate(EFFECT_NAMES):
        available = [r for r in runs if i < r.n_diplomas]
        weights = [r.effect_weights[i] for r in available]
        wanted = sum(w > 0 for w in weights)
        effects.append(
            {
                "name": name,
                "available": len(available),
                "wanted_pct": 100 * wanted / (len(available) or 1),
                "mean_weight": sum(weights) / (len(weights) or 1),
                "excluded_pct": 100
                * sum(i in r.excluded_effects for r in available)
                / (len(available) or 1),
            }
        )

    # Strategies: the most common sets of wanted effects with their weights
    def profile(run: OptimizationRun) -> tuple[tuple[str, float], ...]:
        return tuple(
            (EFFECT_NAMES[i], round(w, 2))
            for i, w in enumerate(run.effect_weights)
            if w > 0
        )

    per_user = Counter(r.user_id for r in runs)
    durations = [r.duration_ms for r in runs]
    daily = Counter(r.created_at.date() for r in runs)

    return {
        "runs": len(runs),
        "users": len(per_user),
        "runs_per_user": len(runs) / (len(per_user) or 1),
        "top_users": per_user.most_common(10),
        "daily": sorted(daily.items()),
        "daily_max": max(daily.values(), default=1),
        "duration_avg": sum(durations) / n_runs,
        "duration_p95": percentile(durations, 0.95),
        "languages": counted(r.language for r in runs),
        "n_diplomas": histogram(r.n_diplomas for r in runs),
        "max_ingredients": histogram(r.max_ingredients for r in runs),
        "max_effects": histogram(r.max_effects for r in runs),
        "search_depth": histogram(r.search_depth for r in runs),
        "n_wanted": histogram(sum(w > 0 for w in r.effect_weights) for r in runs),
        "n_excluded": histogram(len(r.excluded_effects) for r in runs),
        "premiums": counted(
            _(INGREDIENT_NAMES[i]) for r in runs for i in r.premium_ingredients
        ),
        "n_premiums": histogram(len(r.premium_ingredients) for r in runs),
        "effects": effects,
        "profiles": counted(profile(r) for r in runs)[:15],
        "recipes": counted(tuple(tuple(row) for row in r.recipe) for r in runs)[:10],
    }


def account_stats(db_sa: Session) -> dict[str, Any]:
    """Snapshot of all accounts and their saved settings (not limited by period)."""
    usernames = dict(db_sa.execute(select(User.id, User.username)).tuples().all())
    servers = db_sa.scalars(select(Server)).all()
    return {
        "usernames": usernames,
        "users": len(usernames),
        "n_servers": histogram(db_sa.scalars(select(UserSettings.n_servers)).all()),
        "account_languages": counted(
            db_sa.scalars(select(UserSettings.language)).all()
        ),
        "saved_servers": len(servers),
        "saved_max_ingredients": histogram(s.max_ingredients for s in servers),
        "saved_max_effects": histogram(s.max_effects for s in servers),
        "saved_search_depth": histogram(s.search_depth for s in servers),
    }


@app.route("/stats")
@admin_required
def stats():
    """Traffic and usage dashboard, only for admin users."""

    days = request.args.get("days", 30, type=int)
    if days not in STATS_PERIODS:
        days = 30
    since = datetime.now(timezone.utc) - timedelta(days=days)

    with db_session() as db_sa:
        return render_template(
            "stats.html",
            days=days,
            periods=STATS_PERIODS,
            traffic=traffic_stats(db_sa, since),
            usage=usage_stats(db_sa, since),
            accounts=account_stats(db_sa),
        )
