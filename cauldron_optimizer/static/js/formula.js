// Formula test bench (formula.html): pick the effects in play, the recipe and
// the premium ingredients, and see the effect chances and the cost live.
//
// Chances, as CauldronOptimizer.effect_probabilities (optimizer.py), over the
// effects in play only:  E_i = max(V_i·alpha, 0) * 1.1^(B_i·alpha),
//                        p_i = 20 * E_i / sum(E) * sqrt(sum(alpha))
// Premium ingredients still count for the effects: they only change the cost.
// Cost: cauldronBuyOrder and cauldronPrice (cauldron-order.js). Each base
// shows the price of the next copy, as in the game; the Witch Points plate
// (top left) turns the cost red when it is not enough.

(() => {
  const C = window.FORMULA_CONFIG;
  const jars = [...document.querySelectorAll(".fx-jar")];
  const counts = jars.map((jar) => jar.querySelector(".fx-count"));
  const effectBtns = [...document.querySelectorAll(".fx-effect")];
  const allBox = document.getElementById("fxEffectsAll");
  const wpInput = document.getElementById("fxWp");
  const WP_KEY = "formula.witchPoints";

  const amount = (i) => Math.max(0, Math.floor(Number(counts[i].value) || 0));
  const total = () => counts.reduce((s, _, i) => s + amount(i), 0);

  // Ingredients in the order they were added, so the last one can be taken out
  // as in the game. Kept in step with the amounts: a raised amount adds copies
  // at the end, a lowered one removes that ingredient's latest copies.
  let added = [];
  function syncAdded() {
    counts.forEach((_, i) => {
      let extra = added.filter((x) => x === i).length - amount(i);
      for (let k = added.length - 1; extra > 0 && k >= 0; k--) {
        if (added[k] === i) {
          added.splice(k, 1);
          extra--;
        }
      }
      for (; extra < 0; extra++) added.push(i);
    });
  }

  function chances(alpha, effects) {
    const n = alpha.reduce((a, b) => a + b, 0);
    const E = effects.map((e) => {
      let sv = 0;
      let sb = 0;
      alpha.forEach((a, j) => {
        sv += C.V[e][j] * a;
        sb += C.B[e][j] * a;
      });
      return Math.max(sv, 0) * 1.1 ** sb;
    });
    const sum = E.reduce((a, b) => a + b, 0);
    if (sum <= 0 || n <= 0) return E.map(() => 0);
    return E.map((x) => (20 * x / sum) * Math.sqrt(n));
  }

  function effectRow(e, p) {
    const row = document.createElement("div");
    row.className = "cw-effect";
    const value = document.createElement("span");
    value.className = "cw-effect-value";
    value.textContent = `${p.toFixed(2)}%`;
    const icon = document.createElement("img");
    icon.className = "cw-effect-icon";
    icon.src = `/static/effects/effect${e + 1}.png`;
    icon.alt = "";
    const name = document.createElement("span");
    name.className = "cw-effect-name";
    name.textContent = C.effectNames[e];
    name.title = C.effectNames[e];
    row.append(value, icon, name);
    return row;
  }

  function update() {
    syncAdded();
    const alpha = counts.map((_, i) => amount(i));
    const n = alpha.reduce((a, b) => a + b, 0);
    const max = Math.max(...alpha, 1);
    jars.forEach((jar, i) => {
      jar.classList.toggle("zero", alpha[i] === 0);
      jar.style.setProperty("--amt", alpha[i] / max);
    });
    document.getElementById("fxTotal").textContent = n;
    document.getElementById("fxPot").style.setProperty("--fill", Math.min(n / C.maxIngredients, 1));
    const last = added[added.length - 1];
    const lastImg = document.getElementById("fxLast");
    lastImg.hidden = last === undefined;
    document.getElementById("fxRemoveLast").hidden = last === undefined;
    if (last !== undefined) {
      lastImg.src = `/static/ingredients/ingredient${last + 1}.png`;
      lastImg.alt = C.ingredientNames[last];
    }

    // Effects in play
    const effects = effectBtns.filter((b) => b.classList.contains("filled")).map((b) => Number(b.dataset.effect));
    allBox.checked = effects.length === effectBtns.length;
    allBox.indeterminate = effects.length > 0 && !allBox.checked;
    const text = document.getElementById("fxEffectsText");
    text.textContent = text.dataset.text.replace("{n}", effects.length);

    // Chances, highest first
    const p = chances(alpha, effects);
    const order = effects.map((e, k) => [e, p[k]]).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    document.getElementById("fxScroll").replaceChildren(...order.map(([e, v]) => effectRow(e, v)));

    // Price of the next copy on each base: Witch Points, or diamonds when premium
    const isPremium = jars.map((j) => j.classList.contains("premium"));
    const normalCount = alpha.reduce((sum, a, i) => sum + (isPremium[i] ? 0 : a), 0);
    jars.forEach((jar, i) => {
      const icon = jar.querySelector(".cw-base-icon");
      const price = isPremium[i]
        ? DEFAULTS.premiumBasicCost
        : cauldronPrice(normalCount + 1, alpha[i] + 1);
      icon.src = isPremium[i] ? C.icons.diamond : C.icons.wp;
      jar.querySelector(".cw-base-price").textContent = formatAmount(price);
    });

    // Cost, with the cheapest order on hover
    const recipe = Object.fromEntries(alpha.map((a, i) => [i, a]));
    const premium = jars.filter((_, i) => isPremium[i]).map((j) => j.dataset.ingredient);
    const costEl = document.getElementById("fxCost");
    const wpEl = document.getElementById("fxCostWp");
    try {
      const r = cauldronBuyOrder(recipe, { premium, ingredientsMax: C.maxIngredients });
      wpEl.textContent = formatAmount(r.witchPoints);
      document.getElementById("fxCostDia").textContent = r.diamonds;
      document.getElementById("fxCostDiaItem").hidden = !r.diamonds;
      // As in the game: green when the Witch Points are enough, red when not
      const have = parseWp(wpInput.value);
      costEl.classList.toggle("short", have > 0 && r.witchPoints > have);
      costEl.classList.toggle("enough", have > 0 && r.witchPoints <= have);
      costEl.dataset.tipRows = JSON.stringify(
        r.order.map((s, k) => [
          `${k + 1}. ${C.ingredientNames[s.ingredient]}${s.premium ? ` (${C.text.premium})` : ""}`,
          s.premium ? `${s.cost} 💎` : formatAmount(s.cost),
        ])
      );
      if (!r.order.length) delete costEl.dataset.tipRows;
    } catch (e) {
      wpEl.textContent = e.message;
      delete costEl.dataset.tipRows;
    }
  }

  // Witch Points as typed: 175000, 175K, 1.2M (comma or dot decimals)
  function parseWp(text) {
    const m = String(text).trim().replace(",", ".").match(/^(\d*\.?\d+)\s*([kKmM]?)$/);
    if (!m) return 0;
    const mult = { k: 1e3, m: 1e6 }[m[2].toLowerCase()] ?? 1;
    return Math.round(Number(m[1]) * mult);
  }

  // As the game shows amounts: up to 4 digits as they are, then 175K, 1.2M
  function formatAmount(n) {
    if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
    if (n >= 1e4) return `${Math.floor(n / 1e3)}K`;
    return String(n);
  }

  // The Witch Points field: empty instead of 0, so the placeholder shows
  const formatWp = (n) => (n ? formatAmount(n) : "");

  // Remembered in this browser only; storage may be unavailable
  try {
    wpInput.value = formatWp(parseWp(localStorage.getItem(WP_KEY) || ""));
  } catch (e) {}
  wpInput.addEventListener("focus", () => {
    const n = parseWp(wpInput.value);
    wpInput.value = n ? String(n) : "";
  });
  wpInput.addEventListener("blur", () => {
    wpInput.value = formatWp(parseWp(wpInput.value));
  });
  wpInput.addEventListener("input", () => {
    try {
      localStorage.setItem(WP_KEY, String(parseWp(wpInput.value)));
    } catch (e) {}
    update();
  });

  // Set an ingredient's amount, keeping the recipe within the cauldron's limit
  function setAmount(i, value) {
    const room = C.maxIngredients - (total() - amount(i));
    counts[i].value = Math.max(0, Math.min(value, room));
    update();
  }

  jars.forEach((jar, i) => {
    const dome = jar.querySelector(".fx-dome");
    dome.addEventListener("click", (e) => setAmount(i, amount(i) + (e.shiftKey ? -1 : 1)));
    dome.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      setAmount(i, amount(i) - 1);
    });
    counts[i].addEventListener("input", update);
    counts[i].addEventListener("change", () => setAmount(i, amount(i)));
    jar.querySelector(".fx-premium").addEventListener("click", (e) => {
      const on = jar.classList.toggle("premium");
      e.currentTarget.setAttribute("aria-pressed", on);
      update();
    });
  });

  effectBtns.forEach((btn) =>
    btn.addEventListener("click", () => {
      btn.setAttribute("aria-pressed", btn.classList.toggle("filled"));
      update();
    })
  );

  allBox.addEventListener("change", () => {
    effectBtns.forEach((btn) => {
      btn.classList.toggle("filled", allBox.checked);
      btn.setAttribute("aria-pressed", allBox.checked);
    });
    update();
  });

  document.getElementById("fxRemoveLast").addEventListener("click", () => {
    const last = added[added.length - 1];
    if (last !== undefined) setAmount(last, amount(last) - 1);
  });

  document.getElementById("fxEmpty").addEventListener("click", () => {
    counts.forEach((c) => (c.value = 0));
    update();
  });

  update();
})();
