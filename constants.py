"""Constants for the Cauldron optimizer."""

INGREDIENT_NAMES = [
    "Espora Ígnea",
    "Escarabanuez",
    "Cáscaron de Maná",
    "Iris Volador",
    "Huevo de Medusa",
    "Lima de Oruga",
    "Flor de Hierba Mora",
    "Lenguas Burlonas",
    "Brote Ocular",
    "Hoja de Agricabello",
    "Capullo de Nube de Algodón",
    "Trufa Orejera",
]

EFFECT_NAMES = [
    "Monedas",
    "Provisiones",
    "Cuartel Fuerza",
    "Ordinarios Básicos",
    "Ordinarios Refinados",
    "Ordinarios Preciosos",
    "Entrenamiento Fuerza",
    "Portal",
    "Orcos",
    "Maná",
    "Mercenarios Fuerza",
    "Semillas",
    "Sensitivos Básicos",
    "Sensitivos Refinados",
    "Sensitivos Preciosos",
    "Entrenamiento Salud",
    "Mercenarios Salud",
    "Unurium",
    "Ascendidos Básicos",
    "Ascendidos Refinados",
    "Ascendidos Preciosos",
    "Cuartel Salud",
    "Trabajo Comunitario",
    "Productos en Conserva",
]


INGREDIENT_NAME_TO_IDX = {name: i for i, name in enumerate(INGREDIENT_NAMES)}

INGREDIENT_ICONS = [f"ingredients/ingr{i}.png" for i in range(1, len(INGREDIENT_NAMES) + 1)]

N_INGREDIENTS = len(INGREDIENT_NAMES)
