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
  let busy = false;

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
    return {
      effects,
      weights: activeWeights,
      premiumIngr,
      alphaUB: val("alpha_UB"),
      probUB: val("prob_UB"),
      depth: val("n_starts"),
    };
  }

  function showWindow(on) {
    modal.hidden = !on;
    document.body.classList.toggle("avatar-open", on);
    fill.style.width = "0%";
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
    const send = () => {
      worker.terminate();
      busy = false;
      form.submit(); // no submit event: goes straight to the server
    };
    worker.onmessage = (msg) => {
      if (msg.data.type === "progress") {
        fill.style.width = `${Math.round(100 * msg.data.fraction)}%`;
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
