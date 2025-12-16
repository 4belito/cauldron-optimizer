import numpy as np
from flask import Flask, redirect, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from cauldron_optimizer import CauldronOptimizer
from flask_session import Session
from helpers import error, login_required
from sql import SQL

MAX_NDIPLOMAS = CauldronOptimizer.max_ndiplomas
N_INGRIDIENTS = CauldronOptimizer.n_ingredients

# Configure application
app = Flask(__name__)

# Configure session to use filesystem (instead of signed cookies)
app.config["SESSION_PERMANENT"] = False
app.config["SESSION_TYPE"] = "filesystem"
Session(app)

# Configure CS50 Library to use SQLite database
db = SQL("users.db")


@app.after_request
def after_request(response):
    """Ensure responses aren't cached"""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Expires"] = 0
    response.headers["Pragma"] = "no-cache"
    return response


@app.route("/")
@login_required
def index():
    """Show recipe input form"""
    return render_template("index.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    """Log user in"""

    # Forget any user_id
    session.clear()

    # User reached route via POST (as by submitting a form via POST)
    if request.method == "POST":
        # Ensure username was submitted
        if not request.form.get("username"):
            return error("must provide username")

        # Ensure password was submitted
        elif not request.form.get("password"):
            return error("must provide password")

        # Query database for username
        rows = db.execute("SELECT * FROM users WHERE username = ?", request.form.get("username"))

        # Ensure username exists and password is correct
        if len(rows) != 1 or not check_password_hash(rows[0]["hash"], request.form.get("password")):
            return error("invalid username and/or password")

        # Remember which user has logged in
        session["user_id"] = rows[0]["id"]

        # Redirect user to home page
        return redirect("/")

    # User reached route via GET (as by clicking a link or via redirect)
    else:
        return render_template("login.html")


@app.route("/logout")
def logout():
    """Log user out"""

    # Forget any user_id
    session.clear()

    # Redirect user to login form
    return redirect("/")


@app.route("/register", methods=["GET", "POST"])
def register():
    """Register user"""
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        confirmation = request.form.get("confirmation")

        if username is None:
            return error("must provide username")
        if not isinstance(username, str) or len(username) < 1:
            return error("invalid username")
        if password is None:
            return error("must provide password")
        if not isinstance(password, str) or len(password) < 1:
            return error("invalid password")
        if confirmation is None:
            return error("must provide password confirmation")
        if password != confirmation:
            return error("passwords do not match")
        # Check if username already exists
        try:
            db.execute(
                "INSERT INTO users (username, hash) VALUES (?, ?)",
                username,
                generate_password_hash(password),
            )
        except ValueError:
            return error("username already exists")

        return redirect("/login")
    return render_template("register.html")


@app.route("/optimize", methods=["POST"])
@login_required
def optimize():
    # ---- 1) Read inputs ----
    try:
        n_dipl = int(request.form.get("n_diploma", "0"))
    except ValueError:
        return error("numero de diplomas debe ser un numero entero")

    if not (1 <= n_dipl <= MAX_NDIPLOMAS):
        return error(f"numero de diplomas debe estar entre 1 y {MAX_NDIPLOMAS}")

    # effect_weights[] comes as a list of strings
    weights_raw = request.form.getlist("effect_weights[]")
    if len(weights_raw) != n_dipl:
        return error("El numero de effectos debe conicidir con el numero de diplomas")

    try:
        effect_weights = np.array([float(x) for x in weights_raw], dtype=float)
    except ValueError:
        return error("Los pesos de los efectos deben ser numeros")

    if np.any(effect_weights < 0) or np.any(effect_weights > 1):
        return error("Los pesos de los efectos deben estar en entre 0 y 1 (incluidos)")

    if np.sum(effect_weights) == 0:
        return error("Al menos debes querer algun efecto")

    premium_names = request.form.getlist("premium_ingredients[]")

    # bounds
    try:
        alpha_ub = int(request.form.get("alpha_UB", "25"))
        prob_ub = int(request.form.get("prob_UB", "100"))
    except ValueError:
        return error("Los limites de la busqueda deben ser enumeros enteros")

    if not (1 <= alpha_ub <= 25):
        return error("El limmite de los ingredientes debe estar entre 1 y 25")
    if not (1 <= prob_ub <= 100):
        return error(
            "El limmite de la probabliidad de efecto deseado debe estar entre 1 y 100", 400
        )

    # ---- 2) Convert premium names -> indices ----
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
        "hoja de agricabello",
        "capullo de nube de algodon",
        "trufa orejera",
    ]
    ingredient_icons = [f"ingr{i}.png" for i in range(1, 13)]
    name_to_idx = {name: i for i, name in enumerate(INGREDIENT_NAMES)}

    premium_ingr = []
    for name in premium_names:
        if name not in name_to_idx:
            return error(f"Ingrediente premium desconocido: {name}")
        premium_ingr.append(name_to_idx[name])

    # ---- 4) Run optimizer ----
    opt = CauldronOptimizer(
        effect_weights=effect_weights,
        premium_ingr=premium_ingr,
        alpha_UB=alpha_ub,
        prob_UB=prob_ub,
    )

    alpha_best, val_best = opt.multistart(n_starts=100)

    # alpha_best is length 12 -> reshape 3x4
    alpha_matrix = alpha_best.reshape(3, 4).astype(int).tolist()

    # val_best maybe already percent; just pass it through
    score = float(val_best)

    return render_template(
        "results.html", alpha_matrix=alpha_matrix, ingredient_icons=ingredient_icons, score=score
    )
