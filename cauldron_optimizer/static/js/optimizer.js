// ----- Data injected from Flask (set via inline script in template) -----
// window.OPTIMIZER_CONFIG = { defaultWeights, effectNames, dom, boundsFields }

function updateHiddenWeights(values) {
  const { weightsHidden } = window.OPTIMIZER_CONFIG.dom;
  if (weightsHidden) weightsHidden.value = JSON.stringify(values);
}

function makeRangeCard({ labelText, name, iconSrc, min, max, step, value, format = (x) => x }) {
  const card = document.createElement("div");
  card.className = "weight-card";

  const topRow = document.createElement("div");
  topRow.className = "weight-top-row";

  if (iconSrc) {
    const img = document.createElement("img");
    img.src = iconSrc;
    img.className = "effect-icon";
    img.alt = labelText;
    topRow.appendChild(img);
  }

  const valueText = document.createElement("span");
  valueText.className = "weight-value";
  valueText.textContent = format(value);

  topRow.appendChild(valueText);
  card.appendChild(topRow);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.name = name;
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);

  card.appendChild(slider);

  const label = document.createElement("div");
  label.className = "weight-label";
  label.textContent = labelText;
  label.title = labelText;

  card.appendChild(label);

  slider.addEventListener("input", () => {
    valueText.textContent = format(slider.value);
  });

  return card;
}

function makeEffectCheckbox(checked, labelText) {
  const label = document.createElement("label");
  label.className = "effect-check";
  label.title = labelText;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;

  const box = document.createElement("img");
  box.src = "/static/checkbox.png";
  box.className = "effect-check-box";
  box.alt = "";

  const mark = document.createElement("img");
  mark.src = "/static/check_small.png";
  mark.className = "effect-check-mark";
  mark.alt = "";

  label.append(input, box, mark);
  return label;
}

// The game brews with 10 effects: at least this many must be checked (all of
// them with fewer diplomas). Boxes never lock; "Buscar receta" waits instead
const MIN_CHECKED_EFFECTS = 10;

// "Complete effects" mode (complement.js): the user picks fewer than 10 effects
// and the search finds the rest, so at most this many can be checked
const MAX_COMPLEMENT_CHOSEN = 9;
let complementMode = false;
let checkedBeforeComplement = null;

function updateEffectLocks(root) {
  const inputs = [...root.querySelectorAll(".effect-check input")];
  const nChecked = inputs.filter((el) => el.checked).length;
  // Only "Completar efectos" limits the boxes (fewer than 10 chosen)
  inputs.forEach((el) => {
    const isLocked = complementMode && !el.checked && nChecked >= MAX_COMPLEMENT_CHOSEN;
    el.disabled = isLocked;
    el.parentElement.classList.toggle("locked", isLocked);
  });
  updateEffectsCounter();
}

// One slot per diploma, filled with the checked effects' icons: the first
// slots up to the minimum are required (dashed), the rest optional (dotted).
// Room is kept for every possible diploma (unused slots are invisible), so
// the counter and its text never move when the diplomas change
let effectsProblem = null; // why the effects do not allow a search, or null

function updateEffectsCounter() {
  const counter = document.getElementById("effectsCounter");
  if (!counter) return;
  const n = Number(window.OPTIMIZER_CONFIG.dom.nDiploma.value) || 0;
  const required = Math.min(n, MIN_CHECKED_EFFECTS);
  const checked = [];
  let weighted = false;
  for (let i = 0; i < n; i++) {
    if (globalChecked[i] === false) continue;
    checked.push(i);
    if ((globalWeights[i] ?? 0) > 0) weighted = true;
  }

  const slots = document.getElementById("effectsSlots");
  const maxSlots = window.OPTIMIZER_CONFIG.effectNames.length;
  slots.replaceChildren(
    ...Array.from({ length: maxSlots }, (_, k) => {
      const slot = document.createElement("span");
      slot.className = "premium-slot effect-slot";
      if (k >= n) {
        slot.classList.add("unused");
      } else if (k < checked.length) {
        slot.classList.add("filled");
        // Checked only to reach the minimum (no weight): grey ring
        if (!((globalWeights[checked[k]] ?? 0) > 0)) slot.classList.add("filler");
        slot.style.backgroundImage = `url("/static/effects/effect${checked[k] + 1}.png")`;
      } else if (k >= required) {
        slot.classList.add("optional");
      }
      return slot;
    })
  );

  // Checked effects without a weight get a grey mark (they only fill up to
  // the minimum); the wanted ones keep the green
  window.OPTIMIZER_CONFIG.dom.weightsContainer
    .querySelectorAll(".weight-card")
    .forEach((card, i) => {
      const check = card.querySelector(".effect-check");
      if (check) check.classList.toggle("filler", globalChecked[i] !== false && !((globalWeights[i] ?? 0) > 0));
    });

  // Select-all box: all / none / some (indeterminate)
  const all = document.getElementById("effectsAll");
  if (all) {
    all.checked = n > 0 && checked.length === n;
    all.indeterminate = checked.length > 0 && checked.length < n;
  }

  const d = counter.dataset;
  const rule = n > MIN_CHECKED_EFFECTS
    ? d.textMin.replace("{min}", MIN_CHECKED_EFFECTS)
    : d.textAll.replace("{n}", n);
  const enough = checked.length >= required;
  effectsProblem = !enough ? rule : !weighted ? d.textWeight : null;
  document.getElementById("effectsCounterText").textContent = enough && !weighted ? d.textWeight : rule;
  counter.classList.toggle("is-complete", !effectsProblem);
  updateSearchButton();
  updateSaveButton();
}

// Save waits for valid effects too (the ingredients are not saved, so they do
// not count). "Completar efectos" keeps it disabled (complement.js)
function updateSaveButton() {
  const btn = document.getElementById("saveSettingsBtn");
  if (!btn) return;
  btn.dataset.tipDefault ??= btn.dataset.tip || "";
  btn.disabled = complementMode || !!effectsProblem;
  btn.dataset.tip = effectsProblem && !complementMode ? effectsProblem : btn.dataset.tipDefault;
}

function updateHiddenExcluded(n) {
  const { excludedHidden } = window.OPTIMIZER_CONFIG.dom;
  if (!excludedHidden) return;
  const excluded = [];
  for (let i = 0; i < n; i++) {
    if (globalChecked[i] === false) excluded.push(i);
  }
  excludedHidden.value = JSON.stringify(excluded);
}

// The game always avoids exactly this many premium ingredients: once they
// are chosen the rest lock, and "Buscar receta" waits until they are
const MAX_PREMIUM_INGREDIENTS = 4;

function updatePremiumLocks() {
  const inputs = [...document.querySelectorAll("input[name='premium_ingredients[]']")];
  const chosen = inputs.filter((el) => el.checked);
  const full = chosen.length >= MAX_PREMIUM_INGREDIENTS;
  inputs.forEach((el) => {
    const isLocked = full && !el.checked;
    el.disabled = isLocked;
    el.closest(".ingredient-check").classList.toggle("locked", isLocked);
  });
  updatePremiumCounter(chosen);
}

// Four slots that fill with the chosen ingredients, and the search button
// enabled only with exactly four.
function updatePremiumCounter(chosen) {
  const counter = document.getElementById("premiumCounter");
  if (!counter) return;
  const slots = counter.querySelectorAll(".premium-slot");
  slots.forEach((slot, k) => {
    const el = chosen[k];
    const icon = el && el.closest(".ingredient-check").querySelector(".ingredient-check-icon");
    slot.style.backgroundImage = icon ? `url("${icon.src}")` : "";
    slot.classList.toggle("filled", !!el);
  });
  const missing = MAX_PREMIUM_INGREDIENTS - chosen.length;
  counter.classList.toggle("is-complete", missing <= 0);
  premiumProblem = missing !== 0 ? counter.dataset.textButton : null;
  updateSearchButton();
}

let premiumProblem = null; // why the ingredients do not allow a search, or null

// "Buscar receta" is enabled only when both counters are complete; its help
// text says what is missing (effects first, as on the page)
function updateSearchButton() {
  const searchBtn = document.getElementById("searchBtn");
  if (!searchBtn) return;
  searchBtn.dataset.tipDefault ??= searchBtn.dataset.tip || "";
  const problem = effectsProblem || premiumProblem;
  searchBtn.disabled = !!problem;
  searchBtn.dataset.tip = problem || searchBtn.dataset.tipDefault;
}

// Select all: checks every effect, or unchecks them all when all are checked
// (the intermediate choices are made in the panel)
function initEffectsAll() {
  const all = document.getElementById("effectsAll");
  if (!all) return;
  all.addEventListener("change", (e) => {
    e.stopPropagation(); // not a setting by itself: the rebuild below is
    const n = Number(window.OPTIMIZER_CONFIG.dom.nDiploma.value) || 0;
    // A missing entry means checked (the default)
    let allChecked = true;
    for (let i = 0; i < n; i++) if (globalChecked[i] === false) allChecked = false;
    for (let i = 0; i < n; i++) globalChecked[i] = !allChecked;
    rebuildWeights();
    setUnsaved(true);
  });
}

// "Óptima" checks every recipe: the limit of the search depth. Its checkmark
// sits at the top of the depth card; while on, the depth reads "∞" and its
// slider is dimmed. Moving the slider turns it off (one or the other).
function initExactSearch() {
  const toggle = document.getElementById("exactSearch");
  const check = document.getElementById("exactCheck");
  const depth = document.querySelector("input[name='n_starts']");
  if (!toggle || !check || !depth) return;
  const card = depth.closest(".weight-card");
  const value = card.querySelector(".weight-value");
  card.classList.add("depth-card");
  card.querySelector(".weight-top-row").append(check);

  const update = () => {
    card.classList.toggle("is-exact", toggle.checked);
    value.textContent = toggle.checked ? "∞" : String(parseInt(depth.value, 10));
  };
  toggle.addEventListener("change", update);
  depth.addEventListener("input", (e) => {
    // Only the user moving it: a value set by code (e.g. a saved "Completar
    // efectos" search shown on the form) leaves "Óptima" as it is
    if (e.isTrusted) toggle.checked = false;
    update();
  });
  update();
}

// Store current weights globally to preserve them across rebuilds
let globalWeights = [];
// Store effect checkbox states (all checked by default)
let globalChecked = [];

function rebuildWeights() {
  const { defaultWeights, effectNames, dom } = window.OPTIMIZER_CONFIG;
  const n = Number(dom.nDiploma.value);
  dom.weightsContainer.innerHTML = "";
  if (n < 1 || n > effectNames.length) return;

  // Initialize globalWeights if empty, preserving any existing values
  if (globalWeights.length === 0) {
    globalWeights = [...defaultWeights];
    // Restore saved unchecked effects
    (window.OPTIMIZER_CONFIG.defaultExcluded || []).forEach((i) => {
      globalChecked[i] = false;
    });
  }

  // Zero out all weights higher than the number of diplomas
  for (let i = n; i < globalWeights.length; i++) {
    globalWeights[i] = 0;
  }
  // An unchecked effect is left out of the search: no weight either (also
  // fixes settings saved before unchecking reset the weight)
  for (let i = 0; i < n; i++) {
    if (globalChecked[i] === false) globalWeights[i] = 0;
  }

  // Ensure globalWeights array is large enough
  while (globalWeights.length < n) {
    globalWeights.push(0);
  }

  for (let i = 0; i < n; i++) {
    // Use the current weight value, defaulting to 0 if not set
    const currentW = globalWeights[i] ?? 0;

    const card = makeRangeCard({
      labelText: effectNames[i] ?? `Effect ${i + 1}`,
      iconSrc: `/static/effects/effect${i + 1}.png`,
      name: "",
      min: 0,
      max: 1,
      step: 0.01,
      value: currentW,
      format: (x) => Number(x).toFixed(2),
    });

    const slider = card.querySelector('input[type="range"]');
    // Checkbox to the left of the slider
    const sliderRow = document.createElement("div");
    sliderRow.className = "weight-slider-row";
    const check = makeEffectCheckbox(globalChecked[i] ?? true, effectNames[i] ?? "");
    const checkInput = check.querySelector("input");

    slider.addEventListener("input", () => {
      globalWeights[i] = Number(slider.value);
      updateHiddenWeights(globalWeights.slice(0, n));
      // A weight means the effect is wanted: check it if it was unchecked
      // (an unchecked effect is left out of the search)
      if (globalWeights[i] > 0 && !checkInput.checked && !checkInput.disabled) {
        checkInput.checked = true;
        checkInput.dispatchEvent(new Event("change", { bubbles: true }));
        return; // the change handler updates the counter
      }
      updateEffectsCounter();
    });
    card.classList.toggle("excluded", !(globalChecked[i] ?? true));
    check.querySelector("input").addEventListener("change", (e) => {
      globalChecked[i] = e.target.checked;
      // Unchecked: left out of the search, so its weight goes back to 0
      if (!e.target.checked && Number(slider.value) > 0) {
        slider.value = 0;
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      }
      card.classList.toggle("excluded", !e.target.checked);
      updateEffectLocks(dom.weightsContainer);
      updateHiddenExcluded(n);
    });
    slider.replaceWith(sliderRow);
    sliderRow.append(check, slider);

    dom.weightsContainer.appendChild(card);
  }

  updateEffectLocks(dom.weightsContainer);
  initRangeFills(dom.weightsContainer);
  updateHiddenWeights(globalWeights.slice(0, n));
  updateHiddenExcluded(n);
}

// Hooks for complement.js
window.cauldronForm = {
  // On: keep checked only the effects with a weight. Off: restore the boxes,
  // or, given a search result, check exactly its 10 effects (chosen +
  // complementary) so the user can save it with the save button
  setComplementMode(on, result = null) {
    const { dom } = window.OPTIMIZER_CONFIG;
    const n = Number(dom.nDiploma.value);
    if (on && !complementMode) {
      checkedBeforeComplement = [...globalChecked];
      globalChecked = [];
      for (let i = 0; i < n; i++) globalChecked[i] = (globalWeights[i] ?? 0) > 0;
    } else if (!on && complementMode) {
      const before = checkedBeforeComplement;
      checkedBeforeComplement = null;
      if (result) {
        dom.nDiploma.value = result.n;
        globalWeights = new Array(result.n).fill(0);
        result.effects.forEach((e, k) => {
          globalWeights[e] = result.weights[k];
        });
        const ten = new Set([...result.effects, ...result.comp]);
        globalChecked = Array.from({ length: result.n }, (_, i) => ten.has(i));
      } else {
        globalChecked = before || [];
      }
    }
    complementMode = on;
    // Its own rules apply: the counter is only shown, greyed (game.css)
    const counter = document.getElementById("effectsCounter");
    if (counter) counter.inert = on;
    rebuildWeights();
    if (!on && result) {
      dom.nDiploma.dispatchEvent(new Event("input"));
      setUnsaved(true);
    }
  },
  // Show a saved search's parameters on the form (diplomas, chosen effects
  // and weights, search limits)
  applyComplementParams(p) {
    const { dom } = window.OPTIMIZER_CONFIG;
    dom.nDiploma.value = p.n;
    globalWeights = new Array(p.n).fill(0);
    globalChecked = new Array(p.n).fill(false);
    p.effects.forEach((e, k) => {
      globalWeights[e] = p.weights[k];
      globalChecked[e] = true;
    });
    [["alpha_UB", p.alpha_ub], ["prob_UB", p.prob_ub], ["n_starts", p.depth]].forEach(
      ([name, value]) => {
        const el = document.querySelector(`input[name='${name}']`);
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    );
    rebuildWeights();
    // Keeps the -/+ buttons in step with the new count
    dom.nDiploma.dispatchEvent(new Event("input"));
  },
  // The effects the user wants (checked), with their weights
  chosen() {
    const n = Number(window.OPTIMIZER_CONFIG.dom.nDiploma.value);
    const effects = [];
    const weights = [];
    for (let i = 0; i < n; i++) {
      if (globalChecked[i] !== false) {
        effects.push(i);
        weights.push(globalWeights[i] ?? 0);
      }
    }
    return { n, effects, weights };
  },
};

function setRangeFill(el) {
  const min = Number(el.min ?? 0);
  const max = Number(el.max ?? 100);
  const val = Number(el.value ?? 0);
  const p = ((val - min) / (max - min)) * 100;
  el.style.setProperty("--p", p + "%");
}

function initRangeFills(root = document) {
  root.querySelectorAll('input[type="range"]').forEach((el) => {
    setRangeFill(el);
    el.addEventListener("input", () => setRangeFill(el));
  });
}

// Restart a CSS animation class even if it is already applied
function replayClass(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// Restore button: enabled while there are unsaved changes on the page
function setUnsaved(unsaved) {
  document.getElementById("restoreSettingsBtn").disabled = !unsaved;
}

function premiumInputs() {
  return [...document.querySelectorAll("input[name='premium_ingredients[]']")];
}

function hasPremiumSelection() {
  return premiumInputs().some((el) => el.checked);
}

function clearPremiumSelection() {
  premiumInputs().forEach((el) => {
    el.checked = false;
  });
  updatePremiumLocks();
}

function initRestoreButton() {
  const { form } = window.OPTIMIZER_CONFIG.dom;
  form.addEventListener("input", () => setUnsaved(true));
  form.addEventListener("change", () => setUnsaved(true));
  // data-unsaved: the form shows the last search's settings, not the saved ones
  setUnsaved(hasPremiumSelection() || "unsaved" in form.dataset);

  // Reloading the page shows the selected server's saved settings. The
  // ingredient exclusions are temporary, so clear their session copy first.
  document.getElementById("restoreSettingsBtn").addEventListener("click", async () => {
    const btn = document.getElementById("restoreSettingsBtn");
    const data = new FormData();
    const csrf = form.querySelector("input[name='csrf_token']");
    if (csrf) data.append("csrf_token", csrf.value);

    btn.disabled = true;
    clearPremiumSelection();
    try {
      const resp = await fetch(btn.dataset.url, {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) throw new Error(resp.statusText);
    } finally {
      window.location.assign(window.location.pathname);
    }
  });
}

async function saveSettings() {
  const { form } = window.OPTIMIZER_CONFIG.dom;
  const btn = document.getElementById("saveSettingsBtn");
  const status = document.getElementById("saveStatus");

  btn.disabled = true;
  btn.classList.remove("saved", "save-failed");
  status.textContent = "";
  status.classList.remove("error");

  try {
    const payload = new FormData(form);
    payload.delete("premium_ingredients[]");
    const resp = await fetch(btn.dataset.url, {
      method: "POST",
      body: payload,
      headers: { Accept: "application/json" },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.error || resp.statusText);

    replayClass(btn, "saved");
    setUnsaved(hasPremiumSelection());
    form
      .querySelectorAll(".card[data-saved]")
      .forEach((card) => replayClass(card, "just-saved"));
    setTimeout(() => btn.classList.remove("saved"), 1500);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    replayClass(btn, "save-failed");
    status.textContent = message;
    status.classList.add("error");
    return { ok: false, error: message };
  } finally {
    updateSaveButton();
  }
}

// Public hook used by autofill.js. Keeping the save operation here guarantees
// that integrations use the same validation and UI feedback as the button.
window.cauldronSaveSettings = saveSettings;

// Arrow buttons beside the diploma count: one less / one more, as if the
// user typed the new number (so the weights are rebuilt)
function initDiplomaSteppers() {
  const input = window.OPTIMIZER_CONFIG.dom.nDiploma;
  const buttons = document.querySelectorAll(".step-btn");
  const min = () => Number(input.min || 1);
  const max = () => Number(input.max || window.OPTIMIZER_CONFIG.effectNames.length);

  function updateDisabled() {
    const n = Number(input.value);
    buttons.forEach((btn) => {
      const step = Number(btn.dataset.step);
      btn.disabled = step < 0 ? n <= min() : n >= max();
    });
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const current = Number(input.value) || min();
      const next = Math.min(max(), Math.max(min(), current + Number(btn.dataset.step)));
      if (next === current) return;
      if (complementMode && next > current) {
        for (let i = current; i < next; i++) globalChecked[i] = false;
      }
      input.value = next;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
  input.addEventListener("change", updateDisabled);
  input.addEventListener("input", updateDisabled);
  updateDisabled();
}

function initOptimizer() {
  const { dom, boundsFields } = window.OPTIMIZER_CONFIG;

  // Render bounds (alpha_UB, prob_UB, n_starts)
  boundsFields.forEach((cfg) => {
    const card = makeRangeCard({
      labelText: cfg.labelText,
      name: cfg.name,
      min: cfg.min,
      max: cfg.max,
      step: 1,
      value: cfg.value,
      format: (x) => String(parseInt(x, 10)),
    });
    
    // Update bounds fields
    const slider = card.querySelector('input[type="range"]');
    
    dom.boundsContainer.append(card);
  });
  initExactSearch();
  initEffectsAll();

  rebuildWeights();

  // Premium ingredients: lock unchecked ones once the maximum is reached
  document
    .querySelectorAll("input[name='premium_ingredients[]']")
    .forEach((el) => el.addEventListener("change", updatePremiumLocks));
  updatePremiumLocks();
  
  // Rebuild weights when diploma count changes (no auto-submit)
  dom.nDiploma.addEventListener("change", rebuildWeights);
  initDiplomaSteppers();

  document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
  initRestoreButton();

  initRangeFills();
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOptimizer);
} else {
  initOptimizer();
}
