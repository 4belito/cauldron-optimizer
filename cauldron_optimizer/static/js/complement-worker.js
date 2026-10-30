// Web Worker for the "complete effects" search (started by complement.js).
//
// The user chose k < 10 effects (with weights). The outer loop tries sets of
// 10 - k complementary effects among the other unlocked effects (weight 0):
// every one (effect_exact), or those met climbing from random sets (see
// below, effect_depth climbs); the inner loop tries every set of n_avoid avoided ingredients (495 sets of
// 4, the default). Each run is a
// full multistart search (solver.js), or with "Óptima" (params.exact) the
// exact search, which checks every recipe: much slower, the same as "Buscar
// receta" gives.
//
// The sets are visited in a shuffled order that covers the whole space evenly
// (step -> set (a * step + b) mod N, a coprime with N, so each set is visited
// exactly once): stopping early leaves a fair sample of all the effects, not
// just the first ones. A complementary set is ranked by its average best score
// over its ingredient sets. The order is fixed by (a, b), saved with the
// state, so the position alone says what is done: stopping and resuming never
// repeats a run. The worker posts its whole state
// a few times per second; the page keeps the last one and saves it.

importScripts("cauldron-order.js", "solver.js");

const N_INGREDIENTS = 12;
// Avoided ingredients per run, for searches saved before it was a setting
const DEFAULT_AVOIDED = 4;
// Best sets kept per list (mean, minimum, maximum): the user picks one
const TOP_SIZE = 5;
const POST_EVERY_MS = 300;

function binom(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

// All k-subsets of [0..n) in lexicographic order
function combinations(n, k) {
  const out = [];
  const c = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    out.push([...c]);
    let i = k - 1;
    while (i >= 0 && c[i] === n - k + i) i--;
    if (i < 0) return out;
    c[i]++;
    for (let j = i + 1; j < k; j++) c[j] = c[j - 1] + 1;
  }
}

// The rank-th k-subset of [0..n) in lexicographic order
function unrank(n, k, rank) {
  const c = [];
  let x = 0;
  for (let i = 0; i < k; i++) {
    for (;;) {
      const count = binom(n - x - 1, k - i - 1);
      if (rank < count) break;
      rank -= count;
      x++;
    }
    c.push(x);
    x++;
  }
  return c;
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

// Shuffled visiting order of N sets: a random multiplier coprime with N
// (so step -> (a * step + b) mod N is a permutation) and a random offset
function shuffledOrder(N) {
  if (N <= 2) return { a: 1, b: 0 };
  let a;
  do {
    // Far from 1 and N - 1, so consecutive steps land far apart
    a = Math.floor(N * (0.2 + 0.6 * Math.random()));
  } while (gcd(a, N) !== 1);
  return { a, b: Math.floor(Math.random() * N) };
}

// Add entry to a list kept sorted by key (highest first), at most TOP_SIZE
function keepTop(list, entry, key) {
  list.push(entry);
  list.sort((a, b) => key(b) - key(a));
  if (list.length > TOP_SIZE) list.length = TOP_SIZE;
}

// Sets of effects tried per climb, as a share of a set's neighbors (one
// effect swapped for another): measured (see estimatedSetsPerClimb in
// complement.js, which uses the same value)
const SETS_PER_CLIMB = 1;

const keyOf = (comp) => comp.join(",");
const sortedSet = (comp) => [...comp].sort((a, b) => a - b);

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function run({ B, V, params, state }) {
  const {
    n, effects, weights, alpha_ub: alphaUB, prob_ub: probUB, depth, wp_max: wpMax, wonder_level: wonderLevel,
  } = params;
  // "Todos en": scored by the chance of getting the wanted effects within
  // nRounds goblets (searches saved before it have none: by the weights)
  const nRounds = params.n_rounds || 0;
  // ...at least this many of them (0, or none saved: all that can be)
  const minEffects = params.min_effects || 0;
  const chosen = new Set(effects);
  const candidates = [];
  for (let i = 0; i < n; i++) if (!chosen.has(i)) candidates.push(i);
  const r = 10 - effects.length;
  const nSets = binom(candidates.length, r);
  const avoidSets = combinations(N_INGREDIENTS, params.n_avoid ?? DEFAULT_AVOIDED);
  const perSet = avoidSets.length;
  // Effects searched by climbing (params.effect_exact false), or every set
  // (true, and searches saved before the climb)
  const climbing = params.effect_exact === false;

  let avoidIdx = state.position.avoid;
  let current = state.current;
  // Best sets by mean (top), by minimum (topWorst) and by maximum (topBest).
  // Older saved states only have `top`; the other two start empty
  const top = state.top;
  const topWorst = state.topWorst || [];
  const topBest = state.topBest || [];
  let lastPost = 0;
  // Share of the run in progress already checked (exact search only), so
  // the page's bar and time left move during long runs
  let partial = 0;

  // ---- Every set (shuffled order) ----
  let setIdx = state.position.set;
  // Saved states from before the shuffle have no order: lexicographic
  const order = climbing
    ? null
    : state.order || (setIdx > 0 || current ? { a: 1, b: 0 } : shuffledOrder(nSets));

  // ---- Climbing: from a random set, swap one effect for another while the
  // mean improves; params.effect_depth climbs, each from a new random set.
  // Every set is searched once (seen: its mean), so climbs that meet pay
  // nothing. The state says where it is: the climb's set (cur) and the
  // swaps left to try from it; the first one is the set being searched.
  const climb = climbing
    ? state.climb || { k: 0, start: null, cur: null, curVal: 0, swaps: [], tried: 0, triedInDone: 0, seen: {} }
    : null;
  const nClimbs = climbing ? params.effect_depth : 0;
  const neighbors = r * (candidates.length - r);

  const runsDone = () => (climbing ? climb.tried * perSet : setIdx * perSet) + avoidIdx;
  const totalRuns = () => {
    if (!climbing) return nSets * perSet;
    if (climb.k >= nClimbs) return runsDone();
    // Climbs left at the average so far (the measured share before any);
    // the one under way at least its swaps left to try
    const perClimb = climb.k ? climb.triedInDone / climb.k : SETS_PER_CLIMB * neighbors;
    const inCurrent = climb.tried - climb.triedInDone;
    const leftInCurrent = Math.max(perClimb - inCurrent, climb.cur ? climb.swaps.length : 0);
    const sets = Math.min(nSets, climb.tried + leftInCurrent + perClimb * (nClimbs - climb.k - 1));
    return Math.max(Math.round(sets * perSet), runsDone() + perSet);
  };

  const post = (type) => {
    self.postMessage({
      type,
      state: {
        position: { set: setIdx, avoid: avoidIdx },
        order,
        climb,
        current,
        top,
        topWorst,
        topBest,
        done: runsDone(),
        partial,
        total: totalRuns(),
      },
    });
  };
  const maybePost = () => {
    const now = Date.now();
    if (now - lastPost >= POST_EVERY_MS) {
      lastPost = now;
      post("progress");
    }
  };

  // Searches one set over every set of avoided ingredients (continuing the
  // one in progress, `current`), ranks it and returns its entry
  function searchSet(comp) {
    const allEffects = [...effects, ...comp];
    const allWeights = [...weights, ...comp.map(() => 0)];
    if (!current || keyOf(current.comp) !== keyOf(comp)) {
      current = { comp, sum: 0, sumsq: 0, count: 0, best: -1, worst: Infinity, recipe: null, avoid: null };
      avoidIdx = 0;
    }
    while (avoidIdx < perSet) {
      const avoid = avoidSets[avoidIdx];
      const solver = new CauldronSolver({
        B, V, effects: allEffects, weights: allWeights,
        premiumIngr: avoid, alphaUB, probUB, wpMax, wonderLevel, nRounds, minEffects,
      });
      const found = params.exact
        ? solver.exact((f) => {
          partial = f;
          maybePost();
        })
        : solver.multistart(depth);
      partial = 0;
      // With no chance at all the search ranks recipes below 0: that is 0%
      const score = nRounds ? Math.max(0, found.score) : found.score;
      const { recipe } = found;
      current.sum += score;
      // Older saved states have no sumsq/worst: they start from here
      current.sumsq = (current.sumsq || 0) + score * score;
      current.worst = Math.min(current.worst ?? Infinity, score);
      current.count += 1;
      if (score > current.best) {
        current.best = score;
        current.recipe = recipe;
        current.avoid = avoid;
      }
      avoidIdx += 1;
      maybePost();
    }

    // Set finished: rank it by mean, minimum and maximum over its
    // ingredient sets
    const avg = current.sum / current.count;
    const entry = {
      comp: current.comp,
      avg,
      std: Math.sqrt(Math.max(0, current.sumsq / current.count - avg * avg)),
      worst: current.worst,
      best: current.best,
      recipe: current.recipe,
      avoid: current.avoid,
    };
    keepTop(top, entry, (e) => e.avg);
    keepTop(topWorst, entry, (e) => e.worst);
    keepTop(topBest, entry, (e) => e.best);
    current = null;
    avoidIdx = 0;
    return entry;
  }

  if (!climbing) {
    // Products stay exact: a, step < N, and N is at most a few million
    const rankAt = (step) => (order.a * step + order.b) % nSets;
    // A set in progress (saved) continues where it was
    while (setIdx < nSets) {
      const comp = unrank(candidates.length, r, rankAt(setIdx)).map((i) => candidates[i]);
      if (current && keyOf(current.comp) !== keyOf(comp)) current = null;
      searchSet(comp);
      setIdx += 1;
    }
    post("done");
    return;
  }

  // Mean of a set: searched once, then remembered
  const valueOf = (comp) => {
    const key = keyOf(comp);
    if (!(key in climb.seen)) {
      // 10 digits: plenty to rank, and the saved state stays small
      climb.seen[key] = Number(searchSet(comp).avg.toPrecision(10));
      climb.tried += 1;
    }
    return climb.seen[key];
  };
  // Swaps from a set (one of its effects out, another in), shuffled
  const swapsFrom = (comp) => {
    const out = [];
    const inSet = new Set(comp);
    comp.forEach((a) => candidates.forEach((b) => {
      if (!inSet.has(b)) out.push([a, b]);
    }));
    return shuffle(out);
  };
  const randomSet = () => sortedSet(shuffle([...candidates]).slice(0, r));

  while (climb.k < nClimbs) {
    if (!climb.cur) {
      if (!climb.start) climb.start = randomSet();
      climb.curVal = valueOf(climb.start);
      climb.cur = climb.start;
      climb.start = null;
      climb.swaps = swapsFrom(climb.cur);
    }
    while (climb.swaps.length) {
      const [a, b] = climb.swaps[0];
      const next = sortedSet(climb.cur.map((x) => (x === a ? b : x)));
      const v = valueOf(next);
      climb.swaps.shift();
      if (v > climb.curVal + 1e-12) {
        climb.cur = next;
        climb.curVal = v;
        climb.swaps = swapsFrom(next);
      }
    }
    // A peak: no swap improves it. The next climb starts elsewhere
    climb.k += 1;
    climb.triedInDone = climb.tried;
    climb.cur = null;
    maybePost();
  }
  post("done");
}

self.onmessage = (e) => {
  if (e.data.type === "start") run(e.data);
};
