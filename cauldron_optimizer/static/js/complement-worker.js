// Web Worker for the "complete effects" search (started by complement.js).
//
// The user chose k < 10 effects (with weights). The outer loop tries every set
// of 10 - k complementary effects among the other unlocked effects (weight 0);
// the inner loop tries the 495 sets of 4 avoided ingredients. Each run is a
// full multistart search (solver.js).
//
// The sets are visited in a shuffled order that covers the whole space evenly
// (step -> set (a * step + b) mod N, a coprime with N, so each set is visited
// exactly once): stopping early leaves a fair sample of all the effects, not
// just the first ones. A complementary set is ranked by its average best score
// over the 495 ingredient sets. The order is fixed by (a, b), saved with the
// state, so the position alone says what is done: stopping and resuming never
// repeats a run. The worker posts its whole state
// a few times per second; the page keeps the last one and saves it.

importScripts("solver.js");

const N_INGREDIENTS = 12;
const AVOIDED = 4;
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

function run({ B, V, params, state }) {
  const { n, effects, weights, alpha_ub: alphaUB, prob_ub: probUB, depth } = params;
  const chosen = new Set(effects);
  const candidates = [];
  for (let i = 0; i < n; i++) if (!chosen.has(i)) candidates.push(i);
  const r = 10 - effects.length;
  const nSets = binom(candidates.length, r);
  const avoidSets = combinations(N_INGREDIENTS, AVOIDED);
  const perSet = avoidSets.length;
  const total = nSets * perSet;

  let setIdx = state.position.set;
  let avoidIdx = state.position.avoid;
  let current = state.current;
  // Best sets by mean (top), by minimum (topWorst) and by maximum (topBest).
  // Older saved states only have `top`; the other two start empty
  const top = state.top;
  const topWorst = state.topWorst || [];
  const topBest = state.topBest || [];
  let lastPost = 0;

  const post = (type) => {
    self.postMessage({
      type,
      state: {
        position: { set: setIdx, avoid: avoidIdx },
        order,
        current,
        top,
        topWorst,
        topBest,
        done: setIdx * perSet + avoidIdx,
        total,
      },
    });
  };

  // Saved states from before the shuffle have no order: lexicographic
  const order = state.order || (setIdx > 0 || current ? { a: 1, b: 0 } : shuffledOrder(nSets));
  // Products stay exact: a, step < N, and N is at most a few million
  const rankAt = (step) => (order.a * step + order.b) % nSets;

  let combo = setIdx < nSets ? unrank(candidates.length, r, rankAt(setIdx)) : null;
  while (combo) {
    const comp = combo.map((i) => candidates[i]);
    const allEffects = [...effects, ...comp];
    const allWeights = [...weights, ...comp.map(() => 0)];
    if (!current) {
      current = { comp, sum: 0, sumsq: 0, count: 0, best: -1, worst: Infinity, recipe: null, avoid: null };
    }

    while (avoidIdx < perSet) {
      const avoid = avoidSets[avoidIdx];
      const solver = new CauldronSolver({
        B, V, effects: allEffects, weights: allWeights,
        premiumIngr: avoid, alphaUB, probUB,
      });
      const { score, recipe } = solver.multistart(depth);
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

      const now = Date.now();
      if (now - lastPost >= POST_EVERY_MS) {
        lastPost = now;
        post("progress");
      }
    }

    // Set finished: rank it by mean, minimum and maximum over its 495
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
    setIdx += 1;
    avoidIdx = 0;
    combo = setIdx < nSets ? unrank(candidates.length, r, rankAt(setIdx)) : null;
  }
  post("done");
}

self.onmessage = (e) => {
  if (e.data.type === "start") run(e.data);
};
