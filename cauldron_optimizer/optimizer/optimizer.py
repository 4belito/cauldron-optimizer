from pathlib import Path

import numpy as np

BASE_DIR = Path(__file__).resolve().parent
B = np.loadtxt(BASE_DIR / "B_values.csv", delimiter=",", skiprows=1)
V = np.loadtxt(BASE_DIR / "V_values.csv", delimiter=",", skiprows=1)


class CauldronOptimizer:
    sum_ingredients = 25
    B_full: np.ndarray = np.asarray(B, dtype=float)
    V_full: np.ndarray = np.asarray(V, dtype=float)
    max_ndiplomas, n_ingredients = B_full.shape

    def __init__(
        self,
        effect_weights: np.ndarray,
        premium_ingr: list[int] = [],
        alpha_UB: int | None = None,
        prob_UB: int = 100,
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
        self.V = self.V_full[: self.n_dipl, self.free_idx]

        # normalized weights (guard divide by 0)
        s = effect_weights.sum()
        if s == 0:
            effect_weights = np.full(self.n_dipl, 1.0 / self.n_dipl, dtype=float)
        self.w = effect_weights / s

        # alpha upper bounds (reduced)
        self.alpha_UB = np.full(self.n_freeingr, int(alpha_UB), dtype=int)
        self.prob_UB = np.full(self.n_dipl, float(prob_UB), dtype=float)

        # objective cache
        self._obj_cache: dict[tuple[int, ...], float] = {}
        self._cache_max_size = int(cache_max_size)

    # ------------- greedy local search -------------
    def greedy(self, start_alpha: np.ndarray | None = None, allow_mass_moves: bool = True):
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
            best_add_j = None  # for +1 move
            best_swap_kj = None  # for swap move (k -> j)

            # ---------- 1) +1 moves ----------
            if total < self.sum_ingredients:
                for j in range(n_ingr):
                    if alpha[j] >= self.alpha_UB[j]:
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

                else:
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

    # ------------- multi-start wrapper -------------

    def multistart(self, n_starts: int = 20, allow_mass_moves: bool = True):
        best_alpha = None
        best_val = -1e18
        n_ingr = self.n_freeingr

        for _ in range(n_starts):
            alpha0 = np.zeros(n_ingr, dtype=int)
            remaining = np.random.randint(1, self.sum_ingredients + 1)

            # avoid infinite loops if all UBs reached

            free = np.where(self.alpha_UB - alpha0 > 0)[0]
            while remaining > 0 and free.size > 0:
                j = np.random.choice(free)
                cap = self.alpha_UB[j] - alpha0[j]
                add = np.random.randint(1, min(remaining, cap) + 1)
                alpha0[j] += add
                remaining -= add
                if alpha0[j] >= self.alpha_UB[j]:
                    free = free[free != j]  # remove full ingredien

            alpha, val = self.greedy(start_alpha=alpha0, allow_mass_moves=allow_mass_moves)
            if val > best_val:
                best_val = val
                best_alpha = alpha

        return best_alpha, best_val

    def effect_probabilities(self, alpha_full: np.ndarray) -> np.ndarray:
        """
        Compute effect probabilities given full-length alpha (length n_ingredients)
        """
        alpha = alpha_full[self.free_idx]
        return self._effect_probabilities(alpha)

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
            return 0.0

        # E = max(Sv, 0) * 1.1**Sb
        E = np.maximum(Sv, 0.0) * (1.1**Sb)
        E_sum = E.sum()
        if E_sum <= 0.0:
            return 0.0

        probs = 20.0 * E / E_sum * np.sqrt(total)
        probs = np.minimum(probs, self.prob_UB)
        return probs @ self.w

    def _objective_fast(self, alpha: np.ndarray) -> float:
        probs = self.effect_probabilities(alpha)
        probs = np.minimum(probs, self.prob_UB)
        return probs @ self.w

    def _objective(self, alpha: np.ndarray) -> float:
        key = self._key(alpha)
        cached = self._obj_cache.get(key)
        if cached is not None:
            return cached

        s = alpha.sum()
        # feasibility checks
        if (alpha < 0).any() or (alpha > self.alpha_UB + 1e-9).any() or s > self.sum_ingredients:
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
