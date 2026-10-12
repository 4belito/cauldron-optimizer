// Cheapest order to add a cauldron recipe's ingredients, and its Witch Point total.
//
// The game prices each normal ingredient when it is added (CauldronController.getBrewingCostFormula):
//   cost = round(basicCost * factorAllGrowth^(rank-1) * factorSameGrowth^(amount-1))
// rank   = its position among the normal ingredients in the pot (premium ones do not count)
// amount = which copy of this ingredient it is
// The total is the sum of those prices, so the order matters. No ancient wonder reduction here.
// Premium ingredients cost a flat premiumBasicCost in diamonds and do not move the rank.
//
// The search is exact: a dynamic program over "how many copies of each ingredient are in the pot",
// at most a few hundred thousand states for a full 25-ingredient recipe.

const DEFAULTS = {
  basicCost: 50,
  factorAllGrowth: 1.1,
  factorSameGrowth: 1.4,
  ingredientsMax: 25,
  premiumBasicCost: 25,
};

/**
 * Witch Point price of one normal ingredient when it is added.
 * @param {number} rank    its position among the normal ingredients in the pot (1 = first)
 * @param {number} amount  which copy of this ingredient it is (1 = first)
 * @param {object} [options]  overrides of DEFAULTS
 */
function cauldronPrice(rank, amount, options = {}) {
  const v = { ...DEFAULTS, ...options };
  return Math.round(v.basicCost * v.factorAllGrowth ** (rank - 1) * v.factorSameGrowth ** (amount - 1));
}

/**
 * @param {Record<string, number>} recipe  ingredient -> amount, e.g. { 'Fire Spore': 3, 'Beetlenut': 2 }
 * @param {object} [options]
 * @param {string[]} [options.premium]     ingredients that are premium this week (paid in diamonds)
 * @returns {{ order: {ingredient: string, cost: number, premium?: boolean}[], witchPoints: number, diamonds: number }}
 */
function cauldronBuyOrder(recipe, options = {}) {
  const v = { ...DEFAULTS, ...options };
  const premium = new Set(options.premium ?? []);

  const entries = Object.entries(recipe).filter(([, n]) => n > 0);
  for (const [name, n] of entries) {
    if (!Number.isInteger(n)) throw new Error(`amount of ${name} must be a whole number`);
  }
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total > v.ingredientsMax) throw new Error(`${total} ingredients, the cauldron holds ${v.ingredientsMax}`);

  const normal = entries.filter(([name]) => !premium.has(name));
  const premiums = entries.filter(([name]) => premium.has(name));

  const price = (rank, amount) => cauldronPrice(rank, amount, v);

  // State = copies of each normal ingredient added so far, as a mixed-radix index. Adding a copy only
  // ever raises the index, so states can be filled in index order.
  const counts = normal.map(([, n]) => n);
  const stride = [];
  let size = 1;
  for (const n of counts) {
    stride.push(size);
    size *= n + 1;
  }
  const best = new Float64Array(size).fill(Infinity);
  const via = new Int8Array(size).fill(-1); // which ingredient was added last to get here
  best[0] = 0;

  const used = new Array(counts.length);
  for (let state = 0; state < size; state++) {
    if (best[state] === Infinity) continue;
    let rest = state;
    let rank = 1;
    for (let i = counts.length - 1; i >= 0; i--) {
      used[i] = Math.floor(rest / stride[i]);
      rest %= stride[i];
      rank += used[i];
    }
    for (let i = 0; i < counts.length; i++) {
      if (used[i] === counts[i]) continue;
      const next = state + stride[i];
      const cost = best[state] + price(rank, used[i] + 1);
      if (cost < best[next]) {
        best[next] = cost;
        via[next] = i;
      }
    }
  }

  // Walk back from the full recipe
  const order = [];
  let state = size - 1;
  while (state > 0) {
    const i = via[state];
    state -= stride[i];
    order.push(i);
  }
  order.reverse();

  const seen = counts.map(() => 0);
  const steps = order.map((i, k) => {
    seen[i] += 1;
    return { ingredient: normal[i][0], cost: price(k + 1, seen[i]) };
  });
  // Premium ones do not change any Witch Point price, so where they go does not matter
  for (const [name, n] of premiums) {
    for (let k = 0; k < n; k++) steps.push({ ingredient: name, cost: v.premiumBasicCost, premium: true });
  }

  return {
    order: steps,
    witchPoints: best[size - 1],
    diamonds: premiums.reduce((sum, [, n]) => sum + n * v.premiumBasicCost, 0),
  };
}

// Node: export it and run the examples; browser: a plain global (formula page)
if (typeof module !== 'undefined') module.exports = { cauldronBuyOrder, cauldronPrice, DEFAULTS };

if (typeof require !== 'undefined' && require.main === module) {
  const show = (title, recipe, options) => {
    const r = cauldronBuyOrder(recipe, options);
    console.log(`\n${title}`);
    console.log(r.order.map((s) => `${s.ingredient}${s.premium ? ' (premium)' : ''} ${s.cost}`).join(', '));
    console.log(`Witch Points: ${r.witchPoints}${r.diamonds ? `, diamonds: ${r.diamonds}` : ''}`);
  };
  show('3 A + 1 B', { A: 3, B: 1 });
  show('5 x 5', { A: 5, B: 5, C: 5, D: 5, E: 5 });
  show('Uneven, with a premium one', { A: 7, B: 4, C: 4, D: 3, E: 2, F: 1, G: 2 }, { premium: ['G'] });
}
