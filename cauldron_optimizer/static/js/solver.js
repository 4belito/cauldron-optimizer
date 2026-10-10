// JavaScript port of CauldronOptimizer (cauldron_optimizer/optimizer/optimizer.py),
// used by the long "complete effects" search, which runs in the browser.
// Same model: E_i = max(V_i·alpha, 0) * 1.1^(B_i·alpha),
// p_i = min(20 * E_i / sum(E) * sqrt(sum(alpha)), probUB), score = sum(w_i * p_i).
// Excluded effects (V row zeroed in Python) add nothing to E or to the score, so
// here they are simply left out: only the active effect rows are kept.

/* exported CauldronSolver */
const SUM_INGREDIENTS = 25;

class CauldronSolver {
  // B, V: full matrices (rows = effects, cols = 12 ingredients)
  // effects: indices of the active effects; weights: their weights (same order)
  constructor({ B, V, effects, weights, premiumIngr = [], alphaUB = 25, probUB = 100 }) {
    this.nIngredients = B[0].length;
    const avoided = new Set(premiumIngr);
    this.freeIdx = [];
    for (let j = 0; j < this.nIngredients; j++) if (!avoided.has(j)) this.freeIdx.push(j);
    this.n = this.freeIdx.length;
    this.m = effects.length;

    // Reduced matrices, column-major per free ingredient: col[j] = rows of that ingredient
    this.Vc = this.freeIdx.map((j) => Float64Array.from(effects, (e) => V[e][j]));
    this.Bc = this.freeIdx.map((j) => Float64Array.from(effects, (e) => B[e][j]));

    const s = weights.reduce((a, b) => a + b, 0);
    this.w = Float64Array.from(weights, (x) => (s === 0 ? 1 / this.m : x / s));
    this.alphaUB = Math.min(alphaUB, SUM_INGREDIENTS);
    this.probUB = probUB;
    this.Sv = new Float64Array(this.m);
    this.Sb = new Float64Array(this.m);
  }

  objective(Sv, Sb, total) {
    if (total <= 0) return 0;
    const m = this.m;
    let eSum = 0;
    // reuse a scratch buffer for E
    const E = this._E || (this._E = new Float64Array(m));
    for (let i = 0; i < m; i++) {
      const e = Sv[i] > 0 ? Sv[i] * Math.pow(1.1, Sb[i]) : 0;
      E[i] = e;
      eSum += e;
    }
    if (eSum <= 0) return 0;
    const f = (20 * Math.sqrt(total)) / eSum;
    let val = 0;
    for (let i = 0; i < m; i++) val += this.w[i] * Math.min(E[i] * f, this.probUB);
    return val;
  }

  greedy(alpha) {
    const { n, m, Vc, Bc, alphaUB } = this;
    const Sv = new Float64Array(m);
    const Sb = new Float64Array(m);
    let total = 0;
    for (let j = 0; j < n; j++) {
      const a = alpha[j];
      if (!a) continue;
      total += a;
      for (let i = 0; i < m; i++) {
        Sv[i] += a * Vc[j][i];
        Sb[i] += a * Bc[j][i];
      }
    }
    let current = this.objective(Sv, Sb, total);
    const tv = new Float64Array(m);
    const tb = new Float64Array(m);

    for (;;) {
      let best = current;
      let addJ = -1;
      let swapK = -1;
      let swapJ = -1;

      // +1 moves
      if (total < SUM_INGREDIENTS) {
        for (let j = 0; j < n; j++) {
          if (alpha[j] >= alphaUB) continue;
          for (let i = 0; i < m; i++) {
            tv[i] = Sv[i] + Vc[j][i];
            tb[i] = Sb[i] + Bc[j][i];
          }
          const val = this.objective(tv, tb, total + 1);
          if (val > best) {
            best = val;
            addJ = j;
            swapK = -1;
          }
        }
      }
      // swap moves k -> j
      for (let k = 0; k < n; k++) {
        if (alpha[k] <= 0) continue;
        for (let j = 0; j < n; j++) {
          if (j === k || alpha[j] >= alphaUB) continue;
          for (let i = 0; i < m; i++) {
            tv[i] = Sv[i] - Vc[k][i] + Vc[j][i];
            tb[i] = Sb[i] - Bc[k][i] + Bc[j][i];
          }
          const val = this.objective(tv, tb, total);
          if (val > best) {
            best = val;
            swapK = k;
            swapJ = j;
            addJ = -1;
          }
        }
      }

      if (!(best > current + 1e-12)) break;
      if (addJ >= 0) {
        alpha[addJ] += 1;
        total += 1;
        for (let i = 0; i < m; i++) {
          Sv[i] += Vc[addJ][i];
          Sb[i] += Bc[addJ][i];
        }
      } else {
        alpha[swapK] -= 1;
        alpha[swapJ] += 1;
        for (let i = 0; i < m; i++) {
          Sv[i] += Vc[swapJ][i] - Vc[swapK][i];
          Sb[i] += Bc[swapJ][i] - Bc[swapK][i];
        }
      }
      current = best;
    }
    return current;
  }

  // Random starts + greedy; returns {score, recipe} (recipe: 12 amounts)
  multistart(nStarts) {
    const { n, alphaUB } = this;
    const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    let bestVal = -1e18;
    let bestAlpha = new Int32Array(n);
    for (let s = 0; s < nStarts; s++) {
      const alpha = new Int32Array(n);
      let remaining = randInt(1, SUM_INGREDIENTS);
      let free = [];
      for (let j = 0; j < n; j++) if (alphaUB > 0) free.push(j);
      while (remaining > 0 && free.length) {
        const j = free[randInt(0, free.length - 1)];
        const add = randInt(1, Math.min(remaining, alphaUB - alpha[j]));
        alpha[j] += add;
        remaining -= add;
        if (alpha[j] >= alphaUB) free = free.filter((x) => x !== j);
      }
      const val = this.greedy(alpha);
      if (val > bestVal) {
        bestVal = val;
        bestAlpha = alpha;
      }
    }
    const recipe = new Array(this.nIngredients).fill(0);
    this.freeIdx.forEach((j, r) => {
      recipe[j] = bestAlpha[r];
    });
    return { score: bestVal, recipe };
  }

  // Probabilities of the active effects for a full 12-length recipe
  probabilities(recipe) {
    const Sv = new Float64Array(this.m);
    const Sb = new Float64Array(this.m);
    let total = 0;
    this.freeIdx.forEach((j, r) => {
      const a = recipe[j];
      total += a;
      for (let i = 0; i < this.m; i++) {
        Sv[i] += a * this.Vc[r][i];
        Sb[i] += a * this.Bc[r][i];
      }
    });
    let eSum = 0;
    const E = Array.from({ length: this.m }, (_, i) => {
      const e = Sv[i] > 0 ? Sv[i] * Math.pow(1.1, Sb[i]) : 0;
      eSum += e;
      return e;
    });
    if (eSum <= 0 || total <= 0) return E.map(() => 0);
    return E.map((e) => (20 * e) / eSum * Math.sqrt(total));
  }
}

if (typeof module !== "undefined") module.exports = { CauldronSolver };
