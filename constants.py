INGREDIENT_NAMES = [
    "Espora Ignea",
    "Escarabanuez",
    "Cascaron de Mana",
    "Iris Volador",
    "Huevo de Medusa",
    "Lima de Oruga",
    "Flor de hierba mora",
    "Lenguas burlonas",
    "Brote ocular",
    "Hoja de agricabello",
    "Capullo de nube de algodon",
    "Trufa orejera",
]

INGREDIENT_NAME_TO_IDX = {name: i for i, name in enumerate(INGREDIENT_NAMES)}

INGREDIENT_ICONS = [f"ingr{i}.png" for i in range(1, len(INGREDIENT_NAMES) + 1)]

N_INGREDIENTS = len(INGREDIENT_NAMES)
