// "Complete effects" mode: the effects with a weight (fewer than 10) are kept,
// the rest unchecked, and the form is locked while the mode is on: the
// settings are changed with the mode off. A long
// search (complement-worker.js, in the browser) finds the complementary
// effects that complete them to 10, trying every set of avoided premium
// ingredients for each (495 sets of 4 of the 12, the default). The search
// runs in a window opened by "Completar";
// stopping it saves the progress (per world) so "Completar" continues later.
// Uses window.cauldronForm (optimizer.js) and window.COMPLEMENT (index.html).

function initComplement() {
  const C = window.COMPLEMENT;
  if (!C) return;
  const T = C.text;
  const MAX_CHOSEN = 9;
  const N_INGREDIENTS = 12;
  const SHOWN = 5;

  const $ = (id) => document.getElementById(id);
  const toggle = $("complementToggle");
  const win = $("complementWindow");
  const hint = $("complementHint");
  const panelContent = $("complementPanelContent");
  const searchBtn = $("searchBtn");
  const premiumCard = document.querySelector(".premium-card");
  const saveSettingsBtn = $("saveSettingsBtn");
  const statusEl = $("complementStatus");
  const msgEl = $("complementMessage");
  const bar = $("complementBar");
  const barFill = $("complementBarFill");
  const countsEl = $("complementCounts");
  const etaEl = $("complementEta");
  const stopBtn = $("complementStop");
  const stopLabel = stopBtn.querySelector("span");
  const applyBtn = $("complementApply");
  const goBtn = $("complementGo");
  const buttons = $("complementButtons");
  const closeX = win.querySelector("[data-complement-close]");
  const topList = $("complementTop");
  const csrf = () => document.querySelector("input[name='csrf_token']").value;

  let worker = null;
  let params = null; // parameters of the search in memory
  let state = null; // latest state of that search
  let rate = null; // runs per second, measured
  let selectedKey = null; // complementary set chosen in the ranking (null: the top one)
  let sortBy = "avg"; // ranking order: "avg", "worst" (minimum) or "best" (maximum)
  let runStart = null;

  const fmt = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  const binom = (n, k) => {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  };

  function formatDuration(sec) {
    if (!isFinite(sec)) return "…";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.ceil((sec % 3600) / 60);
    if (d) return `${d} d ${h} h`;
    if (h) return `${h} h ${m} min`;
    return `${Math.max(1, m)} min`;
  }

  // Estimates are rough: two significant digits at most ("1900 d", "2.5 d")
  function roughDuration(sec) {
    if (!isFinite(sec) || sec < 2 * 3600) return formatDuration(sec);
    const h = sec / 3600;
    if (h < 48) return `${Math.round(h)} h`;
    const d = h / 24;
    if (d < 10) return `${(Math.round(d * 10) / 10).toLocaleString()} d`;
    const digits = 10 ** Math.max(0, Math.floor(Math.log10(d)) - 1);
    return `${(Math.round(d / digits) * digits).toLocaleString()} d`;
  }

  // ---- Current parameters from the page ----
  function currentParams() {
    const { n, effects, weights } = window.cauldronForm.chosen();
    const val = (name) => Number(document.querySelector(`input[name='${name}']`).value);
    return {
      n,
      effects,
      weights,
      alpha_ub: val("alpha_UB"),
      prob_ub: val("prob_UB"),
      depth: val("n_starts"),
      // "Óptima": every run checks every recipe (the depth is not used)
      exact: Boolean(document.getElementById("exactSearch")?.checked),
      wp_max: val("wp_max") || null, // empty: no limit
      wonder_level: val("wonder_level"),
      // "Todos en": goblets of its objective (0: scored by the weights)
      n_rounds: document.getElementById("allEffects")?.checked ? val("n_rounds") : 0,
      // ...at least this many of the wanted effects (0: all that can be)
      min_effects: document.getElementById("allEffects")?.checked ? val("min_effects") : 0,
      // Premium ingredients avoided in each run (the world's setting)
      n_avoid: nPremium(),
    };
  }

  function validate(p) {
    if (p.n < 10) return T.needDiplomas;
    if (p.effects.length < 1 || p.effects.length > MAX_CHOSEN || !p.weights.some((w) => w > 0)) {
      return T.needEffects;
    }
    return null;
  }

  // Runs per complementary set: one per set of avoided ingredients
  // (searches saved before the setting avoided 4)
  const runsPerSet = (p) => binom(N_INGREDIENTS, p && p.n_avoid !== undefined ? p.n_avoid : 4);
  // Sets of complementary effects, all of them
  const setsOf = (p) => binom(p.n - p.effects.length, 10 - p.effects.length);
  // Effects search by climbing (effect_exact false): climbs of about
  // SETS_PER_CLIMB times a set's neighbors (one effect swapped for another)
  // each, measured; the worker refines it as climbs finish
  const SETS_PER_CLIMB = 1;
  const DEFAULT_EFFECT_DEPTH = 10;
  // Most climbs worth choosing: as many as would try every set (more is
  // what "Óptima" does), at least 10 and at most 1000 (routes.py)
  const maxEffectDepth = (p) => {
    const r = 10 - p.effects.length;
    const neighbors = r * (p.n - p.effects.length - r);
    const cover = neighbors ? Math.ceil(setsOf(p) / (SETS_PER_CLIMB * neighbors)) : 1;
    return Math.min(1000, Math.max(DEFAULT_EFFECT_DEPTH, cover));
  };
  const estimatedSets = (p, climbs) => {
    const r = 10 - p.effects.length;
    const neighbors = r * (p.n - p.effects.length - r);
    return Math.min(setsOf(p), climbs * SETS_PER_CLIMB * neighbors);
  };
  // Runs of a search: one per set tried and set of avoided ingredients
  // (searches saved before the climb tried every set)
  const totalRuns = (p) => Math.round(
    (p.effect_exact === false ? estimatedSets(p, p.effect_depth) : setsOf(p)) * runsPerSet(p)
  );

  // ---- Mode on / off ----
  // The form is locked for the whole mode: it searches with the settings it
  // was turned on with (or those of the saved search, shown on the form), so
  // nothing changes under the user's feet. To change them, turn the mode off.
  const lockedParts = () => [
    document.querySelector(".diploma-input"),
    $("allEffectsRow"),
    $("weightsContainer"),
    $("boundsContainer"),
    // Witch Point limit and school level: part of the search too
    $("wpCard"),
    // How many premium ingredients each run avoids
    $("premiumCounter"),
  ];

  function setLocked(locked) {
    lockedParts().forEach((el) => {
      el.inert = locked; // no clicks, no keyboard focus
      el.classList.toggle("is-locked", locked);
    });
  }

  function setGoLabel(text) {
    const label = goBtn.querySelector("span");
    if (label) label.textContent = text;
    else goBtn.textContent = text;
  }

  // Show the search on the form and lock it
  function showSearch() {
    window.cauldronForm.applyComplementParams(params);
    setLocked(true);
    render();
  }

  function setMode(on) {
    if (!on && worker) stop();
    // Leaving the mode with a result: the selected set's 10 effects end up
    // checked (the one with the highest average by default)
    const best = !on && params && state && state.top.length ? selectedEntry() : null;
    window.cauldronForm.setComplementMode(
      on,
      best && { n: params.n, effects: params.effects, weights: params.weights, comp: best.comp }
    );
    document.body.classList.toggle("complement-on", on);
    premiumCard.classList.toggle("is-complement", on);
    panelContent.hidden = !on;
    premiumCard.querySelector(".premium-title").hidden = on;
    premiumCard.querySelector(".complement-title").hidden = !on;
    premiumCard.querySelectorAll("input[name='premium_ingredients[]']").forEach((el) => {
      if (on) el.checked = false;
      el.disabled = on;
    });
    // The bar follows the mode: done-looking while on (no ingredient is
    // chosen there), the normal counter and its button when off
    if (typeof updatePremiumLocks === "function") updatePremiumLocks();
    // Off again: Save follows the effects counter (optimizer.js)
    if (on) saveSettingsBtn.disabled = true;
    else updateSaveButton();
    // The normal search does not apply in this mode: its own buttons do.
    searchBtn.hidden = on;
    buttons.hidden = !on;
    try {
      sessionStorage.setItem("complementMode", on ? "1" : "");
    } catch (e) {}
    setLocked(on);
    if (on) checkSaved();
    render();
  }

  // Scores are chances (%) with "Todos en", except "Media": a count
  const isChance = () => Boolean(params && params.n_rounds && params.min_effects !== -1);

  // Same search settings? (weights compared to 2 decimals, as the sliders)
  const sameParams = (a, b) => {
    const key = (p) => JSON.stringify([
      p.n, p.effects, p.weights.map((w) => Math.round(w * 100)), p.alpha_ub, p.prob_ub,
      // With "Óptima" the depth is not used (searches saved before it: off)
      p.exact ? "exact" : p.depth,
      // Searches saved before the Witch Point limit have none
      p.wp_max ?? null, p.wp_max ? p.wonder_level ?? 0 : 0,
      // ...nor before "Todos en": scored by the weights
      p.n_rounds || 0, p.n_rounds ? p.min_effects || 0 : 0,
      // ...nor before the number of avoided ingredients: 4
      p.n_avoid ?? 4,
    ]);
    return key(a) === key(b);
  };

  // Turning the mode on: with a saved search (in memory or in the database)
  // for the same settings, it is shown and Completar continues it. With other
  // settings the user chooses: continue it (its settings go on the form) or
  // start a new one with the current settings (the saved one is deleted).
  async function checkSaved() {
    if (!params) {
      try {
        const resp = await fetch(C.urls.state, { headers: { Accept: "application/json" } });
        const data = await resp.json();
        if (data.search && !params) {
          params = data.search.params;
          state = data.search.state;
        }
      } catch (e) {}
    }
    if (!toggle.checked || !params) return render();
    if (sameParams(params, currentParams())) return showSearch();
    askSaved();
  }

  // Discard the saved search: Completar starts a new one with the form's settings
  async function discardSaved() {
    await clearSaved();
    params = null;
    state = null;
    rate = null;
    selectedKey = null;
    render();
  }

  // ---- Windows (same look as the other game windows) ----
  function openWindow(modal) {
    modal.hidden = false;
    document.body.classList.add("avatar-open");
  }

  function closeWindow(modal) {
    modal.hidden = true;
    // Keep the page locked while another window is still open
    const anyOpen = [...document.querySelectorAll(".avatar-overlay")].some((m) => !m.hidden);
    document.body.classList.toggle("avatar-open", anyOpen);
  }

  // ---- Running ----
  function start(p, fromState) {
    params = p;
    state = fromState || {
      position: { set: 0, avoid: 0 },
      current: null,
      top: [],
      done: 0,
      total: totalRuns(p),
    };
    // Id of this search for the stats; searches saved before it get one now
    const runId = state.run_id || newRunId();
    state.run_id = runId;
    logStarted();
    msgEl.textContent = "";
    openWindow(win);
    worker = new Worker(C.urls.worker);
    runStart = { time: Date.now(), done: state.done };
    lastAutoSave = Date.now();
    worker.onmessage = (e) => {
      // The worker does not know the id: keep it in the state we save
      state = { ...e.data.state, run_id: runId };
      const secs = (Date.now() - runStart.time) / 1000;
      if (secs > 2) rate = (doneSoFar(state) - runStart.done) / secs;
      if (e.data.type === "done") {
        worker = null;
        save();
      } else if (Date.now() - lastAutoSave >= AUTOSAVE_MS && !saving) {
        // Saved now and then while running: closing the tab (or a crash)
        // loses at most this much
        lastAutoSave = Date.now();
        save({ quiet: true });
      }
      render();
    };
    worker.postMessage({ type: "start", B: C.matrices.B, V: C.matrices.V, params, state });
    render();
  }

  // Stop and save, so "Completar" continues later (also from another device)
  function stop() {
    if (!worker) return;
    worker.terminate();
    worker = null;
    save();
    render();
  }

  // Quiet saves (while running) show nothing unless they fail
  const AUTOSAVE_MS = 60_000;
  let lastAutoSave = 0;
  let saving = false;
  async function save({ quiet = false } = {}) {
    if (!state) return;
    if (!quiet) msgEl.textContent = "";
    saving = true;
    try {
      const resp = await fetch(C.urls.save, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRFToken": csrf(),
        },
        body: JSON.stringify({ params, state }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.error || resp.statusText);
      // A quiet save only clears an earlier failure's message
      if (!quiet) msgEl.textContent = state.done >= state.total ? "" : T.saved;
      else if (msgEl.classList.contains("is-error")) msgEl.textContent = "";
      msgEl.classList.remove("is-error");
    } catch (err) {
      msgEl.classList.add("is-error");
      msgEl.textContent = err.message;
    } finally {
      saving = false;
    }
    render();
  }

  function newRunId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  // Tell the server a search started or was continued (stats only: a
  // failure here never stops the search)
  function logStarted() {
    fetch(C.urls.started, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-CSRFToken": csrf(),
      },
      body: JSON.stringify({
        run_id: state.run_id,
        params,
        done: state.done,
        total: state.total,
      }),
    }).catch(() => {});
  }

  async function clearSaved() {
    await fetch(C.urls.clear, {
      method: "POST",
      headers: { Accept: "application/json", "X-CSRFToken": csrf() },
    }).catch(() => {});
  }

  // The mode's button: with a search, continue it (or show its progress or
  // results); otherwise start one with the form's values
  function go() {
    if (worker) {
      openWindow(win);
      return;
    }
    if (state) {
      if (state.done >= state.total) openWindow(win);
      else start(params, state);
      return;
    }
    const p = currentParams();
    if (validate(p)) {
      render();
      return;
    }
    // The search's two depths are chosen first (askSearch starts it)
    askSearch(p);
  }

  // ---- "Óptima" on: warn how long it takes, offer the depth search ----
  // Speeds measured here, on this device, with the search's own settings
  // (~0.1 s): exact runs with 6 free ingredients give the recipes checked
  // per second; a short depth search gives the time per start
  function measureSpeeds(p) {
    const chosen = new Set(p.effects);
    const others = [];
    for (let i = 0; i < p.n; i++) if (!chosen.has(i)) others.push(i);
    // A random set of complementary effects (the search's cost varies a
    // little from one set to another)
    const randomComp = () => {
      const a = others.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a.slice(0, 10 - p.effects.length);
    };
    let comp = randomComp();
    const solverFor = (premiumIngr) => new CauldronSolver({
      B: C.matrices.B,
      V: C.matrices.V,
      effects: [...p.effects, ...comp],
      weights: [...p.weights, ...comp.map(() => 0)],
      premiumIngr,
      alphaUB: p.alpha_ub,
      probUB: p.prob_ub,
      // The Witch Point limit is checked on every recipe: part of the cost
      wpMax: p.wp_max,
      wonderLevel: p.wonder_level,
      nRounds: p.n_rounds || 0,
      minEffects: p.min_effects || 0,
    });
    const timed = (f) => {
      const t = performance.now();
      f();
      return Math.max(performance.now() - t, 1) / 1000;
    };
    // A first, untimed run of each warms the JavaScript engine up: the
    // first calls are several times slower than the long search's
    const small = { ...p, n_avoid: 6 };
    solverFor([0, 1, 2, 3, 4, 5, 6]).exact();
    const exactSecs = timed(() => solverFor([0, 1, 2, 3, 4, 5]).exact());
    const avoid = Array.from({ length: p.n_avoid ?? 4 }, (_, i) => i);
    solverFor(avoid).multistart(30);
    // Median of five sets of 60 starts, each with other complementary
    // effects (one odd timing does not move it)
    const starts = 60;
    const times = [];
    for (let k = 0; k < 5; k++) {
      comp = randomComp();
      times.push(timed(() => solverFor(avoid).multistart(starts)));
    }
    times.sort((a, b) => a - b);
    const depthSecs = times[2];
    return {
      recipesPerSec: recipesPerRun(small) / exactSecs,
      secsPerStart: depthSecs / starts,
    };
  }

  // Recipes an exact run checks: each free ingredient 0..alpha_ub, total <= 25
  function recipesPerRun(p) {
    const nFree = N_INGREDIENTS - (p.n_avoid ?? 4);
    const ub = Math.min(p.alpha_ub, 25);
    let count = new Array(26).fill(1);
    for (let j = 0; j < nFree; j++) {
      const next = new Array(26).fill(0);
      for (let t = 0; t <= 25; t++) {
        for (let x = 0; x <= Math.min(ub, t); x++) next[t] += count[t - x];
      }
      count = next;
    }
    return count[25];
  }

  // A depth box of the window (as the depth of "Limitar búsqueda"): a
  // number typed or slid, or "Óptima" (∞, the slider dimmed; typing or
  // sliding turns it off). onChange() after every change
  function depthBox(prefix, { max, value, exact, onChange }) {
    const card = $(`${prefix}Card`);
    const input = $(`${prefix}Input`);
    const slider = $(`${prefix}Slider`);
    const check = $(`${prefix}Exact`);
    slider.max = String(max);
    const clamp = (v) => Math.min(max, Math.max(1, Math.round(Number(v)) || 1));
    const box = { depth: clamp(value), exact: !!exact };
    const show = () => {
      card.classList.toggle("is-exact", box.exact);
      input.value = box.exact ? "∞" : String(box.depth);
      slider.value = String(box.depth);
      check.checked = box.exact;
      onChange();
    };
    slider.oninput = () => {
      box.depth = clamp(slider.value);
      box.exact = false;
      show();
    };
    // While typing, an empty or partial number is left as it is
    input.oninput = () => {
      const digits = input.value.replace(/\D/g, "");
      if (digits === "") return;
      box.depth = clamp(digits);
      box.exact = false;
      card.classList.remove("is-exact");
      check.checked = false;
      slider.value = String(box.depth);
      onChange();
    };
    input.onfocus = () => {
      if (box.exact) input.select();
    };
    input.onchange = show;
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        $("complementExactGo").click();
      }
    };
    check.onchange = () => {
      box.exact = check.checked;
      show();
    };
    show();
    return box;
  }

  // Short times too ("70 ms", "1.2 s"), for one recipe
  const shortDuration = (sec) => {
    if (sec < 1) return `${Math.max(1, Math.round(sec * 1000))} ms`;
    if (sec < 60) return `${(Math.round(sec * 10) / 10).toLocaleString()} s`;
    return roughDuration(sec);
  };

  // The effects depth last chosen (per browser): the next search starts there
  const EFFECT_DEPTH_KEY = "complementEffectDepth";
  function lastEffectDepth() {
    try {
      const saved = JSON.parse(localStorage.getItem(EFFECT_DEPTH_KEY));
      if (saved && Number.isFinite(saved.depth)) return saved;
    } catch (e) {}
    return { depth: DEFAULT_EFFECT_DEPTH, exact: false };
  }

  function askSearch(p) {
    const modal = $("complementExact");
    const depthInput = document.querySelector("input[name='n_starts']");
    const exactInput = document.getElementById("exactSearch");
    const nSets = setsOf(p);
    const perSet = runsPerSet(p);
    const recipes = recipesPerRun(p);
    const speed = measureSpeeds(p);

    let recipeBox = null;
    let effectsBox = null;
    const update = () => {
      if (!recipeBox || !effectsBox) return;
      const perRecipe = recipeBox.exact
        ? recipes / speed.recipesPerSec
        : recipeBox.depth * speed.secsPerStart;
      const sets = effectsBox.exact ? nSets : estimatedSets(p, effectsBox.depth);
      $("depthRecipeNote").textContent = recipeBox.exact
        ? fmt(T.depthAllRecipes, { recipes: recipes.toLocaleString() })
        : fmt(T.depthPerRecipe, { time: shortDuration(perRecipe) });
      $("depthEffectsNote").textContent = effectsBox.exact || sets >= nSets
        ? fmt(T.depthAllSets, { total: nSets.toLocaleString() })
        : fmt(T.depthSets, { sets: Math.round(sets).toLocaleString(), total: nSets.toLocaleString() });
      const runs = Math.round(sets * perSet);
      $("complementExactTotal").textContent = fmt(T.depthTotal, {
        time: roughDuration(runs * perRecipe),
        runs: runs.toLocaleString(),
      });
    };
    // Recipes: as on the form ("Limitar búsqueda"); effects: as last time
    recipeBox = depthBox("depthRecipe", {
      max: Number(depthInput.max),
      value: Number(depthInput.value),
      exact: exactInput.checked,
      onChange: update,
    });
    const last = lastEffectDepth();
    effectsBox = depthBox("depthEffects", {
      max: maxEffectDepth(p),
      value: last.depth,
      exact: last.exact,
      onChange: update,
    });
    update();

    openWindow(modal);
    const close = () => closeWindow(modal);
    $("complementExactGo").onclick = () => {
      close();
      // The recipe depth goes to the form (it is that setting); the effects
      // one is remembered for next time
      exactInput.checked = recipeBox.exact;
      exactInput.dispatchEvent(new Event("change"));
      depthInput.value = String(recipeBox.depth);
      depthInput.dispatchEvent(new Event("input", { bubbles: true }));
      try {
        localStorage.setItem(EFFECT_DEPTH_KEY, JSON.stringify({ depth: effectsBox.depth, exact: effectsBox.exact }));
      } catch (e) {}
      start({ ...currentParams(), effect_exact: effectsBox.exact, effect_depth: effectsBox.depth }, null);
      setLocked(true);
    };
    modal.querySelectorAll("[data-exact-cancel]").forEach((b) => {
      b.onclick = close;
    });
    $("complementExactGo").focus();
  }

  // ---- Saved search with other settings: continue it or start a new one ----
  function askSaved() {
    const modal = $("complementConfirm");
    const pct = state && state.total ? (100 * state.done) / state.total : 0;
    $("complementConfirmProgress").textContent = fmt(T.savedProgress, { pct: pct.toFixed(pct < 10 ? 2 : 1) });
    openWindow(modal);
    const close = () => closeWindow(modal);
    $("complementConfirmContinue").onclick = () => {
      close();
      showSearch();
    };
    $("complementConfirmNew").onclick = () => {
      close();
      discardSaved();
    };
    // Closing without choosing: the mode stays off
    modal.querySelector("[data-confirm-cancel]").onclick = () => {
      close();
      toggle.checked = false;
      setMode(false);
    };
    $("complementConfirmContinue").focus();
  }

  // ---- Best recipe window ----
  function showRecipe(entry) {
    const modal = $("complementRecipe");
    const solver = new CauldronSolver({
      B: C.matrices.B,
      V: C.matrices.V,
      effects: [...params.effects, ...entry.comp],
      weights: [...params.weights, ...entry.comp.map(() => 0)],
      premiumIngr: entry.avoid,
      alphaUB: params.alpha_ub,
      probUB: params.prob_ub,
    });
    const probs = solver.probabilities(entry.recipe);
    const grid = $("complementRecipeGrid");
    grid.innerHTML = "";
    entry.recipe.forEach((amount, j) => {
      const cell = document.createElement("div");
      cell.className = "ingredient-card" + (amount === 0 ? " zero" : "");
      if (entry.avoid.includes(j)) cell.classList.add("avoided");
      cell.innerHTML =
        `<img class="ingredient-icon" alt="" src="/static/ingredients/ingredient_crystal${j + 1}.png">` +
        `<div class="value-overlay"><span class="value-text">${amount}</span></div>`;
      grid.appendChild(cell);
    });
    const list = $("complementRecipeEffects");
    list.innerHTML = "";
    const effects = [...params.effects, ...entry.comp];
    effects
      .map((e, i) => ({ e, p: probs[i], comp: i >= params.effects.length }))
      // Effects the recipe cannot give (they would read 0.00%) are left out
      .filter(({ p }) => p >= 0.005)
      .sort((a, b) => b.p - a.p)
      .forEach(({ e, p, comp }) => {
        const row = document.createElement("div");
        row.className = "recipe-row" + (comp ? " is-complement" : "");
        row.innerHTML =
          `<span class="recipe-row-value">${p.toFixed(2)}%</span>` +
          `<img class="recipe-row-icon" alt="" src="/static/effects/effect${e + 1}.png">` +
          `<span class="recipe-row-name">${C.effectNames[e]}</span>`;
        list.appendChild(row);
      });
    $("complementRecipeScore").textContent = fmt(isChance() ? T.scoresChance : T.scores, {
      avg: entry.avg.toFixed(2),
      best: entry.best.toFixed(2),
    });
    openWindow(modal);
    const close = () => closeWindow(modal);
    modal.querySelectorAll("[data-recipe-close]").forEach((b) => {
      b.onclick = close;
    });
  }

  const keyOf = (entry) => entry.comp.join(",");

  // The sets shown (5, as many as the worker keeps), best first by the
  // chosen criterion. States saved
  // before min/max lists existed only have `top`: sort that instead
  function shownList(s) {
    const lists = { avg: s.top, worst: s.topWorst, best: s.topBest };
    const list = lists[sortBy] && lists[sortBy].length
      ? lists[sortBy]
      : [...s.top].sort((a, b) => (b[sortBy] ?? -Infinity) - (a[sortBy] ?? -Infinity));
    return list.slice(0, SHOWN);
  }

  // The set the user selected in the ranking, or the top one
  function selectedEntry() {
    const shown = shownList(state);
    return shown.find((e) => keyOf(e) === selectedKey) || shown[0];
  }

  // Stats of a combination over its ingredient sets (tooltip.js table)
  function statsRows(entry) {
    const v = (x) => (Number.isFinite(x) ? x.toFixed(4) : "—");
    return JSON.stringify([
      [T.statMin, v(entry.worst)],
      [T.statMax, v(entry.best)],
      [T.statMean, v(entry.avg)],
      [T.statStd, v(entry.std)],
    ]);
  }

  // Bar on a scale shared by all rows: thin line worst..best, box
  // average ± std, mark at the average
  function rangeBar(entry, lo, hi) {
    const pos = (v) => `${(100 * (v - lo)) / (hi - lo || 1)}%`;
    const known = Number.isFinite(entry.worst) && Number.isFinite(entry.std);
    const worst = known ? entry.worst : entry.avg;
    const boxLo = known ? Math.max(lo, entry.avg - entry.std) : entry.avg;
    const boxHi = known ? Math.min(hi, entry.avg + entry.std) : entry.avg;
    return (
      `<span class="complement-range">` +
      `<span class="range-line" style="left:${pos(worst)};right:calc(100% - ${pos(entry.best)})"></span>` +
      `<span class="range-box" style="left:${pos(boxLo)};right:calc(100% - ${pos(boxHi)})"></span>` +
      `<span class="range-avg" style="left:${pos(entry.avg)}"></span>` +
      `</span>`
    );
  }

  // ---- Drawing ----
  // Runs done, with the share of the one in progress (exact runs can take
  // minutes each; a paused run starts over, so only while running)
  const doneSoFar = (s) => s.done + (worker ? s.partial || 0 : 0);

  function render() {
    const on = toggle.checked;
    const running = !!worker;
    const s = state;
    const p = params || (on ? currentParams() : null);

    if (!on) return;
    // Applying the best result: only when stopped or finished
    const hasResult = !running && !!s && s.top.length > 0;
    applyBtn.disabled = !hasResult;
    // Running: Pausar. Paused: Continuar. Finished: Cerrar
    const finished = !!s && s.done >= s.total;
    stopLabel.textContent = running ? T.stop : finished || !s ? T.close : T.resume;
    stopBtn.dataset.tip = running ? T.stopTip : finished || !s ? "" : T.resumeTip;
    // Green when it continues the search, red when it stops or closes
    const resumes = !running && !finished && !!s;
    stopBtn.classList.toggle("avatar-btn-save", resumes);
    stopBtn.classList.toggle("avatar-btn-cancel", !resumes);
    // The X stops nothing: only usable when the search is not running
    closeX.disabled = running;

    // The mode's button: what it will do now
    const finishedNow = !!s && s.done >= s.total;
    setGoLabel(!s ? T.button : running || finishedNow ? T.viewResults : T.resume);
    goBtn.dataset.tip = !s ? T.goTip : running || finishedNow ? "" : T.resumeTip;
    goBtn.disabled = !s && !!validate(currentParams());

    // Note under the switch: with a search, its state (the form is locked
    // on its values); otherwise what is missing or the size of the search
    hint.classList.remove("is-error");
    if (s) {
      const pct = s.total ? (100 * s.done) / s.total : 0;
      const p = pct.toFixed(pct < 10 ? 2 : 1);
      hint.textContent = running
        ? `${T.running} ${p}%`
        : s.done >= s.total ? T.doneHint : fmt(T.resumeHint, { pct: p });
    } else {
      const cur = currentParams();
      const problem = validate(cur);
      hint.classList.toggle("is-error", !!problem);
      hint.textContent = problem || fmt(T.sets, { sets: setsOf(cur).toLocaleString() });
    }

    if (s) {
      // Below 100% until it is done (a climb's total is an estimate)
      const pct = s.done >= s.total ? 100 : s.total ? Math.min(99.9, (100 * doneSoFar(s)) / s.total) : 0;
      barFill.style.width = `${pct}%`;
      bar.setAttribute("aria-valuenow", pct.toFixed(1));
      // Climbing: its climbs and the sets tried (the total is an estimate)
      countsEl.textContent = s.climb
        ? `${fmt(T.climbRuns, {
          k: Math.min(s.climb.k + 1, params.effect_depth),
          n: params.effect_depth,
          sets: s.climb.tried.toLocaleString(),
        })} (${pct.toFixed(pct < 10 ? 2 : 1)}%)`
        : fmt(T.runs, {
          done: s.done.toLocaleString(),
          total: s.total.toLocaleString(),
          pct: pct.toFixed(pct < 10 ? 2 : 1),
        });
      const left = s.total - doneSoFar(s);
      // Time left only while running (needs the measured speed)
      etaEl.textContent = left === 0 || !running || !rate ? "" : fmt(T.eta, {
        eta: rate ? formatDuration(left / rate) : "…",
      });
      statusEl.textContent =
        s.done >= s.total ? T.done : running ? T.running : T.paused;
    } else {
      barFill.style.width = "0%";
      countsEl.textContent = p && !validate(p)
        ? fmt(T.sets, { sets: setsOf(p).toLocaleString() })
        : "";
      etaEl.textContent = "";
      statusEl.textContent = T.ready;
    }

    // The set being tested now, with its progress over its ingredient sets
    const testing = s && s.done < s.total ? s.current : null;
    const curBox = $("complementCurrent");
    curBox.hidden = !testing;
    if (testing) {
      const key = keyOf(testing);
      if (curBox.dataset.key !== key) {
        curBox.dataset.key = key;
        $("complementCurrentEffects").innerHTML = testing.comp
          .map((e) => `<img src="/static/effects/effect${e + 1}.png" alt="${C.effectNames[e]}" title="${C.effectNames[e]}">`)
          .join("");
      }
      $("complementCurrentFill").style.width = `${(100 * (testing.count + (running ? s.partial || 0 : 0))) / runsPerSet(params)}%`;
      $("complementCurrentCount").textContent = `${testing.count}/${runsPerSet(params)}`;
    }

    topList.innerHTML = "";
    win.querySelector(".complement-sort").hidden = !(s && s.top.length);
    if (s && s.top.length) {
      const shown = shownList(s);
      const sel = selectedEntry();
      // One scale for all the bars: from the lowest worst to the highest best
      const lo = Math.min(...shown.map((e) => (Number.isFinite(e.worst) ? e.worst : e.avg)));
      const hi = Math.max(...shown.map((e) => e.best));
      // Same columns in every row: the icons column fits the number of
      // complementary effects, so all bars start and end at the same place
      topList.style.setProperty("--icons", String(shown[0].comp.length));
      shown.forEach((entry, rank) => {
        const row = document.createElement("div");
        row.className = "complement-row" + (entry === sel ? " is-selected" : "");
        row.setAttribute("role", "radio");
        row.dataset.tipRows = statsRows(entry);
        row.setAttribute("aria-checked", String(entry === sel));
        row.tabIndex = 0;
        const icons = entry.comp
          .map((e) => `<img src="/static/effects/effect${e + 1}.png" alt="${C.effectNames[e]}" title="${C.effectNames[e]}">`)
          .join("");
        row.innerHTML =
          `<span class="complement-rank">${rank + 1}</span>` +
          `<span class="complement-effects">${icons}</span>` +
          rangeBar(entry, lo, hi) +
          `<span class="complement-score">${Number.isFinite(entry[sortBy]) ? entry[sortBy].toFixed(2) + (isChance() ? "%" : "") : "—"}</span>` +
          `<button type="button" class="complement-recipe-btn" data-tip="${T.showRecipe}" aria-label="${T.showRecipe}">` +
          `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>` +
          `</button>`;
        const select = () => {
          selectedKey = keyOf(entry);
          render();
        };
        row.addEventListener("click", (e) => {
          if (e.target.closest(".complement-recipe-btn")) showRecipe(entry);
          else select();
        });
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select();
          }
        });
        topList.appendChild(row);
      });
      const legend = document.createElement("p");
      legend.className = "complement-legend";
      legend.innerHTML =
        `<span class="complement-range legend-sample">` +
        `<span class="range-line" style="left:0;right:0"></span>` +
        `<span class="range-box" style="left:30%;right:30%"></span>` +
        `<span class="range-avg" style="left:50%"></span></span> ${T.legend}`;
      topList.appendChild(legend);
    } else if (s) {
      topList.innerHTML = `<p class="complement-empty">${fmt(T.noResults, { runs: runsPerSet(params) })}</p>`;
    }
  }

  // ---- Wiring ----
  const sortBtns = [...win.querySelectorAll(".complement-sort-btn")];
  sortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      sortBy = btn.dataset.sort;
      sortBtns.forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
      render();
    });
  });
  toggle.addEventListener("change", () => setMode(toggle.checked));
  // Enter in the form would submit the normal search: not in this mode
  searchBtn.form.addEventListener("submit", (e) => {
    if (toggle.checked) e.preventDefault();
  });
  goBtn.addEventListener("click", go);
  // Running: stop and save. Stopped: continue. Finished: close the window
  stopBtn.addEventListener("click", () => {
    if (worker) stop();
    else if (state && state.done < state.total) start(params, state);
    else closeWindow(win);
  });
  // Leaving the mode puts the best result on the form (setMode)
  function applyBest() {
    closeWindow(win);
    toggle.checked = false;
    setMode(false);
  }
  applyBtn.addEventListener("click", applyBest);
  // Disabled while running (render), so it never stops a search by surprise
  closeX.addEventListener("click", () => {
    if (!worker) closeWindow(win);
  });
  // Keep the hint up to date while the user edits the effects and limits
  searchBtn.form.addEventListener("input", () => render());
  searchBtn.form.addEventListener("change", () => render());
  window.addEventListener("beforeunload", (e) => {
    if (worker) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Turn the mode back on after a reload
  function restoreMode() {
    let remembered = false;
    try {
      remembered = sessionStorage.getItem("complementMode") === "1";
    } catch (e) {}
    if (remembered) {
      toggle.checked = true;
      setMode(true);
    }
  }
  restoreMode();

  // For autofill.js: integrations must not change the form while this mode
  // is on (it shows a search's settings, locked)
  window.cauldronComplement = { active: () => toggle.checked };
}

// After the whole page is parsed: the windows are at the end of the page.
// optimizer.js registered its own DOMContentLoaded handler first, so the form
// is built before this runs.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initComplement);
} else {
  initComplement();
}
