from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt
from werkzeug.datastructures import ImmutableMultiDict

from constants import INGREDIENT_NAME_TO_IDX


@dataclass(frozen=True)
class AuthData:
    username: str
    password: str
    confirmation: str | None = None


def parse_auth_form(
    form: ImmutableMultiDict[str, str],
    mode: Literal["login", "register"],
) -> AuthData:
    """
    Parse and validate login / register forms.

    Raises ValueError with a Spanish user-facing message.
    """
    username = form.get("username", "").strip()
    password = form.get("password", "")
    confirmation = form.get("confirmation") if mode == "register" else None

    if not username:
        raise ValueError("Debe proporcionar un nombre de usuario")

    if not password:
        raise ValueError("Debe proporcionar una contraseña")

    if not isinstance(password, str):
        raise ValueError("Contraseña inválida")

    if mode == "register":
        if not confirmation:
            raise ValueError("Debe confirmar la contraseña")
        if password != confirmation:
            raise ValueError("Las contraseñas no coinciden")

    return AuthData(
        username=username,
        password=password,
        confirmation=confirmation,
    )


def parse_int(
    form: ImmutableMultiDict[str, str],
    name: str,
    label: str,
    min_val: int,
    max_val: int,
) -> int:
    raw = form.get(name)  # str | None
    if raw is None or raw.strip() == "":
        raise ValueError(f"{label} debe ser un numero entero")

    try:
        val = int(raw)
    except ValueError:
        raise ValueError(f"{label} debe ser un numero entero")

    if not (min_val <= val <= max_val):
        raise ValueError(f"{label} debe estar entre {min_val} y {max_val}")

    return val


def parse_effect_weights(
    form: ImmutableMultiDict[str, str],
    n_dipl: int,
) -> npt.NDArray[np.float64]:
    weights_raw = form.getlist("effect_weights[]")

    if len(weights_raw) != n_dipl:
        raise ValueError("El numero de effectos debe conicidir con el numero de diplomas")

    try:
        w = np.array([float(x) for x in weights_raw], dtype=np.float64)
    except ValueError:
        raise ValueError("Los pesos de los efectos deben ser numeros")

    if np.any(w < 0) or np.any(w > 1):
        raise ValueError("Los pesos de los efectos deben estar en entre 0 y 1 (incluidos)")

    if w.sum() == 0.0:
        raise ValueError("Al menos debes querer algun efecto")

    return w


def parse_premium_ingredients(
    form,
) -> list[int]:
    premium_names = form.getlist("premium_ingredients[]")
    unknown = set(premium_names) - INGREDIENT_NAME_TO_IDX.keys()
    if unknown:
        raise ValueError(f"Ingrediente premium desconocido: {next(iter(unknown))}")

    return [INGREDIENT_NAME_TO_IDX[name] for name in premium_names]
