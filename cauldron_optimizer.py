"""
Caldero optimizer for finding optimal ingredient combinations.

This module provides the CalderoOptimizer class for optimizing potion recipes
based on effect weights, ingredient constraints, and probability bounds.
It includes greedy local search and multi-start optimization methods.
"""

from pathlib import Path

import numpy as np

# directory where caldero_optimizer.py lives
BASE_DIR = Path(__file__).resolve().parent

B = np.loadtxt(BASE_DIR / "B_values.csv", delimiter=",", skiprows=1)
V = np.loadtxt(BASE_DIR / "V_values.csv", delimiter=",", skiprows=1)


class CauldronOptimizer:
    """
    B: (n_dipl, n_ingr) matrix.
    V: (n_dipl, n_ingr) matrix.
    effect_weights: (n_dipl ,) how much you want the efect (nothing=0, all=1).
    premium_ingr: list of premium ingredient indices forced to alpha[j] = 0.
    alpha_UB: (n_ingr,) per-ingredient upper bounds, this helps to avoids extremely
            expensive recepies.
    prob_UB: (n_dipl,) helps to avoid extremely high probabilities for some effects.
            You only can get one effect, so no need to have super high probabilities.
            It is better to spread the prob across effects.
    max_sum: constraint sum(alpha) <= max_sum.
    """

    sum_ingredients = 25
    B_full: np.ndarray = np.asarray(B, dtype=float)
    V_full: np.ndarray = np.asarray(V, dtype=float)
    max_ndiplomas, n_ingredients = B_full.shape

    def __init__(
        self,
        effect_weights: np.ndarray,
        premium_ingr=None,
        alpha_UB=None,
        prob_UB=None,
    ):

        effect_weights = np.asarray(effect_weights, dtype=float)
        self.n_dipl = len(effect_weights)
        assert self.n_dipl <= self.max_ndiplomas, "n_dipl  > number of rows in B/V"

        # truncate matrices to the diplomas we care about
        self.B = self.B_full[: self.n_dipl]
        self.V = self.V_full[: self.n_dipl]

        # normalized weights
        self.w = effect_weights / effect_weights.sum()

        # constraints
        self.fixed_zero = set(premium_ingr or [])

        # alpha upper bounds
        if alpha_UB is None:
            self.alpha_UB = np.full(
                shape=self.n_ingredients, fill_value=self.sum_ingredients, dtype=int
            )
        else:
            a_ub = np.asarray(alpha_UB, dtype=int)
            if a_ub.ndim == 0:
                a_ub = np.full(self.n_ingredients, int(a_ub), dtype=int)
            assert len(a_ub) == self.n_ingredients
            self.alpha_UB = a_ub

        # prob upper bounds
        if prob_UB is None:
            self.prob_UB = np.full(self.n_dipl, 100.0, dtype=float)
        else:
            p_ub = np.asarray(prob_UB, dtype=float)
            if p_ub.ndim == 0:
                p_ub = np.full(self.n_dipl, float(p_ub), dtype=float)
            assert len(p_ub) == self.n_dipl
            self.prob_UB = p_ub

        # apply fixed_zero on alpha_UB
        for j in self.fixed_zero:
            self.alpha_UB[j] = 0

    # ------------- core computations -------------

    def compute_E(self, alpha: np.ndarray) -> np.ndarray:
        """Compute E values for given alpha."""
        alpha = np.asarray(alpha, dtype=float)
        Sv = self.V @ alpha
        Sb = self.B @ alpha
        return np.maximum(Sv, 0.0) * (1.1**Sb)

    def effect_probabilities(self, alpha: np.ndarray) -> np.ndarray:
        """Compute effect probabilities for given alpha."""
        alpha = np.asarray(alpha, dtype=float)
        E = self.compute_E(alpha)
        total = alpha.sum()
        E_sum = E.sum()
        if E_sum <= 0 or total <= 0:
            return np.zeros_like(E)
        probs = 20.0 * E / E_sum * np.sqrt(total)
        return probs

    def objective(self, alpha: np.ndarray) -> float:
        """Evaluate objective function for given alpha."""
        alpha = np.asarray(alpha, dtype=float).copy()

        # fixed zeros
        for j in self.fixed_zero:
            alpha[j] = 0.0

        # constraints
        if (alpha < 0).any():
            return -1e12
        if (alpha > self.alpha_UB + 1e-9).any():
            return -1e12
        if alpha.sum() > self.sum_ingredients:
            return -1e12

        probs = self.effect_probabilities(alpha)
        probs = np.minimum(probs, self.prob_UB)

        return float(probs @ self.w)

    # ------------- greedy local search -------------

    def greedy(
        self,
        start_alpha: np.ndarray | None = None,
        allow_mass_moves: bool = True,
    ):
        """
        Steepest-ascent search:
          0 <= alpha[j] <= alpha_UB[j].
          sum(alpha) <= max_sum.
          alpha[j] = 0 for j in fixed_zero.
        """
        n_ingr = self.n_ingredients

        # initial alpha
        if start_alpha is None:
            alpha = np.zeros(n_ingr, dtype=int)
        else:
            alpha = np.asarray(start_alpha, dtype=int).copy()

        # enforce bounds and fixed zeros
        alpha = np.clip(alpha, 0, self.alpha_UB)

        # trim if above sum limit
        while alpha.sum() > self.sum_ingredients:
            candidates = [j for j in range(n_ingr) if j not in self.fixed_zero and alpha[j] > 0]
            if not candidates:
                break
            j = np.random.choice(candidates)
            alpha[j] -= 1

        current_val = self.objective(alpha)

        improved = True
        while improved:
            improved = False
            best_neighbor = alpha
            best_val = current_val
            total = alpha.sum()

            # 1) +1 moves
            if total < self.sum_ingredients:
                for j in range(n_ingr):
                    if j in self.fixed_zero:
                        continue
                    if alpha[j] >= self.alpha_UB[j]:
                        continue
                    neighbor = alpha.copy()
                    neighbor[j] += 1
                    val = self.objective(neighbor)
                    if val > best_val:
                        best_val = val
                        best_neighbor = neighbor

            # 2) mass moves: -1 on k, +1 on j
            if allow_mass_moves:
                movable = [j for j in range(n_ingr) if j not in self.fixed_zero]
                for k in movable:
                    if alpha[k] <= 0:
                        continue
                    for j in movable:
                        if j == k or alpha[j] >= self.alpha_UB[j]:
                            continue
                        neighbor = alpha.copy()
                        neighbor[k] -= 1
                        neighbor[j] += 1
                        val = self.objective(neighbor)
                        if val > best_val:
                            best_val = val
                            best_neighbor = neighbor

            if best_val > current_val + 1e-12:
                alpha = best_neighbor
                current_val = best_val
                improved = True

        return alpha, current_val

    # ------------- multi-start wrapper -------------

    def multistart(
        self,
        n_starts: int = 20,
        allow_mass_moves: bool = True,
    ):
        """Run multi-start greedy optimization to find the best recipe."""
        best_alpha = None
        best_val = -1e18
        n_ingr = self.n_ingredients

        for _ in range(n_starts):
            alpha0 = np.zeros(n_ingr, dtype=int)
            free_idx = [
                j for j in range(n_ingr) if j not in self.fixed_zero and self.alpha_UB[j] > 0
            ]

            remaining = np.random.randint(1, self.sum_ingredients + 1)
            while remaining > 0 and free_idx:
                j = np.random.choice(free_idx)
                max_add = min(remaining, self.alpha_UB[j] - alpha0[j])
                if max_add <= 0:
                    free_idx = [k for k in free_idx if self.alpha_UB[k] - alpha0[k] > 0]
                    continue
                add = np.random.randint(1, max_add + 1)
                alpha0[j] += add
                remaining -= add

            alpha, val = self.greedy(start_alpha=alpha0, allow_mass_moves=allow_mass_moves)
            if val > best_val:
                best_val = val
                best_alpha = alpha

        return best_alpha, best_val
