"""Configuration utilities for Cauldron Optimizer."""

import os

from dotenv import load_dotenv

# Load environment variables from .env (root) for local/dev
load_dotenv()


def get_secret_key() -> str:
    return os.environ["SECRET_KEY"]


def get_database_url() -> str:
    return os.environ["NEONDB_USER"]


def select_locale():
    """Select the best locale for the current request."""
    from flask import request, session

    from cauldron_optimizer.constants import LANGUAGES

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

    # 4) Fallback: English (Spanish only for browsers that ask for it)
    return "en"
