// JavaScript port of CauldronOptimizer (cauldron_optimizer/optimizer/optimizer.py),
// used by the long "complete effects" search, which runs in the browser.
// Same model: E_i = max(V_i·alpha, 0) * 1.1^(B_i·alpha),
// p_i = min(20 * E_i / sum(E) * sqrt(sum(alpha)), probUB), score = sum(w_i * p_i),
// or with nRounds brews the chance (%) of getting min(m, nRounds) different
// (or at least minEffects), or with minEffects -1 ("Media") the expected
// number of different wanted effects (a count, not a %)
// wanted effects (weight > 0), as rounds_probability in optimizer.py.
// Excluded effects (V row zeroed in Python) add nothing to E or to the score, so
// here they are simply left out: only the active effect rows are kept.
// Optional Witch Point limit (wpMax): the recipe, bought in the cheapest order
// (cauldron-order.js, with the wonder's discount of wonderLevel), may cost at
// most wpMax. That order adds whole ingredients, the most used first, so the
// cost only depends on the sorted amounts.

/* exported CauldronSolver */
const SUM_INGREDIENTS = 25;
// Search settings (same values as CauldronOptimizer in optimizer.py): share
// of the budget on random starts, and units moved by each kick
const EXPLORE_SHARE = 0.5;
const ILS_KICK = 6;
// n! for the rounds score (nRounds is at most a few dozen)
const FACTORIAL = [1];
for (let i = 1; i <= 30; i++) FACTORIAL.push(FACTORIAL[i - 1] * i);
// cauldron-order.js: a global in the page and the workers, a module in Node
// (only needed with a Witch Point limit)
const cauldronOrder =
  typeof cauldronPrice !== "undefined"
    ? { cauldronPrice, WONDER_REDUCTION }
    : typeof require !== "undefined"
      ? require("./cauldron-order.js")
      : null;

class CauldronSolver {
  // B, V: full matrices (rows = effects, cols = 12 ingredients)
  // effects: indices of the active effects; weights: their weights (same order)
  constructor({
    B, V, effects, weights, premiumIngr = [], alphaUB = 25, probUB = 100, wpMax = null, wonderLevel = 0,
    nRounds = 0, minEffects = 0,
  }) {
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
    // Brews to get the wanted effects in (0: score by the weights), and the
    // wanted effects (positions among the active ones), with scratch buffers
    this.nRounds = nRounds;
    this.wanted = [];
    this.w.forEach((x, i) => {
      if (x > 0) this.wanted.push(i);
    });
    this._q = new Float64Array(this.wanted.length);
    this._e = new Float64Array(nRounds + 1);
    this._poly = new Float64Array(nRounds + 1);
    this._next = new Float64Array(nRounds + 1);
    this._f = new Float64Array(nRounds + 1);
    // "At least k" of the wanted effects, only below as many as can be
    // (min(m, nRounds)); 0: all of those
    const most = Math.min(this.wanted.length, nRounds);
    this.atLeast = minEffects > 0 && minEffects < most ? minEffects : 0;
    this.mean = nRounds > 0 && minEffects === -1;
    this._by = new Float64Array((this.atLeast + 1) * (nRounds + 1));
    this._t = new Float64Array(nRounds + 1);
    // Wanted effects the score asks for (k), for a cheap upper bound of it:
    // k different wanted effects need at least k brews with a wanted effect,
    // so the score is at most P(Binomial(nRounds, s) >= k), s = sum of their
    // chances. The exact search skips the full formula for recipes whose
    // bound cannot beat its best one (pruneBelow; -Infinity: never)
    this.needK = this.atLeast || most;
    this.binom = Array.from({ length: nRounds + 1 }, (_, j) => {
      let c = 1;
      for (let i = 1; i <= j; i++) c = (c * (nRounds - j + i)) / i;
      return c;
    });
    this.pruneBelow = -Infinity;

    // Witch Point limit (Infinity: none). wpBlock[r][c]: price of c copies of
    // one ingredient added right after r others
    this.wpMax = wpMax == null ? Infinity : wpMax;
    if (this.wpMax < Infinity) {
      const reduction = cauldronOrder.WONDER_REDUCTION[wonderLevel] ?? 0;
      this.wpBlock = Array.from({ length: SUM_INGREDIENTS + 1 }, (_, r) => {
        const row = [0];
        for (let c = 1; r + c <= SUM_INGREDIENTS; c++) {
          row.push(row[c - 1] + cauldronOrder.cauldronPrice(r + c, c, { reduction }));
        }
        return row;
      });
      this._sorted = new Int32Array(this.n);
    }
  }

  // Witch Points of a reduced recipe, bought in the cheapest order
  witchPoints(alpha) {
    const a = this._sorted;
    a.set(alpha);
    a.sort(); // ascending: the most used last
    let cost = 0;
    let rank = 0;
    for (let i = a.length - 1; i >= 0 && a[i] > 0; i--) {
      cost += this.wpBlock[rank][a[i]];
      rank += a[i];
    }
    return cost;
  }

  // Within the Witch Point limit after moving a unit k -> j (k = -1: adding one)
  wpOk(alpha, k, j) {
    if (this.wpMax === Infinity) return true;
    alpha[j] += 1;
    if (k >= 0) alpha[k] -= 1;
    const ok = this.witchPoints(alpha) <= this.wpMax;
    alpha[j] -= 1;
    if (k >= 0) alpha[k] += 1;
    return ok;
  }

  // Chance that nRounds brews give min(m, nRounds) different wanted effects;
  // q: chance (0-1) of each of the m wanted effects in one brew (same as
  // rounds_probability in optimizer.py)
  roundsProbability(q) {
    const n = this.nRounds;
    const m = q.length;
    if (this.atLeast) return this.atLeastProbability(q);
    if (m >= n) {
      // e[j]: sum of the products of every j chances seen so far
      const e = this._e.fill(0);
      e[0] = 1;
      for (let i = 0; i < m; i++) for (let j = n; j > 0; j--) e[j] += q[i] * e[j - 1];
      return FACTORIAL[n] * e[n];
    }
    // n! [x^n] e^(r x) prod(e^(q_i x) - 1), r = 1 - sum(q)
    let r = 1;
    for (let i = 0; i < m; i++) r -= q[i];
    r = Math.max(r, 0);
    let poly = this._poly;
    let next = this._next;
    const f = this._f; // q_i^j / j!
    poly[0] = 1;
    for (let j = 1; j <= n; j++) poly[j] = (poly[j - 1] * r) / j;
    for (let i = 0; i < m; i++) {
      f[0] = 1;
      for (let j = 1; j <= n; j++) f[j] = (f[j - 1] * q[i]) / j;
      for (let k = 0; k <= n; k++) {
        let c = 0;
        for (let a = 0; a < k; a++) c += poly[a] * f[k - a];
        next[k] = c;
      }
      [poly, next] = [next, poly];
    }
    return FACTORIAL[n] * poly[n];
  }

  // Chance that nRounds brews give at least atLeast different wanted effects
  // (rounds_probability in optimizer.py, k below min(m, n)): n! [x^n] of the
  // terms with at least k factors (e^(q_i x) - 1) in
  // e^(r x) prod(1 + (e^(q_i x) - 1)). by[j]: coefficients of the terms with
  // j factors, the last bucket k or more
  atLeastProbability(q) {
    const n = this.nRounds;
    const k = this.atLeast;
    const N1 = n + 1;
    let r = 1;
    for (let i = 0; i < q.length; i++) r -= q[i];
    r = Math.max(r, 0);
    const by = this._by.fill(0);
    by[0] = 1;
    for (let d = 1; d <= n; d++) by[d] = (by[d - 1] * r) / d;
    const f = this._f; // e^(q_i x) - 1: q_i^d / d!, no constant term
    const t = this._t;
    for (let i = 0; i < q.length; i++) {
      f[0] = 0;
      let pw = 1;
      for (let d = 1; d <= n; d++) {
        pw = (pw * q[i]) / d;
        f[d] = pw;
      }
      // From the top bucket down, so each reads the one below unchanged
      for (let j = k; j >= 1; j--) {
        const base = j * N1;
        const prev = (j - 1) * N1;
        for (let d = 0; d <= n; d++) t[d] = (j === k ? by[base + d] : 0) + by[prev + d];
        for (let d = 1; d <= n; d++) {
          let c = 0;
          for (let a = 0; a < d; a++) c += t[a] * f[d - a];
          by[base + d] += c;
        }
      }
    }
    return FACTORIAL[n] * by[k * N1 + n];
  }

  objective(Sv, Sb, total) {
    if (total <= 0) return this.nRounds ? -1 : 0;
    const m = this.m;
    let eSum = 0;
    // reuse a scratch buffer for E
    const E = this._E || (this._E = new Float64Array(m));
    for (let i = 0; i < m; i++) {
      const e = Sv[i] > 0 ? Sv[i] * Math.pow(1.1, Sb[i]) : 0;
      E[i] = e;
      eSum += e;
    }
    if (eSum <= 0) return this.nRounds ? -1 : 0;
    const f = (20 * Math.sqrt(total)) / eSum;
    let val = 0;
    for (let i = 0; i < m; i++) val += this.w[i] * Math.min(E[i] * f, this.probUB);
    if (!this.nRounds) return val;
    const q = this._q;
    let s = 0;
    for (let k = 0; k < q.length; k++) {
      q[k] = Math.min(E[this.wanted[k]] * f, this.probUB) / 100;
      s += q[k];
    }
    if (this.mean) {
      // Expected number of different wanted effects: sum of 1 - (1 - q)^n
      let count = 0;
      for (let k = 0; k < q.length; k++) {
        let miss = 1;
        for (let j = 0; j < this.nRounds; j++) miss *= 1 - q[k];
        count += 1 - miss;
      }
      return count > 0 ? count : val / 100 - 1;
    }
    if (this.pruneBelow > -Infinity) {
      // Upper bound: at least needK of the nRounds brews give a wanted effect
      const n = this.nRounds;
      s = Math.min(s, 1);
      // Sum over j >= needK of C(n, j) s^j (1 - s)^(n - j), from j = n down
      // (powers by multiplying, no Math.pow)
      const r = 1 - s;
      let sj = 1;
      for (let j = 0; j < this.needK; j++) sj *= s; // s^needK
      let bound = 0;
      let rj = 1; // (1 - s)^(n - j)
      const terms = this._terms || (this._terms = new Float64Array(n + 1));
      for (let j = this.needK; j <= n; j++) {
        terms[j] = sj;
        sj *= s;
      }
      for (let j = n; j >= this.needK; j--) {
        bound += this.binom[j] * terms[j] * rj;
        rj *= r;
      }
      // Cannot beat the best one (margin for rounding): no need for the rest
      if (100 * bound + 1e-9 <= this.pruneBelow) return 100 * bound;
    }
    const p = this.roundsProbability(q);
    // No chance at all (too few wanted effects come out): rank in [-1, 0) by
    // the weighted probability, so the local search still finds its way up
    return p > 0 ? 100 * p : val / 100 - 1;
  }

  greedy(alpha) {
    const { n, m, Vc, Bc, alphaUB } = this;
    // Over the Witch Point limit: drop units of the most used ingredient (saves the most)
    while (this.wpMax < Infinity && this.witchPoints(alpha) > this.wpMax) {
      let top = 0;
      for (let j = 1; j < n; j++) if (alpha[j] > alpha[top]) top = j;
      alpha[top] -= 1;
    }
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
          if (alpha[j] >= alphaUB || !this.wpOk(alpha, -1, j)) continue;
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
          if (j === k || alpha[j] >= alphaUB || !this.wpOk(alpha, k, j)) continue;
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

  // Random recipe (reduced) with 1..25 ingredients within the bounds
  randomStart() {
    const { n, alphaUB } = this;
    const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    const alpha = new Int32Array(n);
    let remaining = randInt(1, SUM_INGREDIENTS);
    let free = alphaUB > 0 ? [...Array(n).keys()] : [];
    while (remaining > 0 && free.length) {
      const j = free[randInt(0, free.length - 1)];
      const add = randInt(1, Math.min(remaining, alphaUB - alpha[j]));
      alpha[j] += add;
      remaining -= add;
      if (alpha[j] >= alphaUB) free = free.filter((x) => x !== j);
    }
    return alpha;
  }

  // Copy of alpha with ILS_KICK random units moved
  kick(alpha) {
    const a = Int32Array.from(alpha);
    for (let k = 0; k < ILS_KICK; k++) {
      const donors = [];
      for (let j = 0; j < this.n; j++) if (a[j] > 0) donors.push(j);
      if (!donors.length) break;
      const from = donors[Math.floor(Math.random() * donors.length)];
      const to = Math.floor(Math.random() * this.n);
      if (to !== from && a[to] < this.alphaUB) {
        a[from] -= 1;
        a[to] += 1;
      }
    }
    return a;
  }

  // nStarts local searches in total (same as the Python
  // CauldronOptimizer.multistart): first half from independent random
  // recipes, keeping the best; second half kicks that best recipe and climbs
  // again, keeping improvements. Returns {score, recipe} (recipe: 12 amounts)
  multistart(nStarts) {
    const nExplore = Math.max(1, Math.round(nStarts * EXPLORE_SHARE));
    let bestVal = -1e18;
    let bestAlpha = new Int32Array(this.n);
    for (let i = 0; i < nExplore; i++) {
      const alpha = this.randomStart();
      const val = this.greedy(alpha);
      if (val > bestVal) {
        bestVal = val;
        bestAlpha = alpha;
      }
    }
    for (let i = nExplore; i < nStarts; i++) {
      const alpha = this.kick(bestAlpha);
      const val = this.greedy(alpha);
      if (val > bestVal + 1e-12) {
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

  // Guaranteed optimum: checks every recipe (each free ingredient 0..alphaUB,
  // total <= 25, within the Witch Point limit). With 4 ingredients avoided that is ~12-14 million recipes,
  // about 1-2 s. Ties keep the first recipe found, so the same settings
  // always give the same recipe. onProgress(fraction) is called now and then.
  // Returns {score, recipe} (recipe: 12 amounts)
  exact(onProgress = () => {}) {
    const { n, m, Vc, Bc, wpMax } = this;
    const ub = Math.min(this.alphaUB, SUM_INGREDIENTS);
    const Sv = new Float64Array(m);
    const Sb = new Float64Array(m);
    const alpha = new Int32Array(n);
    let bestVal = -1e18;
    let bestAlpha = new Int32Array(n);
    const self = this;

    function visit(j, total) {
      if (j === n) {
        self.pruneBelow = bestVal; // recipes that cannot beat it are cut short
        const val = self.objective(Sv, Sb, total);
        if (val > bestVal + 1e-12) {
          bestVal = val;
          bestAlpha = Int32Array.from(alpha);
        }
        return;
      }
      const maxHere = Math.min(ub, SUM_INGREDIENTS - total);
      let x = 0;
      for (; x <= maxHere; x++) {
        alpha[j] = x;
        // A unit more never costs less: neither will the next amounts
        if (x > 0 && wpMax < Infinity && self.witchPoints(alpha) > wpMax) break;
        visit(j + 1, total + x);
        if (j === 0) onProgress((x + 1) / (maxHere + 1));
        // next amount: one more unit of ingredient j
        for (let i = 0; i < m; i++) {
          Sv[i] += Vc[j][i];
          Sb[i] += Bc[j][i];
        }
      }
      // back to 0 units of ingredient j (x were added)
      for (let i = 0; i < m; i++) {
        Sv[i] -= x * Vc[j][i];
        Sb[i] -= x * Bc[j][i];
      }
      alpha[j] = 0;
    }

    if (n > 0) visit(0, 0);
    this.pruneBelow = -Infinity; // other searches use the full score
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
