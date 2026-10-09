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

// With this many or fewer effects checked, checked boxes lock (like in the game)
const MIN_CHECKED_EFFECTS = 10;

function updateEffectLocks(root) {
  const inputs = [...root.querySelectorAll(".effect-check input")];
  const locked = inputs.filter((el) => el.checked).length <= MIN_CHECKED_EFFECTS;
  inputs.forEach((el) => {
    const isLocked = locked && el.checked;
    el.disabled = isLocked;
    el.parentElement.classList.toggle("locked", isLocked);
  });
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

// At most this many premium ingredients can be avoided; the rest lock
const MAX_PREMIUM_INGREDIENTS = 4;

function updatePremiumLocks() {
  const inputs = [...document.querySelectorAll("input[name='premium_ingredients[]']")];
  const full = inputs.filter((el) => el.checked).length >= MAX_PREMIUM_INGREDIENTS;
  inputs.forEach((el) => {
    const isLocked = full && !el.checked;
    el.disabled = isLocked;
    el.closest(".ingredient-check").classList.toggle("locked", isLocked);
  });
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

  // Ensure globalWeights array is large enough
  while (globalWeights.length < n) {
    globalWeights.push(0);
  }

  // If fewer diplomas leave too few effects checked, re-check all
  let checkedCount = 0;
  for (let i = 0; i < n; i++) {
    if (globalChecked[i] !== false) checkedCount++;
  }
  if (checkedCount < Math.min(n, MIN_CHECKED_EFFECTS)) {
    globalChecked = [];
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
    slider.addEventListener("input", () => {
      globalWeights[i] = Number(slider.value);
      updateHiddenWeights(globalWeights.slice(0, n));
    });

    // Checkbox to the left of the slider
    const sliderRow = document.createElement("div");
    sliderRow.className = "weight-slider-row";
    const check = makeEffectCheckbox(globalChecked[i] ?? true, effectNames[i] ?? "");
    card.classList.toggle("excluded", !(globalChecked[i] ?? true));
    check.querySelector("input").addEventListener("change", (e) => {
      globalChecked[i] = e.target.checked;
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

async function saveSettings() {
  const { form } = window.OPTIMIZER_CONFIG.dom;
  const btn = document.getElementById("saveSettingsBtn");
  const status = document.getElementById("saveStatus");

  btn.disabled = true;
  btn.classList.remove("saved", "save-failed");
  status.textContent = "";
  status.classList.remove("error");

  try {
    const resp = await fetch(btn.dataset.url, {
      method: "POST",
      body: new FormData(form),
      headers: { Accept: "application/json" },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.error || resp.statusText);

    replayClass(btn, "saved");
    form.querySelectorAll(".card[data-saved]").forEach((card) => replayClass(card, "just-saved"));
    setTimeout(() => btn.classList.remove("saved"), 1500);
  } catch (err) {
    replayClass(btn, "save-failed");
    status.textContent = err.message;
    status.classList.add("error");
  } finally {
    btn.disabled = false;
  }
}

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
      input.value = next;
      input.dispatchEvent(new Event("change"));
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

  initRangeFills();
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOptimizer);
} else {
  initOptimizer();
}
