import json

from flask_babel import lazy_gettext as _l
from flask_wtf import FlaskForm
from wtforms import FieldList, HiddenField, IntegerField, PasswordField, StringField
from wtforms.validators import (
    DataRequired,
    EqualTo,
    Length,
    NumberRange,
    ValidationError,
)

from cauldron_optimizer.constants import MAX_STARTS
from cauldron_optimizer.optimizer.optimizer import CauldronOptimizer


# Babel extraction marker: extracted, but does NOT translate at definition time.
def N_(s: str) -> str:
    """Mark a string for translation extraction without translating it."""
    return s


class LoginForm(FlaskForm):
    username = StringField(
        label=_l(N_("Usuario")),
        validators=[
            DataRequired(message=_l(N_("Debe introducir el nombre de usuario"))),
            Length(
                min=1,
                max=16,
                message=_l(N_("El nombre de usuario debe tener entre 1 y 16 caracteres")),
            ),
        ],
        render_kw={
            "placeholder": _l(N_("Usuario")),
        },
    )

    password = PasswordField(
        label=_l(N_("Contraseña")),
        validators=[
            DataRequired(message=_l(N_("Debe introducir una contraseña"))),
            Length(
                min=1,
                max=32,
                message=_l(N_("La contraseña debe tener entre 1 y 32 caracteres")),
            ),
        ],
        render_kw={
            "placeholder": _l(N_("Contraseña")),
        },
    )


class RegisterForm(FlaskForm):
    username = StringField(
        label=_l(N_("Usuario")),
        validators=[
            DataRequired(message=_l(N_("Debe introducir el nombre de usuario"))),
            Length(
                min=1,
                max=16,
                message=_l(N_("El nombre de usuario debe tener entre 1 y 16 caracteres")),
            ),
        ],
        render_kw={
            "placeholder": _l(N_("Usuario")),
        },
    )

    password = PasswordField(
        label=_l(N_("Contraseña")),
        validators=[
            DataRequired(message=_l(N_("Debe introducir una contraseña"))),
            Length(
                min=1,
                max=32,
                message=_l(N_("La contraseña debe tener entre 1 y 32 caracteres")),
            ),
        ],
        render_kw={
            "placeholder": _l(N_("Contraseña")),
        },
    )
    confirmation = PasswordField(
        label=_l(N_("Confirmar contraseña")),
        validators=[
            DataRequired(message=_l(N_("Debe confirmar su contraseña"))),
            EqualTo("password", message=_l(N_("Las contraseñas no coinciden"))),
        ],
        render_kw={
            "placeholder": _l(N_("Confirmar contraseña")),
        },
    )


class SearchForm(FlaskForm):
    """Form used on the index page for search/optimization.
    Includes all dynamic inputs except constant names lists.
    """

    n_diploma = IntegerField(
        validators=[
            DataRequired(message=_l(N_("Debe introducir el numero de diplomas"))),
            NumberRange(
                min=1,
                max=CauldronOptimizer.max_ndiplomas,
                message=_l(
                    N_("El numero de diplomas debe estar entre 1 y {}").format(
                        CauldronOptimizer.max_ndiplomas
                    )
                ),
            ),
        ],
        render_kw={"type": "number", "min": 1, "step": 1},
    )
    alpha_UB = IntegerField(
        label=_l(N_("máx cantidad por ingrediente")),
        validators=[
            DataRequired(message=_l(N_("Debe introducir la cantidad máxima por ingrediente"))),
            NumberRange(
                min=1,
                max=CauldronOptimizer.sum_ingredients,
                message=_l(
                    N_("La cantidad máxima por ingrediente debe estar entre 1 y {}").format(
                        CauldronOptimizer.sum_ingredients
                    )
                ),
            ),
        ],
        render_kw={"type": "number", "min": 1, "max": CauldronOptimizer.sum_ingredients, "step": 1},
    )
    prob_UB = IntegerField(
        label=_l(N_("máx probabilidad por efecto")),
        validators=[
            DataRequired(message=_l(N_("Debe introducir la probabilidad maxima por effecto"))),
            NumberRange(
                min=1,
                max=100,
                message=_l(N_("La probabilidad maxima por efecto debe estar entre 1 y 100")),
            ),
        ],
        render_kw={"type": "number", "min": 1, "max": 100, "step": 1},
    )
    n_starts = IntegerField(
        label=_l(N_("profundidad de búsqueda")),
        validators=[
            DataRequired(message=_l(N_("Debe introducir la profundidad de búsqueda"))),
            NumberRange(
                min=1,
                max=MAX_STARTS,
                message=_l(
                    N_("La profundidad de búsqueda debe estar entre 1 y {}").format(MAX_STARTS)
                ),
            ),
        ],
        render_kw={"type": "number", "min": 1, "max": MAX_STARTS, "step": 1},
    )
    effect_weights_json = HiddenField()
    premium_ingr = FieldList(unbound_field=IntegerField(), min_entries=0)

    # Custom validation for effect weights JSON aligned with n_diploma
    def validate_effect_weights_json(self, field):
        raw = field.data or "[]"
        try:
            data = json.loads(raw)
        except Exception:
            raise ValidationError(_l(N_("Los pesos de los efectos deben ser un JSON válido")))

        if not isinstance(data, list):
            raise ValidationError(_l(N_("Los pesos de los efectos deben ser una lista")))

        n = self.n_diploma.data or 0
        if len(data) != n:
            raise ValidationError(
                _l(N_("El numero de effectos debe conicidir con el numero de diplomas"))
            )

        # Validate all numbers are within [0,1] and at least one is >0
        vals = []
        try:
            for x in data:
                v = float(x)
                vals.append(v)
        except Exception:
            raise ValidationError(_l(N_("Los pesos de los efectos deben ser numeros")))

        if any(v < 0 or v > 1 for v in vals):
            raise ValidationError(
                _l(N_("Los pesos de los efectos deben estar en entre 0 y 1 (incluidos)"))
            )

        if sum(vals) == 0.0:
            raise ValidationError(_l(N_("Al menos debes querer algun efecto")))

        # Stash parsed list for the route to consume
        self._parsed_effect_weights = vals
