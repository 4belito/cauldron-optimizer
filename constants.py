"""Constants for the Cauldron optimizer."""

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
]

N_INGREDIENTS = len(INGREDIENT_NAMES)
MAX_STARTS = 100
