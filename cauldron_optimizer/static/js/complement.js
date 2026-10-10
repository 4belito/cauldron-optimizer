// "Complete effects" mode: the user picks fewer than 10 effects and a long
// search (complement-worker.js, in the browser) finds the complementary
// effects that complete them to 10, trying all 495 sets of 4 avoided
// ingredients for each. The search runs in a window opened by "Completar";
// stopping it saves the progress (per world) so "Completar" continues later.
// Uses window.cauldronForm (optimizer.js) and window.COMPLEMENT (index.html).

function initComplement() {
  const C = window.COMPLEMENT;
  if (!C) return;
  const T = C.text;
  const MAX_CHOSEN = 9;
  const RUNS_PER_SET = 495;
  const SHOWN = 5;

  const $ = (id) => document.getElementById(id);
  const toggle = $("complementToggle");
  const win = $("complementWindow");
  const hint = $("complementHint");
  const searchBtn = $("searchBtn");
  const searchLabel = searchBtn.querySelector("span");
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
  const closeX = win.querySelector("[data-complement-close]");
  const topList = $("complementTop");
  const csrf = () => document.querySelector("input[name='csrf_token']").value;

  let worker = null;
  let saved = null; // {params, state} stored in the database for this world
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
    };
  }

  function validate(p) {
    if (p.n < 10) return T.needDiplomas;
    if (p.effects.length < 1 || p.effects.length > MAX_CHOSEN || !p.weights.some((w) => w > 0)) {
      return T.needEffects;
    }
    return null;
  }

  // Key order differs once saved (the database sorts JSON keys)
  const PARAM_KEYS = ["n", "effects", "weights", "alpha_ub", "prob_ub", "depth"];
  const sameParams = (a, b) =>
    !!a && !!b && PARAM_KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
  const totalRuns = (p) => binom(p.n - p.effects.length, 10 - p.effects.length) * RUNS_PER_SET;

  // ---- Mode on / off ----
  function setMode(on) {
    if (!on && worker) stop();
    // Leaving the mode with a result: the selected set's 10 effects end up
    // checked (the one with the highest average by default)
    const best = !on && params && state && state.top.length ? selectedEntry() : null;
    window.cauldronForm.setComplementMode(
      on,
      best && { n: params.n, effects: params.effects, weights: params.weights, comp: best.comp }
    );
    hint.hidden = !on;
    document.body.classList.toggle("complement-on", on);
    premiumCard.classList.toggle("is-disabled", on);
    premiumCard.querySelectorAll("input[name='premium_ingredients[]']").forEach((el) => {
      if (on) el.checked = false;
      el.disabled = on;
    });
    saveSettingsBtn.disabled = on;
    searchLabel.textContent = on ? T.button : C.searchLabel;
    searchBtn.dataset.tip = on ? T.buttonTip : C.searchTip;
    try {
      sessionStorage.setItem("complementMode", on ? "1" : "");
    } catch (e) {}
    // The form is left as it is: a saved search is offered by the hint and
    // by "Restaurar" in the new-search window
    if (on && !params) loadSaved();
    render();
  }

  async function loadSaved() {
    try {
      const resp = await fetch(C.urls.state, { headers: { Accept: "application/json" } });
      const data = await resp.json();
      saved = data.search;
      if (saved && !state) {
        params = saved.params;
        state = saved.state;
      }
    } catch (e) {
      saved = null;
    }
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
    msgEl.textContent = "";
    openWindow(win);
    worker = new Worker(C.urls.worker);
    runStart = { time: Date.now(), done: state.done };
    worker.onmessage = (e) => {
      state = e.data.state;
      const secs = (Date.now() - runStart.time) / 1000;
      if (secs > 2) rate = (state.done - runStart.done) / secs;
      if (e.data.type === "done") {
        worker = null;
        save();
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

  async function save() {
    if (!state) return;
    msgEl.textContent = "";
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
      saved = { params, state };
      msgEl.classList.remove("is-error");
      msgEl.textContent = state.done >= state.total ? "" : T.saved;
    } catch (err) {
      msgEl.classList.add("is-error");
      msgEl.textContent = err.message;
    }
    render();
  }

  async function clearSaved() {
    await fetch(C.urls.clear, {
      method: "POST",
      headers: { Accept: "application/json", "X-CSRFToken": csrf() },
    }).catch(() => {});
    saved = null;
  }

  // "Completar": continue the same search (or show its results), or start a
  // new one after warning that the previous progress will be lost
  function onSearch(e) {
    if (!toggle.checked) return;
    e.preventDefault();
    if (worker) {
      openWindow(win);
      return;
    }
    const p = currentParams();
    const problem = validate(p);
    if (problem) {
      render();
      return;
    }
    if (sameParams(p, params) && state) {
      if (state.done >= state.total) openWindow(win);
      else start(p, state);
      return;
    }
    if (saved || (state && state.done > 0)) {
      confirmNew(
        () => {
          clearSaved();
          state = null;
          rate = null;
          selectedKey = null;
          start(p, null);
        },
        () => {
          // Back to the saved search's values: continue it, or show its results
          window.cauldronForm.applyComplementParams(params);
          if (state.done >= state.total) openWindow(win);
          else start(params, state);
        }
      );
      return;
    }
    start(p, null);
  }

  // ---- Confirmation window (same look as the delete window) ----
  function confirmNew(onConfirm, onRestore) {
    const modal = $("complementConfirm");
    const ok = $("complementConfirmOk");
    $("complementConfirmRestore").onclick = () => {
      closeWindow(modal);
      onRestore();
    };
    openWindow(modal);
    const close = () => closeWindow(modal);
    ok.onclick = () => {
      close();
      onConfirm();
    };
    modal.querySelectorAll("[data-confirm-cancel]").forEach((b) => {
      b.onclick = close;
    });
    modal.querySelector("[data-confirm-cancel]").focus();
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
    $("complementRecipeScore").textContent = fmt(T.scores, {
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

  // Stats of a combination over its 495 ingredient sets (tooltip.js table)
  function statsRows(entry) {
    const v = (x) => (Number.isFinite(x) ? x.toFixed(2) : "—");
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
  function render() {
    const on = toggle.checked;
    const running = !!worker;
    const s = state;
    const p = params || (on ? currentParams() : null);

    if (!on) return;
    // Applying the best result: only when stopped or finished
    const hasResult = !running && !!s && s.top.length > 0;
    applyBtn.disabled = !hasResult;
    // Running: Detener. Stopped: Continuar. Finished: Cerrar
    const finished = !!s && s.done >= s.total;
    stopLabel.textContent = running ? T.stop : finished || !s ? T.close : T.resume;
    stopBtn.dataset.tip = running ? T.stopTip : finished || !s ? "" : T.resumeTip;
    // The X stops nothing: only usable when the search is not running
    closeX.disabled = running;

    // Line under the button: what is missing, or what "Completar" will do
    const cur = currentParams();
    const problem = validate(cur);
    hint.classList.toggle("is-error", !!problem);
    if (problem) hint.textContent = problem;
    else if (running && s) {
      const pct = s.total ? (100 * s.done) / s.total : 0;
      hint.textContent = `${T.running} ${pct.toFixed(pct < 10 ? 2 : 1)}%`;
    }
    else if (s && sameParams(cur, params)) {
      const pct = s.total ? (100 * s.done) / s.total : 0;
      hint.textContent = s.done >= s.total
        ? T.doneHint
        : fmt(T.resumeHint, { pct: pct.toFixed(pct < 10 ? 2 : 1) });
    } else if (s && s.done > 0) {
      // A different search is saved: Completar offers to restore it
      const pct = s.total ? (100 * s.done) / s.total : 0;
      hint.textContent = fmt(T.otherSaved, {
        pct: pct.toFixed(pct < 10 ? 2 : 1),
        total: totalRuns(cur).toLocaleString(),
      });
    } else {
      hint.textContent = fmt(T.estimate, { total: totalRuns(cur).toLocaleString() });
    }

    if (s) {
      const pct = s.total ? (100 * s.done) / s.total : 0;
      barFill.style.width = `${pct}%`;
      bar.setAttribute("aria-valuenow", pct.toFixed(1));
      countsEl.textContent = fmt(T.runs, {
        done: s.done.toLocaleString(),
        total: s.total.toLocaleString(),
        pct: pct.toFixed(pct < 10 ? 2 : 1),
      });
      const left = s.total - s.done;
      // Time left only while running (needs the measured speed)
      etaEl.textContent = left === 0 || !running || !rate ? "" : fmt(T.eta, {
        eta: rate ? formatDuration(left / rate) : "…",
      });
      statusEl.textContent =
        s.done >= s.total ? T.done : running ? T.running : T.paused;
    } else {
      barFill.style.width = "0%";
      countsEl.textContent = p && !validate(p)
        ? fmt(T.estimate, { total: totalRuns(p).toLocaleString() })
        : "";
      etaEl.textContent = "";
      statusEl.textContent = T.ready;
    }

    // The set being tested now, with its progress over the 495 ingredient sets
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
      $("complementCurrentFill").style.width = `${(100 * testing.count) / RUNS_PER_SET}%`;
      $("complementCurrentCount").textContent = `${testing.count}/${RUNS_PER_SET}`;
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
          `<span class="complement-score">${Number.isFinite(entry[sortBy]) ? entry[sortBy].toFixed(2) : "—"}</span>` +
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
      topList.innerHTML = `<p class="complement-empty">${T.noResults}</p>`;
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
  searchBtn.form.addEventListener("submit", onSearch);
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
}

// After the whole page is parsed: the windows are at the end of the page.
// optimizer.js registered its own DOMContentLoaded handler first, so the form
// is built before this runs.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initComplement);
} else {
  initComplement();
}
