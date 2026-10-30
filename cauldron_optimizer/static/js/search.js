// "Buscar receta" runs the search in the browser (search-worker.js with
// solver.js, ~50x faster than the Python optimizer): the depth search, or,
// with "Óptima", every recipe (guaranteed optimum, 1-2 s). The
// recipe found is sent with the form; the server checks it, computes its
// score and shows the results page. If anything fails here, the form is sent
// as it is and the server searches.

function initBrowserSearch() {
  const form = document.getElementById("optimizerForm");
  const C = window.COMPLEMENT; // matrices B and V, injected in index.html
  if (!form || !C || typeof Worker === "undefined") return;
  const recipeInput = document.getElementById("recipeJson");
  const timeInput = document.getElementById("searchMs");
  const exactInput = document.getElementById("recipeExact");
  const exactToggle = document.getElementById("exactSearch");
  const toggle = document.getElementById("complementToggle");
  const modal = document.getElementById("searchWindow");
  const fill = document.getElementById("searchBarFill");
  const etaEl = document.getElementById("searchEta");
  let busy = false;
  let running = null; // the search's worker while it runs

  // "12 s", "1 min 20 s"
  const formatSeconds = (sec) => {
    const s = Math.max(1, Math.round(sec));
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  };

  const clearRecipe = () => {
    recipeInput.value = "";
    timeInput.value = "";
    exactInput.value = "";
  };

  // The search settings, as the Python optimizer reads them
  function config() {
    const weights = JSON.parse(document.getElementById("effect_weights_json").value);
    const excluded = new Set(JSON.parse(document.getElementById("excluded_effects_json").value));
    const val = (name) => Number(form.querySelector(`input[name='${name}']`).value);
    // Active effects: all unlocked ones except the unchecked
    const effects = [];
    const activeWeights = [];
    weights.forEach((w, i) => {
      if (!excluded.has(i)) {
        effects.push(i);
        activeWeights.push(Number(w));
      }
    });
    const premiumIngr = [...form.querySelectorAll("input[name='premium_ingredients[]']:checked")]
      .map((el) => Number(el.value));
    const wpMax = Number(form.querySelector("input[name='wp_max']").value);
    // "Todos": the chance of getting the wanted effects within the goblets,
    // with no cap per effect (as the server: optimize in routes.py)
    const allEffects = document.getElementById("allEffects");
    const nRounds = allEffects && allEffects.checked ? Number(document.getElementById("nRounds").value) : 0;
    return {
      effects,
      weights: activeWeights,
      premiumIngr,
      alphaUB: val("alpha_UB"),
      probUB: nRounds ? 100 : val("prob_UB"),
      nRounds,
      // ...at least this many of the wanted effects (0: all that can be)
      minEffects: nRounds ? val("min_effects") : 0,
      depth: val("n_starts"),
      wpMax: wpMax > 0 ? wpMax : null, // empty: no limit
      wonderLevel: val("wonder_level"),
    };
  }

  function showWindow(on) {
    modal.hidden = !on;
    document.body.classList.toggle("avatar-open", on);
    fill.style.width = "0%";
    if (etaEl) etaEl.textContent = "";
  }

  form.addEventListener("submit", (e) => {
    // "Completar efectos" mode has its own search (complement.js)
    if (toggle && toggle.checked) return;
    clearRecipe();
    let cfg;
    try {
      cfg = config();
    } catch (err) {
      return; // the server searches
    }
    // Nothing to optimize: let the server explain what is missing
    if (!cfg.effects.length || !cfg.weights.some((w) => w > 0)) return;

    e.preventDefault();
    if (busy) return;
    busy = true;
    const exact = !!(exactToggle && exactToggle.checked);
    // The exact search takes a second or two: show its progress
    if (exact) showWindow(true);

    const worker = new Worker(C.urls.searchWorker);
    running = worker;
    const started = Date.now();
    const send = () => {
      worker.terminate();
      running = null;
      busy = false;
      form.submit(); // no submit event: goes straight to the server
    };
    worker.onmessage = (msg) => {
      if (msg.data.type === "progress") {
        const f = msg.data.fraction;
        fill.style.width = `${Math.round(100 * f)}%`;
        // Time left: the time so far scaled by the share still to check.
        // Only once it is a fair guess, and not for searches of a moment
        const secs = (Date.now() - started) / 1000;
        if (etaEl && f >= 0.05 && secs >= 1 && f < 1) {
          etaEl.textContent = etaEl.dataset.text.replace("{eta}", formatSeconds((secs * (1 - f)) / f));
        }
        return;
      }
      fill.style.width = "100%";
      recipeInput.value = JSON.stringify(msg.data.recipe);
      timeInput.value = String(msg.data.ms);
      exactInput.value = exact ? "1" : "";
      send();
    };
    worker.onerror = () => {
      clearRecipe(); // the server searches instead
      send();
    };
    const { depth, ...solverConfig } = cfg;
    worker.postMessage({ B: C.matrices.B, V: C.matrices.V, config: solverConfig, exact, depth });
  });

  // The window's X (or Escape): stop the search, nothing is sent
  function cancel() {
    if (running) running.terminate();
    running = null;
    busy = false;
    clearRecipe();
    showWindow(false);
  }
  modal.querySelector("[data-search-close]")?.addEventListener("click", cancel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) cancel();
  });

  // Coming back with the browser's back button: no window left open
  window.addEventListener("pageshow", () => {
    busy = false;
    showWindow(false);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBrowserSearch);
} else {
  initBrowserSearch();
}
