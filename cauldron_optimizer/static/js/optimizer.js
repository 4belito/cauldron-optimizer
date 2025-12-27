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

// Store current weights globally to preserve them across rebuilds
let globalWeights = [];

function rebuildWeights() {
  const { defaultWeights, effectNames, dom } = window.OPTIMIZER_CONFIG;
  const n = Number(dom.nDiploma.value);
  dom.weightsContainer.innerHTML = "";
  if (n < 1 || n > effectNames.length) return;

  // Initialize globalWeights if empty, preserving any existing values
  if (globalWeights.length === 0) {
    globalWeights = [...defaultWeights];
  }

  // Zero out all weights higher than the number of diplomas
  for (let i = n; i < globalWeights.length; i++) {
    globalWeights[i] = 0;
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
    slider.addEventListener("input", () => {
      globalWeights[i] = Number(slider.value);
      updateHiddenWeights(globalWeights.slice(0, n));
    });

    dom.weightsContainer.appendChild(card);
  }

  initRangeFills(dom.weightsContainer);
  updateHiddenWeights(globalWeights.slice(0, n));
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
  
  // Rebuild weights when diploma count changes (no auto-submit)
  dom.nDiploma.addEventListener("change", rebuildWeights);
  
  initRangeFills();
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOptimizer);
} else {
  initOptimizer();
}
