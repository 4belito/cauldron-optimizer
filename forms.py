import json

from flask_babel import lazy_gettext
from flask_wtf import FlaskForm
from wtforms import FieldList, HiddenField, IntegerField, PasswordField, StringField
from wtforms.validators import (
    DataRequired,
    EqualTo,
    Length,
    NumberRange,
    ValidationError,
)

from cauldron_optimizer import CauldronOptimizer
from constants import MAX_STARTS


# Babel extraction marker: extracted, but does NOT translate at definition time.
def N_(s: str) -> str:
    """Mark a string for translation extraction without translating it."""
    return s


class LoginForm(FlaskForm):
    username = StringField(
        lazy_gettext(N_("Usuario")),
        validators=[
            DataRequired(message=lazy_gettext(N_("Debe introducir el nombre de usuario"))),
            Length(
                min=1,
                max=16,
                message=lazy_gettext(N_("El nombre de usuario debe tener entre 1 y 16 caracteres")),
            ),
        ],
    )
    password = PasswordField(
        lazy_gettext(N_("Contraseña")),
        validators=[
            DataRequired(message=lazy_gettext(N_("Debe introducir una contraseña"))),
            Length(
                min=1,
                max=32,
                message=lazy_gettext(N_("La contraseña debe tener entre 1 y 32 caracteres")),
            ),
        ],
    )


class RegisterForm(FlaskForm):
    username = StringField(
        lazy_gettext(N_("Usuario")),
        validators=[
            DataRequired(message=lazy_gettext(N_("Debe introducir el nombre de usuario"))),
            Length(
                min=1,
                max=16,
                message=lazy_gettext(N_("El nombre de usuario debe tener entre 1 y 16 caracteres")),
            ),
        ],
    )
    password = PasswordField(
        lazy_gettext(N_("Contraseña")),
        validators=[
            DataRequired(message=lazy_gettext(N_("Debe introducir una contraseña"))),
            Length(
                min=1,
                max=32,
                message=lazy_gettext(N_("La contraseña debe tener entre 1 y 32 caracteres")),
            ),
        ],
    )
    confirmation = PasswordField(
        lazy_gettext(N_("Confirmar contraseña")),
        validators=[
            DataRequired(message=lazy_gettext(N_("Debe confirmar su contraseña"))),
            EqualTo("password", message=lazy_gettext(N_("Las contraseñas no coinciden"))),
        ],
    )


class SearchForm(FlaskForm):
    """Form used on the index page for search/optimization.
    Includes all dynamic inputs except constant names lists.
    """

    n_diploma = IntegerField(
        lazy_gettext(N_("Diplomas & Efectos Deseados")),
        validators=[DataRequired(), NumberRange(min=1, max=CauldronOptimizer.max_ndiplomas)],
        render_kw={"type": "number", "min": 1, "step": 1},
    )
    alpha_UB = IntegerField(
        lazy_gettext(N_("máx cantidad por ingrediente")),
        validators=[NumberRange(min=1, max=CauldronOptimizer.sum_ingredients)],
        render_kw={"type": "number", "min": 1, "max": CauldronOptimizer.sum_ingredients, "step": 1},
    )
    prob_UB = IntegerField(
        lazy_gettext(N_("máx probabilidad por efecto")),
        validators=[DataRequired(), NumberRange(min=1, max=100)],
        render_kw={"type": "number", "min": 1, "max": 100, "step": 1},
    )
    n_starts = IntegerField(
        lazy_gettext(N_("profundidad de búsqueda")),
        validators=[NumberRange(min=1, max=MAX_STARTS)],
        render_kw={"type": "number", "min": 1, "max": MAX_STARTS, "step": 1},
    )
    # JSON string with default effect weights for client-side UI
    effect_weights_json = HiddenField()
    # Selected premium ingredients (indexes); defaults to []
    premium_ingr = FieldList(IntegerField(), min_entries=0)

    # Custom validation for effect weights JSON aligned with n_diploma
    def validate_effect_weights_json(self, field):
        raw = field.data or "[]"
        try:
            data = json.loads(raw)
        except Exception:
            raise ValidationError(
                lazy_gettext(N_("Los pesos de los efectos deben ser un JSON válido"))
            )

        if not isinstance(data, list):
            raise ValidationError(lazy_gettext(N_("Los pesos de los efectos deben ser una lista")))

        n = self.n_diploma.data or 0
        if len(data) != n:
            raise ValidationError(
                lazy_gettext(N_("El numero de effectos debe conicidir con el numero de diplomas"))
            )

        # Validate all numbers are within [0,1] and at least one is >0
        vals = []
        try:
            for x in data:
                v = float(x)
                vals.append(v)
        except Exception:
            raise ValidationError(lazy_gettext(N_("Los pesos de los efectos deben ser numeros")))

        if any(v < 0 or v > 1 for v in vals):
            raise ValidationError(
                lazy_gettext(N_("Los pesos de los efectos deben estar en entre 0 y 1 (incluidos)"))
            )

        if sum(vals) == 0.0:
            raise ValidationError(lazy_gettext(N_("Al menos debes querer algun efecto")))

        # Stash parsed list for the route to consume
        self._parsed_effect_weights = vals
