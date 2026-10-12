// Formula test bench (formula.html): pick the effects in play, the recipe and
// the premium ingredients, and see the effect chances and the cost live.
//
// Chances, as CauldronOptimizer.effect_probabilities (optimizer.py), over the
// effects in play only:  E_i = max(V_i·alpha, 0) * 1.1^(B_i·alpha),
//                        p_i = 20 * E_i / sum(E) * sqrt(sum(alpha))
// Premium ingredients still count for the effects: they only change the cost.
// Cost: cauldronBuyOrder and cauldronPrice (cauldron-order.js), with the
// Escuela de hechicería valoriana wonder's discount for the chosen level (WONDER_REDUCTION). Each base
// shows the price of the next copy, as in the game; the Witch Points plate
// (top left) turns the cost red when it is not enough.
// The cost is that of the cheapest order, which is adding the ingredients from
// the largest amount to the smallest, each one's copies together (checked
// against cauldronBuyOrder's exact search on 9000 random recipes). So that it
// matches the game's, the recipe keeps that order: no ingredient may have more
// units than one added before it (ties are fine), and each one's units go in a
// row, so only the last one started can still grow. Premium ones do not count,
// as they do not change the Witch Point prices. A change that breaks it is not
// made, and a window explains why.

(() => {
  const C = window.FORMULA_CONFIG;
  const jars = [...document.querySelectorAll(".fx-jar")];
  const counts = jars.map((jar) => jar.querySelector(".fx-count"));
  const effectBtns = [...document.querySelectorAll(".fx-effect")];
  const allBox = document.getElementById("fxEffectsAll");
  const wpInput = document.getElementById("fxWp");
  const orderNote = document.getElementById("fxOrderNote");
  const ORDER_MUTE_KEY = "formula.orderNoteMuted";
  const wonderSelect = document.getElementById("fxWonder");
  const WONDER_KEY = "formula.wonderLevel";

  // The accepted amounts; the plates show them, a typed value is checked first
  const amounts = counts.map(() => 0);
  const amount = (i) => amounts[i];
  const total = () => amounts.reduce((s, a) => s + a, 0);
  const isPremium = (i) => jars[i].classList.contains("premium");

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
    const alpha = [...amounts];
    counts.forEach((c, i) => {
      if (document.activeElement !== c || Number(c.value) !== alpha[i]) c.value = alpha[i];
    });
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

    // Escuela de hechicería valoriana: its level's discount on every Witch Point price
    const level = Number(wonderSelect.value) || 0;
    const reduction = WONDER_REDUCTION[level] ?? 0;
    document.getElementById("fxWonderLevel").textContent = level;
    document.getElementById("fxWonderDiscount").textContent = reduction ? `−${+(reduction * 100).toFixed(1)}%` : "—";
    wonderSelect.closest(".fx-wonder").classList.toggle("unbuilt", !level);

    // Price of the next copy on each base: Witch Points, or diamonds when premium
    const premiumNow = jars.map((_, i) => isPremium(i));
    const normalCount = alpha.reduce((sum, a, i) => sum + (premiumNow[i] ? 0 : a), 0);
    jars.forEach((jar, i) => {
      const icon = jar.querySelector(".cw-base-icon");
      const price = premiumNow[i]
        ? DEFAULTS.premiumBasicCost
        : cauldronPrice(normalCount + 1, alpha[i] + 1, { reduction });
      icon.src = premiumNow[i] ? C.icons.diamond : C.icons.wp;
      jar.querySelector(".cw-base-price").textContent = formatAmount(price);
    });

    // Cost, with the cheapest order on hover
    const recipe = Object.fromEntries(alpha.map((a, i) => [i, a]));
    const premium = jars.filter((_, i) => premiumNow[i]).map((j) => j.dataset.ingredient);
    const costEl = document.getElementById("fxCost");
    const wpEl = document.getElementById("fxCostWp");
    try {
      const r = cauldronBuyOrder(recipe, { premium, reduction, ingredientsMax: C.maxIngredients });
      wpEl.textContent = formatAmount(r.witchPoints);
      document.getElementById("fxCostDia").textContent = r.diamonds;
      document.getElementById("fxCostDiaItem").hidden = !r.diamonds;
      // As in the game: green when the Witch Points are enough, red when not
      const have = parseWp(wpInput.value);
      costEl.classList.toggle("short", r.witchPoints > have);
      costEl.classList.toggle("enough", r.witchPoints <= have);
    } catch (e) {
      wpEl.textContent = e.message;
    }
  }

  // Ingredients in the order they were first added (the order the cost assumes)
  function firstOrder(next) {
    const order = [...new Set(added)].filter((i) => next[i] > 0);
    next.forEach((a, i) => {
      if (a > 0 && !order.includes(i)) order.push(i);
    });
    return order;
  }

  // Why new amounts break the order, or null. Premium ones are left out.
  // grown: the ingredient being raised, which must be the last one started
  // (each one's units go in a row) or a new one
  function orderProblem(next, premium = isPremium, grown = null) {
    const name = (i) => C.ingredientNames[i];
    if (grown !== null && !premium(grown)) {
      const before = firstOrder(amounts).filter((i) => !premium(i));
      const at = before.indexOf(grown);
      if (at >= 0 && at < before.length - 1) {
        return C.text.orderBack.replace("{name}", name(grown)).replace("{later}", name(before[at + 1]));
      }
    }
    const order = firstOrder(next).filter((i) => !premium(i));
    for (let k = 1; k < order.length; k++) {
      for (let j = 0; j < k; j++) {
        const [earlier, later] = [order[j], order[k]];
        if (next[later] > next[earlier]) {
          return C.text.orderWhy
            .replace("{later}", name(later))
            .replace("{n}", next[later])
            .replace("{earlier}", name(earlier))
            .replace("{m}", next[earlier]);
        }
      }
    }
    return null;
  }

  // Apply new amounts, or, if they break the order, keep the old ones and say why
  // changed: the ingredient the change was on, shaken when the window is muted
  function tryAmounts(next, premium, grown = null, changed = grown) {
    const problem = orderProblem(next, premium, grown);
    if (problem) {
      if (orderNoteMuted()) refuse(changed);
      else showOrderNote(problem);
      update();
      return false;
    }
    next.forEach((a, i) => (amounts[i] = a));
    update();
    return true;
  }

  // "No volver a mostrar": remembered in this browser only
  function orderNoteMuted() {
    try {
      return localStorage.getItem(ORDER_MUTE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  // A refused change with the window muted: the ingredient shakes
  function refuse(i) {
    if (i === null || i === undefined) return;
    const jar = jars[i];
    jar.classList.remove("fx-refused");
    void jar.offsetWidth; // restart the animation
    jar.classList.add("fx-refused");
  }

  // The window: what was not allowed, and the recipe in order
  function showOrderNote(why) {
    document.getElementById("fxOrderNoteMute").checked = false;
    document.getElementById("fxOrderNoteWhy").textContent = why;
    renderOrderExample();
    orderNote.hidden = false;
    document.body.classList.add("avatar-open");
    document.getElementById("fxOrderNoteOk").focus();
  }

  // The current recipe in the order it was added (premium ones marked)
  function renderOrderExample() {
    document.getElementById("fxOrderExample").replaceChildren(
      ...firstOrder(amounts).map((i) => {
        const li = document.createElement("li");
        const img = document.createElement("img");
        img.src = `/static/ingredients/ingredient${i + 1}.png`;
        img.alt = "";
        const name = document.createElement("span");
        name.textContent = C.ingredientNames[i] + (isPremium(i) ? " 💎" : "");
        const n = document.createElement("strong");
        n.textContent = `× ${amounts[i]}`;
        li.append(img, name, n);
        return li;
      })
    );
  }

  // Entendido or the header's X; with the tick box, not shown again
  orderNote.querySelectorAll("[data-order-ok]").forEach((btn) =>
    btn.addEventListener("click", () => {
      orderNote.hidden = true;
      document.body.classList.remove("avatar-open");
      if (document.getElementById("fxOrderNoteMute").checked) {
        try {
          localStorage.setItem(ORDER_MUTE_KEY, "1");
        } catch (e) {}
      }
    })
  );
  jars.forEach((jar) => jar.addEventListener("animationend", () => jar.classList.remove("fx-refused")));

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

  // The Witch Points field: remembered in a cookie for a year, 0 without one
  const WP_COOKIE = "formula_wp";
  const formatWp = formatAmount;
  function readWpCookie() {
    const m = document.cookie.match(new RegExp(`(?:^|; )${WP_COOKIE}=(\\d+)`));
    return m ? Number(m[1]) : 0;
  }
  function saveWpCookie(n) {
    document.cookie = `${WP_COOKIE}=${n}; path=/; max-age=31536000; SameSite=Lax`;
  }
  wpInput.value = formatWp(readWpCookie());
  // Forget the amount older versions of this page saved in local storage
  try {
    localStorage.removeItem("formula.witchPoints");
  } catch (e) {}
  // Editing shows the full number, selected so typing replaces it
  wpInput.addEventListener("focus", () => {
    wpInput.value = String(parseWp(wpInput.value));
    wpInput.select();
  });
  wpInput.addEventListener("blur", () => {
    wpInput.value = formatWp(parseWp(wpInput.value));
  });
  wpInput.addEventListener("input", () => {
    saveWpCookie(parseWp(wpInput.value));
    update();
  });

  // Wonder levels: "Sin construir", then "Nivel 1 · −6%" ... "Nivel 35 · −60%"
  wonderSelect.replaceChildren(
    ...WONDER_REDUCTION.map((r, level) => {
      const label = level
        ? `${C.text.wonderLevel.replace("{n}", level)} · −${+(r * 100).toFixed(1)}%`
        : C.text.wonderNone;
      return new Option(label, level);
    })
  );
  try {
    wonderSelect.value = String(Math.min(Number(localStorage.getItem(WONDER_KEY)) || 0, WONDER_REDUCTION.length - 1));
  } catch (e) {}
  wonderSelect.addEventListener("change", () => {
    try {
      localStorage.setItem(WONDER_KEY, wonderSelect.value);
    } catch (e) {}
    update();
  });

  // Set an ingredient's amount, within the cauldron's limit and the order
  function setAmount(i, value) {
    const room = C.maxIngredients - (total() - amount(i));
    const next = [...amounts];
    next[i] = Math.max(0, Math.min(Math.floor(value) || 0, room));
    if (next[i] !== amounts[i]) tryAmounts(next, undefined, next[i] > amounts[i] ? i : null, i);
    else update();
  }

  jars.forEach((jar, i) => {
    const dome = jar.querySelector(".fx-dome");
    dome.addEventListener("click", (e) => setAmount(i, amount(i) + (e.shiftKey ? -1 : 1)));
    dome.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      setAmount(i, amount(i) - 1);
    });
    // Typed amounts are checked as they are typed; an empty box waits
    counts[i].addEventListener("input", () => {
      if (counts[i].value !== "") setAmount(i, Number(counts[i].value));
    });
    counts[i].addEventListener("change", () => setAmount(i, Number(counts[i].value)));
    // Premium off brings it back into the order: only if it fits
    jar.querySelector(".fx-premium").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const on = !isPremium(i);
      if (!on && !tryAmounts([...amounts], (k) => (k === i ? false : isPremium(k)), null, i)) return;
      jar.classList.toggle("premium", on);
      btn.setAttribute("aria-pressed", on);
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
    amounts.fill(0);
    update();
  });

  update();
})();
