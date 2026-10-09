"""Constants for the Cauldron optimizer."""

import json
from pathlib import Path

LANGUAGES = ["es", "en"]


# Babel extraction marker: extracted, but does NOT translate at definition time.
def N_(s: str) -> str:
    """Mark a string for translation extraction without translating it."""
    return s


INGREDIENT_NAMES = [
    N_("Espora Ígnea"),
    N_("Escarabanuez"),
    N_("Cáscaron de Maná"),
    N_("Iris Volador"),
    N_("Huevo de Medusa"),
    N_("Lima de Oruga"),
    N_("Flor de Hierba Mora"),
    N_("Lenguas Burlonas"),
    N_("Brote Ocular"),
    N_("Hoja de Agricabello"),
    N_("Capullo de Nube de Algodón"),
    N_("Trufa Orejera"),
]

EFFECT_NAMES = [
    N_("Monedas"),
    N_("Provisiones"),
    N_("Cuartel Fuerza"),
    N_("Ordinarios Básicos"),
    N_("Ordinarios Refinados"),
    N_("Ordinarios Preciosos"),
    N_("Entrenamiento Fuerza"),
    N_("Portal"),
    N_("Orcos"),
    N_("Maná"),
    N_("Mercenarios Fuerza"),
    N_("Semillas"),
    N_("Sensitivos Básicos"),
    N_("Sensitivos Refinados"),
    N_("Sensitivos Preciosos"),
    N_("Entrenamiento Salud"),
    N_("Mercenarios Salud"),
    N_("Unurium"),
    N_("Ascendidos Básicos"),
    N_("Ascendidos Refinados"),
    N_("Ascendidos Preciosos"),
    N_("Cuartel Salud"),
    N_("Trabajo Comunitario"),
    N_("Productos en Conserva"),
    N_("Nox"),
]

N_INGREDIENTS = len(INGREDIENT_NAMES)
MAX_STARTS = 100
# With this many or fewer effects checked, they cannot be unchecked (as in the game)
MIN_CHECKED_EFFECTS = 10
# Maximum number of premium ingredients that can be avoided
MAX_PREMIUM_INGREDIENTS = 4
# Maximum number of servers (game worlds) per user
MAX_SERVERS_PER_USER = 10
# Show the "under test" banner for the effect selection checkboxes (set False to hide)
SHOW_EFFECT_SELECTION_BETA_BANNER = True

# Usernames allowed to see the admin pages (/stats)
ADMIN_USERNAMES = {"4bel"}
DEFAULTS = {
    "effect_weights": "[0, 0, 0, 0]",
    "max_ingredients": 25,
    "max_effects": 100,
    "search_depth": 50,
}


# for adding a new effect
# 1- Add the hiddend B and V values to the corresponding CSV files in optimizer/
# 2- ADD IT TO EFFECT_NAMES
# 3- add the effect icon in /static/effects/effect{chapter_number}.png

# Avatars: the game's player portraits (see scripts/download_portraits.py),
# without the system icons that are not real avatars
PORTRAITS_DIR = Path(__file__).resolve().parent / "static" / "portraits"
_NOT_AVATARS = {
    "portrait_id_ignored.png",
    "portrait_id_questionmark.png",
    "portrait_id_support.png",
}
AVATARS = [
    p["file"]
    for p in json.loads((PORTRAITS_DIR / "portraits.json").read_text())
    if p["file"] not in _NOT_AVATARS
]
