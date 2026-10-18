import math
from collections.abc import Iterable, Sequence
from pathlib import Path

import numpy as np
from numpy.typing import ArrayLike

BASE_DIR = Path(__file__).resolve().parent
B = np.loadtxt(BASE_DIR / "B_values.csv", delimiter=",", skiprows=1)
V = np.loadtxt(BASE_DIR / "V_values.csv", delimiter=",", skiprows=1)

# Witch Point prices, as in static/js/cauldron-order.js (the game's
# CauldronController.getBrewingCostFormula): an ingredient added as the
# rank-th one, being its amount-th copy, costs
#   round(50 * 1.1^(rank-1) * 1.4^(amount-1))
# times (1 - wonder reduction), rounded down
WP_BASIC_COST = 50
WP_FACTOR_ALL = 1.1
WP_FACTOR_SAME = 1.4
# Witch Point reduction of the Escuela de hechicería valoriana wonder by level
# (same table as WONDER_REDUCTION in cauldron-order.js); index 0 = not built
WONDER_REDUCTION = [
    0, 0.06, 0.09, 0.12, 0.15, 0.18, 0.22, 0.24, 0.26, 0.28, 0.3, 0.34, 0.36,
    0.38, 0.4, 0.42, 0.45, 0.46, 0.47, 0.48, 0.49, 0.5, 0.505, 0.51, 0.515,
    0.52, 0.53, 0.535, 0.54, 0.545, 0.55, 0.56, 0.565, 0.57, 0.575, 0.6,
]  # fmt: skip


def wp_price(rank: int, amount: int, reduction: float = 0.0) -> int:
    """Price of one ingredient added as the rank-th one, its amount-th copy."""
    price = math.floor(
        WP_BASIC_COST * WP_FACTOR_ALL ** (rank - 1) * WP_FACTOR_SAME ** (amount - 1)
        + 0.5
    )
    # The epsilon keeps e.g. 50 * 0.4 from flooring to 19
    return math.floor(price * (1 - reduction) + 1e-9) if reduction else price


def wp_block_table(size: int, reduction: float = 0.0) -> list[list[int]]:
    """block[r][n]: price of n copies of one ingredient added right after r others."""
    return [
        [
            sum(wp_price(r + a + 1, a + 1, reduction) for a in range(n))
            for n in range(size - r + 1)
        ]
        for r in range(size + 1)
    ]


def recipe_witch_points(counts: Iterable[int], block: list[list[int]]) -> int:
    """Witch Points of a recipe bought in the cheapest order.

    The cheapest order adds whole ingredients one after the other, the most
    used first (checked against the exact search in cauldron-order.js), so
    the cost only depends on the sorted amounts.
    """
    cost = 0
    rank = 0
    for n in sorted((int(c) for c in counts if c > 0), reverse=True):
        cost += block[rank][n]
        rank += n
    return cost


def ingredient_witch_points(counts: Sequence[int], block: list[list[int]]) -> list[int]:
    """Witch Points of each ingredient (all its units) in the cheapest order.

    Ties go in ingredient order; they add up to recipe_witch_points either way.
    """
    costs = [0] * len(counts)
    rank = 0
    for j in sorted(range(len(counts)), key=lambda j: -counts[j]):
        n = int(counts[j])
        if n <= 0:
            break
        costs[j] = block[rank][n]
        rank += n
    return costs


def rounds_probability(q: Sequence[float], n: int, k: int = 0) -> float:
    """Chance that n brews give at least k different effects of the m wanted
    (k = 0, or k >= min(m, n): as many as can be, min(m, n)).

    q: chance (0-1) of each wanted effect in one brew. A brew gives at most
    one effect, and the brews are independent (derivation: all_effects.ipynb).
    - m >= n, all: each brew gives a different wanted effect, any n of them:
      n! * e_n(q), the sum of the products of every n chances
    - m < n, all: all m come out at least once:
      n! [x^n] e^(r x) prod(e^(q_i x) - 1), r = 1 - sum(q) (an unwanted
      effect or none); the exponential generating function of the
      inclusion-exclusion sum
    - k below that: n! [x^n] of the terms with at least k factors
      (e^(q_i x) - 1) in e^(r x) prod(1 + (e^(q_i x) - 1)); both cases above
      are this one with k = min(m, n)
    """
    m = len(q)
    if k <= 0 or k >= min(m, n):
        if m >= n:
            # e[j]: sum of the products of every j chances seen so far
            e = [1.0] + [0.0] * n
            for qi in q:
                for j in range(n, 0, -1):
                    e[j] += qi * e[j - 1]
            return math.factorial(n) * e[n]
        r = max(0.0, 1.0 - sum(q))
        # Coefficients of x^0..x^n; f: qi^j / j!
        poly = [r**j / math.factorial(j) for j in range(n + 1)]
        for qi in q:
            f = [qi**j / math.factorial(j) for j in range(n + 1)]
            poly = [sum(poly[a] * f[d - a] for a in range(d)) for d in range(n + 1)]
        return math.factorial(n) * poly[n]

    r = max(0.0, 1.0 - sum(q))
    # by[j]: coefficients of x^0..x^n of the terms with j factors
    # (e^(q_i x) - 1), the last one with k or more
    by = [[0.0] * (n + 1) for _ in range(k + 1)]
    by[0] = [r**d / math.factorial(d) for d in range(n + 1)]
    for qi in q:
        f = [0.0] + [qi**d / math.factorial(d) for d in range(1, n + 1)]

        def times_f(p: list[float], f: list[float] = f) -> list[float]:
            return [sum(p[a] * f[d - a] for a in range(d)) for d in range(n + 1)]

        top = times_f([x + y for x, y in zip(by[k], by[k - 1], strict=True)])
        by[k] = [x + y for x, y in zip(by[k], top, strict=True)]
        for j in range(k - 1, 0, -1):
            by[j] = [x + y for x, y in zip(by[j], times_f(by[j - 1]), strict=True)]
    return math.factorial(n) * by[k][n]


# min_effects for "Media": the expected number of different wanted effects
MEAN_EFFECTS = -1


def expected_effects(q: Sequence[float], n: int) -> float:
    """Expected number of different effects of the m wanted that n brews give:
    sum of 1 - (1 - q_i)^n, the chance of each coming out at least once
    (linearity of expectation; derivation: all_effects.ipynb). It is also the
    sum over k of the chance of at least k of them."""
    return sum(1.0 - (1.0 - qi) ** n for qi in q)


class CauldronOptimizer:
    sum_ingredients = 25
    B_full: np.ndarray = np.asarray(B, dtype=float)
    V_full: np.ndarray = np.asarray(V, dtype=float)
    max_ndiplomas, n_ingredients = B_full.shape

    def __init__(
        self,
        effect_weights: ArrayLike,
        premium_ingr: Sequence[int] = (),
        excluded_effects: Sequence[int] = (),
        alpha_UB: int | None = None,
        prob_UB: int = 100,
        wp_max: int | None = None,
        wonder_level: int = 0,
        n_rounds: int = 0,
        min_effects: int = 0,
        cache_max_size: int = 1_000_000,
    ):
        effect_weights = np.asarray(effect_weights, dtype=float)
        if alpha_UB is None:
            alpha_UB = self.sum_ingredients
        self.n_dipl = len(effect_weights)
        assert self.n_dipl <= self.max_ndiplomas, "n_dipl > number of rows in B/V"

        # reduced problem parameters
        self.free_idx = np.array(
            [j for j in range(self.n_ingredients) if j not in premium_ingr], dtype=int
        )
        self.n_freeingr = len(self.free_idx)

        # truncate matrices to the diplomas we care about, and reduce columns
        self.B = self.B_full[: self.n_dipl, self.free_idx]
        self.V = self.V_full[: self.n_dipl, self.free_idx].copy()

        # excluded effects: zero V rows so E_i = 0, same as effects beyond n_dipl
        excluded = [i for i in excluded_effects if 0 <= i < self.n_dipl]
        self.V[excluded, :] = 0.0
        effect_weights = effect_weights.copy()
        effect_weights[excluded] = 0.0

        # normalized weights (guard divide by 0)
        s = effect_weights.sum()
        if s == 0:
            effect_weights = np.full(self.n_dipl, 1.0 / self.n_dipl, dtype=float)
        self.w = effect_weights / s
        # Brews to get the wanted effects in (0: score by the weights instead):
        # the score is then the chance (%) of getting min(m, n_rounds)
        # different wanted effects (weight > 0) in that many brews
        self.n_rounds = int(n_rounds)
        # ...or at least min_effects of them (0: as many as can be), or with
        # MEAN_EFFECTS the expected number of different ones instead
        self.min_effects = int(min_effects)
        self.wanted = np.flatnonzero(self.w > 0)

        # alpha upper bounds (reduced)
        self.alpha_UB = np.full(self.n_freeingr, int(alpha_UB), dtype=int)
        self.prob_UB = np.full(self.n_dipl, float(prob_UB), dtype=float)
        # Witch Points the recipe may cost (None: no limit), with the wonder's
        # discount of that level
        self.wp_max = wp_max
        self._wp_block = wp_block_table(
            self.sum_ingredients, WONDER_REDUCTION[wonder_level]
        )

        # objective cache
        self._obj_cache: dict[tuple[int, ...], float] = {}
        self._cache_max_size = int(cache_max_size)

    # ------------- greedy local search -------------
    def greedy(
        self, start_alpha: np.ndarray | None = None, allow_mass_moves: bool = True
    ) -> tuple[np.ndarray, float]:
        n_ingr = self.n_freeingr

        # ---- initialize alpha (reduced) ----
        if start_alpha is None:
            start_alpha = np.zeros(n_ingr, dtype=int)

        alpha = np.clip(start_alpha, 0, self.alpha_UB)

        # trim if needed
        while int(alpha.sum()) > self.sum_ingredients:
            candidates = np.where(alpha > 0)[0]
            if candidates.size == 0:
                break
            j = np.random.choice(candidates)
            alpha[j] -= 1
        # over the Witch Point limit: drop units of the most used ingredient
        # (saves the most)
        while not self._wp_ok(alpha):
            alpha[int(np.argmax(alpha))] -= 1

        # ---- initialize state (Sv, Sb, total) ----
        total = alpha.sum()
        Sv = self.V @ alpha.astype(float)
        Sb = self.B @ alpha.astype(float)
        current_val = self._objective_from_SvSb(Sv, Sb, total)

        # ---- steepest-ascent loop ----
        improved = True
        while improved:
            improved = False

            best_val = current_val
            best_add_j: int | None = None  # for +1 move
            best_swap_kj: tuple[int, int] | None = None  # for swap move (k -> j)

            # ---------- 1) +1 moves ----------
            if total < self.sum_ingredients:
                for j in range(n_ingr):
                    if alpha[j] >= self.alpha_UB[j]:
                        continue
                    if not self._wp_ok_after(alpha, None, j):
                        continue

                    Sv_n = Sv + self.V[:, j]
                    Sb_n = Sb + self.B[:, j]
                    val = self._objective_from_SvSb(Sv_n, Sb_n, total + 1)

                    if val > best_val:
                        best_val = val
                        best_add_j = j
                        best_swap_kj = None  # overwrite swap

            # ---------- 2) swap moves ----------
            if allow_mass_moves:
                # only k with alpha[k] > 0 can donate
                donors = np.where(alpha > 0)[0]
                if donors.size > 0:
                    for k in donors:
                        # removing from k is always allowed (since alpha[k] > 0)
                        Sv_minus = Sv - self.V[:, k]
                        Sb_minus = Sb - self.B[:, k]

                        for j in range(n_ingr):
                            if j == k:
                                continue
                            if alpha[j] >= self.alpha_UB[j]:
                                continue
                            if not self._wp_ok_after(alpha, k, j):
                                continue

                            Sv_n = Sv_minus + self.V[:, j]
                            Sb_n = Sb_minus + self.B[:, j]
                            val = self._objective_from_SvSb(Sv_n, Sb_n, total)

                            if val > best_val:
                                best_val = val
                                best_swap_kj = (k, j)
                                best_add_j = None  # overwrite add

            # ---- apply best move if improved ----
            if best_val > current_val + 1e-12:
                if best_add_j is not None:
                    j = best_add_j
                    alpha[j] += 1
                    Sv = Sv + self.V[:, j]
                    Sb = Sb + self.B[:, j]
                    total += 1

                elif best_swap_kj is not None:
                    k, j = best_swap_kj
                    alpha[k] -= 1
                    alpha[j] += 1
                    Sv = Sv - self.V[:, k] + self.V[:, j]
                    Sb = Sb - self.B[:, k] + self.B[:, j]
                    # total unchanged

                current_val = best_val
                improved = True

        # expand back to full alpha (12-length)
        alpha_full = np.zeros(self.n_ingredients, dtype=int)
        alpha_full[self.free_idx] = alpha
        return alpha_full, current_val

    # ------------- multistart + iterated local search -------------

    # Share of the budget spent on independent random starts; the rest kicks
    # the best recipe found (benchmarked on random recipes against the exact
    # optimum: better than random starts alone at every depth)
    EXPLORE_SHARE = 0.5
    # Units moved at random to escape a local optimum
    ILS_KICK = 6

    def _random_start(self) -> np.ndarray:
        """Random recipe (reduced) with 1..25 ingredients within the bounds."""
        alpha0 = np.zeros(self.n_freeingr, dtype=int)
        remaining = np.random.randint(1, self.sum_ingredients + 1)
        free = np.where(self.alpha_UB - alpha0 > 0)[0]
        while remaining > 0 and free.size > 0:
            j = np.random.choice(free)
            cap = self.alpha_UB[j] - alpha0[j]
            add = np.random.randint(1, min(remaining, cap) + 1)
            alpha0[j] += add
            remaining -= add
            if alpha0[j] >= self.alpha_UB[j]:
                free = free[free != j]  # remove full ingredient
        return alpha0

    def _kick(self, alpha: np.ndarray) -> np.ndarray:
        """Copy of alpha (reduced) with ILS_KICK random units moved."""
        alpha = alpha.copy()
        for _ in range(self.ILS_KICK):
            donors = np.where(alpha > 0)[0]
            if donors.size == 0:
                break
            k = np.random.choice(donors)
            j = np.random.randint(self.n_freeingr)
            if j != k and alpha[j] < self.alpha_UB[j]:
                alpha[k] -= 1
                alpha[j] += 1
        return alpha

    def multistart(
        self, n_starts: int = 20, allow_mass_moves: bool = True
    ) -> tuple[np.ndarray, float]:
        """Search with n_starts local searches in total.

        First half: climb from independent random recipes, keeping the best
        (explores the space). Second half: repeatedly kick that best recipe
        (move a few units) and climb again, keeping improvements (escapes the
        local optimum it is stuck in).
        """
        n_explore = max(1, round(n_starts * self.EXPLORE_SHARE))
        best_alpha = np.zeros(self.n_ingredients, dtype=int)
        best_val = -1e18

        for _ in range(n_explore):
            alpha, val = self.greedy(
                start_alpha=self._random_start(), allow_mass_moves=allow_mass_moves
            )
            if val > best_val:
                best_alpha, best_val = alpha, val

        for _ in range(n_starts - n_explore):
            alpha, val = self.greedy(
                start_alpha=self._kick(best_alpha[self.free_idx]),
                allow_mass_moves=allow_mass_moves,
            )
            if val > best_val + 1e-12:
                best_alpha, best_val = alpha, val

        return best_alpha, best_val

    def effect_probabilities(self, alpha_full: np.ndarray) -> np.ndarray:
        """
        Compute effect probabilities given full-length alpha (length n_ingredients)
        """
        alpha = alpha_full[self.free_idx]
        return self._effect_probabilities(alpha)

    def witch_points(self, alpha_full: Iterable[int]) -> int:
        """Witch Points of a recipe (any length), bought in the cheapest order."""
        return recipe_witch_points(alpha_full, self._wp_block)

    def _wp_ok(self, alpha: np.ndarray) -> bool:
        return self.wp_max is None or self.witch_points(alpha) <= self.wp_max

    def _wp_ok_after(self, alpha: np.ndarray, k: int | None, j: int) -> bool:
        """Within the Witch Point limit after moving a unit k -> j (k None: add one)."""
        if self.wp_max is None:
            return True
        counts = alpha.tolist()
        if k is not None:
            counts[k] -= 1
        counts[j] += 1
        return self.witch_points(counts) <= self.wp_max

    # ------------------ caching helpers ------------------

    def _key(self, alpha: np.ndarray) -> tuple[int, ...]:
        # alpha is reduced-length already; ensure int key
        return tuple(alpha.tolist())

    def _cache_put(self, key: tuple[int, ...], val: float) -> None:
        self._obj_cache[key] = val
        if len(self._obj_cache) > self._cache_max_size:
            self._obj_cache.clear()

    # ------------- core computations -------------

    def _compute_E(self, alpha: np.ndarray) -> np.ndarray:
        Sv = self.V @ alpha
        Sb = self.B @ alpha
        return np.maximum(Sv, 0.0) * (1.1**Sb)

    def _effect_probabilities(self, alpha: np.ndarray) -> np.ndarray:
        E = self._compute_E(alpha)
        total = alpha.sum()
        E_sum = E.sum()
        if E_sum <= 0 or total <= 0:
            return np.zeros_like(E)
        return 20.0 * E / E_sum * np.sqrt(total)

    def _objective_from_SvSb(self, Sv: np.ndarray, Sb: np.ndarray, total: int) -> float:
        """
        Compute objective given:
        Sv = V @ alpha   (shape: (n_dipl,))
        Sb = B @ alpha   (shape: (n_dipl,))
        total = sum(alpha)
        """
        if total <= 0:
            return self._search_value(np.zeros(self.n_dipl))

        # E = max(Sv, 0) * 1.1**Sb
        E = np.maximum(Sv, 0.0) * (1.1**Sb)
        E_sum = E.sum()
        if E_sum <= 0.0:
            return self._search_value(np.zeros(self.n_dipl))

        probs = 20.0 * E / E_sum * np.sqrt(total)
        return self._search_value(probs)

    def _objective_fast(self, alpha: np.ndarray) -> float:
        return self._search_value(self._effect_probabilities(alpha))

    def score(self, probs: np.ndarray) -> float:
        """Score of a recipe from its effect probabilities (%): the weighted
        probability, or with n_rounds the chance (%) of getting the effects,
        or their expected number (MEAN_EFFECTS: a count, not a %)."""
        probs = np.minimum(probs, self.prob_UB)
        if not self.n_rounds:
            return float(probs @ self.w)
        if self.min_effects == MEAN_EFFECTS:
            return expected_effects(probs[self.wanted] / 100.0, self.n_rounds)
        return 100.0 * rounds_probability(
            probs[self.wanted] / 100.0, self.n_rounds, self.min_effects
        )

    def _search_value(self, probs: np.ndarray) -> float:
        """score, except that recipes with no chance at all (too few wanted
        effects come out) rank in [-1, 0) by their weighted probability: the
        local search still finds its way up from them."""
        val = self.score(probs)
        if self.n_rounds and val <= 0.0:
            return float(np.minimum(probs, self.prob_UB) @ self.w) / 100.0 - 1.0
        return val

    def _objective(self, alpha: np.ndarray) -> float:
        key = self._key(alpha)
        cached = self._obj_cache.get(key)
        if cached is not None:
            return cached

        s = alpha.sum()
        # feasibility checks
        if (
            (alpha < 0).any()
            or (alpha > self.alpha_UB + 1e-9).any()
            or s > self.sum_ingredients
            or not self._wp_ok(alpha)
        ):
            val = -1e12
            self._cache_put(key, val)
            return val

        if s == 0:
            val = 0.0
            self._cache_put(key, val)
            return val

        val = self._objective_fast(alpha)
        self._cache_put(key, val)
        return val
