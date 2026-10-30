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

  // Named for screen readers only: the card shows the name on hover
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("aria-label", labelText);
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
// Slots beyond the player's diplomas are hidden; the rows of 10 only grow
// when the diplomas pass a multiple of 10
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
        // Name on hover, as in the ingredients grid
        slot.dataset.tip = window.OPTIMIZER_CONFIG.effectNames[checked[k]] ?? "";
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

// The game has 4 premium ingredients a week; the world avoids 0 to 4 of
// them (its n_premium setting, saved). Once that many are chosen the rest
// lock, and "Buscar receta" waits until they are
const MAX_PREMIUM_INGREDIENTS = 4;

function nPremium() {
  const el = document.getElementById("nPremium");
  const n = el ? parseInt(el.value, 10) : NaN;
  return Number.isInteger(n) ? Math.min(MAX_PREMIUM_INGREDIENTS, Math.max(0, n)) : MAX_PREMIUM_INGREDIENTS;
}

// Set how many to avoid; chosen ones beyond the new number are let go
// (the last chosen first)
function setNPremium(n) {
  const el = document.getElementById("nPremium");
  if (!el) return;
  el.value = Math.min(MAX_PREMIUM_INGREDIENTS, Math.max(0, n));
  const chosen = [...document.querySelectorAll("input[name='premium_ingredients[]']")]
    .filter((cb) => cb.checked);
  chosen.slice(nPremium()).forEach((cb) => {
    cb.checked = false;
  });
  updatePremiumLocks();
}

function initPremiumSelect() {
  const select = document.getElementById("premiumSelect");
  if (!select) return;
  select.addEventListener("change", (e) => {
    e.stopPropagation(); // the hidden field below is the setting
    setNPremium(Number(select.value));
    document.getElementById("nPremium").dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function updatePremiumLocks() {
  const inputs = [...document.querySelectorAll("input[name='premium_ingredients[]']")];
  const chosen = inputs.filter((el) => el.checked);
  const full = chosen.length >= nPremium();
  inputs.forEach((el) => {
    // "Completar efectos" keeps them all off (complement.js)
    const isLocked = complementMode || (full && !el.checked);
    el.disabled = isLocked;
    el.closest(".ingredient-check").classList.toggle("locked", isLocked);
  });
  updatePremiumCounter(chosen);
}

// One slot per ingredient to avoid, filled with the chosen ones, and the
// search button enabled only with exactly that many
function updatePremiumCounter(chosen) {
  const counter = document.getElementById("premiumCounter");
  if (!counter) return;
  const n = nPremium();
  const slots = counter.querySelectorAll(".premium-slot");
  slots.forEach((slot, k) => {
    // Beyond the number to avoid: faded, not removed (the panel keeps its size)
    slot.classList.toggle("unused", k >= n);
    const el = chosen[k];
    const icon = el && el.closest(".ingredient-check").querySelector(".ingredient-check-icon");
    slot.style.backgroundImage = icon ? `url("${icon.src}")` : "";
    slot.classList.toggle("filled", !!el);
    if (el) slot.dataset.tip = el.closest(".ingredient-check").dataset.tip;
    else delete slot.dataset.tip;
  });
  const select = document.getElementById("premiumSelect");
  if (select) select.value = String(n);
  document.getElementById("premiumValue").textContent = n;
  const d = counter.dataset;
  // The sentence around the number: "Evitar {n} ingredientes premium"
  const [before, after = ""] = (n === 1 ? d.textOne : d.textMany).split("{n}");
  document.getElementById("premiumTextBefore").textContent = before.trim();
  document.getElementById("premiumTextAfter").textContent = after.trim();
  const missing = n - chosen.length;
  // In "Completar efectos" no ingredient is chosen (every combination is
  // tried): the bar only says how many, so it reads as done
  counter.classList.toggle("is-complete", missing <= 0 || complementMode);
  premiumProblem = missing !== 0 ? d.textButton.replace("{n}", n) : null;
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

// Each card folds and unfolds by its title (a chevron in its corner), so the
// panels already set can be put away and not changed by accident while
// scrolling. Remembered per card in the browser
function initCardFolds() {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const label = window.OPTIMIZER_CONFIG.foldLabel;

  document.querySelectorAll(".optimizer fieldset.card").forEach((card) => {
    const legend = card.querySelector(":scope > legend");
    const body = card.querySelector(":scope > .card-body");
    if (!legend || !body) return;
    const name = [...card.classList].find((c) => c.endsWith("-card") && c !== "card");
    const key = `cardFolded:${name}`;
    body.id ||= `${name}-body`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-fold";
    btn.setAttribute("aria-controls", body.id);
    btn.setAttribute("aria-label", label);
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    legend.append(btn);

    let folded = false;
    try {
      folded = localStorage.getItem(key) === "1";
    } catch (e) {}

    function apply() {
      card.classList.toggle("is-folded", folded);
      btn.setAttribute("aria-expanded", String(!folded));
    }

    // The body's height slides between 0 and its own
    function slide(from, to, done) {
      if (still.matches || !body.animate) return done();
      body.style.overflow = "hidden";
      const anim = body.animate([{ height: `${from}px` }, { height: `${to}px` }], {
        duration: 220,
        easing: "ease-in-out",
      });
      anim.onfinish = anim.oncancel = () => {
        body.style.overflow = "";
        done();
      };
    }

    legend.addEventListener("click", () => {
      folded = !folded;
      try {
        localStorage.setItem(key, folded ? "1" : "");
      } catch (e) {}
      if (folded) {
        slide(body.offsetHeight, 0, apply);
      } else {
        apply();
        slide(0, body.offsetHeight, () => {});
      }
    });
    apply();
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

// "Todos": the recipe with the best chance of getting the wanted effects
// within the goblets (brews). A switch left of the diplomas: while on,
// the weights are 0 or 1 (a weight only says the effect is wanted) and the
// probability cap does not apply (its slider moves to 100, dimmed, as the
// depth with "Óptima"; moving it turns "Todos" off). The goblet beside it
// opens the list of goblets, as the school its levels; picking some turns
// "Todos" on. Not with "Completar efectos" (setComplementMode)
function allEffectsOn() {
  const toggle = document.getElementById("allEffects");
  return !!(toggle && toggle.checked);
}

function initAllEffects() {
  const toggle = document.getElementById("allEffects");
  const check = document.getElementById("allEffectsCheck");
  const pick = document.getElementById("roundsPick");
  const cap = document.querySelector("input[name='prob_UB']");
  const rounds = document.getElementById("nRounds");
  const select = document.getElementById("roundsSelect");
  if (!toggle || !check || !pick || !cap || !rounds || !select) return;
  const card = cap.closest(".weight-card");
  const row = document.getElementById("allEffectsRow");
  card.classList.add("cap-card");

  const update = () => {
    card.classList.toggle("is-all", toggle.checked);
    row.classList.toggle("is-all", toggle.checked);
    select.value = rounds.value;
    document.getElementById("roundsValue").textContent = rounds.value;
  };
  // While on, the slider sits at 100 (no cap); turning it off puts back the
  // cap it had. Set by code: does not count as the user moving it
  let savedCap = cap.value;
  const setCap = (v) => {
    cap.value = v;
    cap.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const moveCap = () => {
    if (toggle.checked) {
      savedCap = cap.value;
      setCap(cap.max);
    } else {
      setCap(savedCap);
    }
  };
  // The weights before turning it on come back when it goes off, except
  // those the user changed meanwhile (they keep their new 0 or 1)
  let weightsBefore = null; // as they were
  let weightsOn = null; // as they became (0 or 1)
  const keepWeights = () => {
    weightsBefore = [...globalWeights];
    weightsOn = globalWeights.map((w) => (w > 0 ? 1 : 0));
  };
  const restoreWeights = () => {
    if (!weightsBefore) return;
    globalWeights = globalWeights.map((w, i) =>
      i < weightsOn.length && w === weightsOn[i] ? weightsBefore[i] : w
    );
    weightsBefore = weightsOn = null;
  };
  toggle.addEventListener("change", () => {
    if (toggle.checked) keepWeights();
    else restoreWeights();
    moveCap();
    update();
    rebuildWeights(); // 0 or 1 while on
  });
  select.addEventListener("change", () => {
    rounds.value = select.value;
    if (!toggle.checked) {
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    }
    update();
    showAtLeast(); // fewer goblets: a lower maximum
  });
  cap.addEventListener("input", (e) => {
    // Only the user moving it (as with "Óptima")
    if (e.isTrusted && toggle.checked) {
      toggle.checked = false;
      restoreWeights();
      rebuildWeights();
    }
    update();
  });
  // "Todos", or at least k of the wanted effects, picked on the word: k up
  // to the most that can come out, min(goblets, wanted effects); that one is
  // "Todos". Read from the form's fields, so it also works before the
  // sliders are built
  const { form, weightsHidden, excludedHidden } = window.OPTIMIZER_CONFIG.dom;
  const minInput = document.getElementById("minEffects");
  const kPick = document.getElementById("atLeastPick");
  const kSelect = document.getElementById("atLeastSelect");
  const kValue = document.getElementById("atLeastValue");
  const wantedCount = () => {
    try {
      const excluded = new Set(JSON.parse(excludedHidden.value || "[]"));
      return JSON.parse(weightsHidden.value || "[]").filter((w, i) => w > 0 && !excluded.has(i))
        .length;
    } catch (e) {
      return 0;
    }
  };
  // ...and first, above a line, "Máximo" (-1, the default): the expected
  // number of different wanted effects, whatever the maximum
  const MEAN = -1;
  const showAtLeast = () => {
    const most = Math.min(Number(rounds.value), wantedCount());
    let k = Number(minInput.value) || 0;
    if (k !== MEAN && k >= most) k = 0; // as many as can be: "Todos"
    minInput.value = String(k);
    const line = new Option("──────", "");
    line.disabled = true;
    const options = [new Option(kPick.dataset.mean, String(MEAN)), line];
    options.push(new Option(kPick.dataset.all, "0"));
    // "≥ 3": at least 3 of the wanted effects
    for (let i = 1; i < most; i++) options.push(new Option(`≥ ${i}`, String(i)));
    kSelect.replaceChildren(...options);
    kSelect.value = String(k);
    kValue.textContent = k === MEAN ? kPick.dataset.mean : k ? `≥ ${k}` : kPick.dataset.all;
  };
  kSelect.addEventListener("change", () => {
    minInput.value = kSelect.value;
    if (!toggle.checked) {
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    }
    showAtLeast();
  });
  // Goblets, weights, checked effects or diplomas changed: new maximum. Not
  // the picker's own events: its "input" comes before its "change" and would
  // put the old value back before the change reads the new one
  const refreshAtLeast = (e) => {
    if (e.target !== kSelect) showAtLeast();
  };
  form.addEventListener("input", refreshAtLeast);
  form.addEventListener("change", refreshAtLeast);

  if (toggle.checked) moveCap();
  update();
  showAtLeast();

  // Public hooks used by autofill.js: as if the player chose them here
  window.cauldronAllEffects = {
    maxRounds: select.options.length,
    setOn(on) {
      if (toggle.checked === on) return;
      toggle.checked = on;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    },
    // Only the number: "Todos en" stays as it is
    setRounds(n) {
      rounds.value = String(n);
      update();
      showAtLeast();
    },
    // At least k of the wanted effects (0: "Todos", -1: "Media"); above the
    // most that can come out it is "Todos" too. Returns the k kept
    setMinEffects(k) {
      minInput.value = String(k);
      showAtLeast();
      return Number(minInput.value);
    },
    // New weights from outside (a saved search): nothing to bring back
    forgetWeights() {
      weightsBefore = weightsOn = null;
    },
  };
}

// Witch Point limit (first row of "Limitar Búsqueda"): a log-scale slider
// from the price of one ingredient to that of 25 units of one ingredient (the
// most any recipe costs: there it means no limit), or an exact number typed
// in the box (12000, 12K, 1.2M). The hidden wp_max field gets the limit
// (empty: none), and wonder_level the level of the Escuela de hechicería
// valoriana, shared with "Receta manual" (its discount changes every price)
const WONDER_LEVEL_KEY = "formula.wonderLevel";
const WONDER_DISCOUNT_KEY = "formula.wonderDiscount";
const WP_STEPS = 1000; // slider positions

function initWitchPointLimit() {
  const text = document.getElementById("wpMaxText");
  const range = document.getElementById("wpMaxRange");
  const hidden = document.getElementById("wpMax");
  const levelInput = document.getElementById("wonderLevel");
  const select = document.getElementById("wpWonder");
  if (!text || !range || !hidden || !levelInput || !select) return;

  // The world's saved level (empty: never saved, so not built); "Receta
  // manual" then shows the same
  const saveLevel = () => {
    try {
      localStorage.setItem(WONDER_LEVEL_KEY, String(level));
      localStorage.setItem(WONDER_DISCOUNT_KEY, String(WONDER_REDUCTION[level]));
    } catch (e) {}
  };
  let level = Number(levelInput.value);
  level = Math.min(Math.max(Math.trunc(level) || 0, 0), WONDER_REDUCTION.length - 1);
  saveLevel();

  // The world's Witch Points as ElvenAssist sent them, while its switch on
  // this panel is on; null: not known (or not used)
  const ownedInput = document.getElementById("wpOwned");
  const owned = () => {
    const v = Number(ownedInput && ownedInput.value);
    return v > 0 && elvenAssistAllows("limits") ? v : null;
  };
  // Cheapest single ingredient and dearest recipe at the current level. With
  // fewer Witch Points than the dearest recipe, the slider ends at them: its
  // end is then that limit (capped), not "no limit"
  const bounds = () => {
    const reduction = WONDER_REDUCTION[level];
    const min = cauldronPrice(1, 1, { reduction });
    const dearest = cauldronBuyOrder({ one: 25 }, { reduction }).witchPoints;
    const cap = owned();
    return cap && cap < dearest
      ? { min, max: Math.max(min, cap), capped: true }
      : { min, max: dearest, capped: false };
  };
  const limit = () => Number(hidden.value) || Infinity;
  const toPos = (v, { min, max }) =>
    Math.round((WP_STEPS * Math.log(Math.max(v, min) / min)) / Math.log(max / min));
  // Slider values: 2 significant digits (3400, not 3437); the ends exact
  const fromPos = (pos, { min, max }) => {
    if (pos <= 0) return min;
    if (pos >= WP_STEPS) return max;
    const v = min * (max / min) ** (pos / WP_STEPS);
    const unit = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 1);
    return Math.round(v / unit) * unit;
  };

  // The box shows the short form (12K) except while it is being typed in
  function render() {
    const b = bounds();
    const v = Math.min(limit(), b.max);
    range.value = String(toPos(v, b));
    setRangeFill(range);
    if (document.activeElement !== text) text.value = formatWitchPoints(v);
  }
  // From the price of one ingredient up; the maximum or more: no limit (or,
  // capped by the world's Witch Points, those)
  function setLimit(v) {
    const b = bounds();
    hidden.value = v >= b.max
      ? b.capped ? String(b.max) : ""
      : String(Math.max(b.min, Math.round(v)));
    render();
  }

  range.addEventListener("input", () => setLimit(fromPos(Number(range.value), bounds())));
  text.addEventListener("input", () => {
    const n = parseWitchPoints(text.value);
    if (n > 0) setLimit(n);
  });
  text.addEventListener("focus", () => {
    text.value = String(Math.min(limit(), bounds().max));
    text.select();
  });
  text.addEventListener("blur", render);
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // not a search
      text.blur();
    }
  });
  hidden.addEventListener("change", render); // set by code (applyComplementParams)

  // The school, as in "Receta manual": the picture opens the level list
  select.replaceChildren(
    ...WONDER_REDUCTION.map((r, n) => new Option(
      n ? `${select.dataset.level.replace("{n}", n)} · −${+(r * 100).toFixed(1)}%` : select.dataset.none,
      n
    ))
  );
  function showLevel() {
    const reduction = WONDER_REDUCTION[level];
    select.value = String(level);
    levelInput.value = String(level);
    select.closest(".fx-wonder").classList.toggle("unbuilt", !level);
    document.getElementById("wpWonderLevel").textContent = level;
    document.getElementById("wpWonderDiscount").textContent =
      reduction ? `−${+(reduction * 100).toFixed(1)}%` : "—";
  }
  select.addEventListener("change", () => {
    level = Number(select.value) || 0;
    saveLevel();
    showLevel();
    setLimit(limit()); // above the new maximum: no limit
  });

  showLevel();
  setLimit(limit());

  // Public hooks used by autofill.js: as if the player chose them here
  window.cauldronWitchPoints = {
    maxLevel: WONDER_REDUCTION.length - 1,
    setLevel(n) {
      level = n;
      saveLevel();
      showLevel();
      setLimit(limit());
    },
    // null: no limit; returns the limit kept (null: none)
    setLimit(v) {
      setLimit(v == null ? Infinity : v);
      return hidden.value === "" ? null : Number(hidden.value);
    },
    // The world's Witch Points (ElvenAssist): the slider ends there and the
    // limit is set to them (null: not known, the slider back to no limit).
    // Returns the limit kept (null: none)
    setOwned(v) {
      ownedInput.value = v == null ? "" : String(v);
      setLimit(v == null ? Infinity : v);
      return hidden.value === "" ? null : Number(hidden.value);
    },
    // After ElvenAssist is switched on or off on this panel
    refresh() {
      setLimit(limit());
    },
  };
}

// ElvenAssist on each panel: a switch in its title (the extension's icon).
// Off: autofill.js leaves that panel as it is. One more on the world bar:
// off, ElvenAssist neither picks nor renames the world. Saved per world
// (eaOff, the ones off) as soon as one is clicked: the extension reloads
// the page when it changes the world, which must not undo them
const ELVENASSIST_CARDS = {
  world: ".server-select-form",
  effects: "fieldset.effects-card > legend",
  premium: "fieldset.premium-card > legend",
  limits: "fieldset.bounds-card > legend",
};

function elvenAssistOff() {
  try {
    const v = JSON.parse(document.getElementById("eaOff")?.value || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function elvenAssistAllows(panel) {
  return !elvenAssistOff().includes(panel);
}
window.cauldronElvenAssist = { allows: elvenAssistAllows };

function initElvenAssistSwitches() {
  const cfg = window.OPTIMIZER_CONFIG.elvenAssist;
  const hidden = document.getElementById("eaOff");
  if (!cfg || !hidden) return;
  const buttons = [];
  const showAll = () => buttons.forEach((show) => show());
  const store = async (value) => {
    const body = new FormData();
    body.append("elvenassist_off_json", value);
    body.append("csrf_token", document.querySelector("input[name='csrf_token']").value);
    const resp = await fetch(cfg.saveUrl, { method: "POST", body, headers: { Accept: "application/json" } });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.error || resp.statusText);
  };
  Object.entries(ELVENASSIST_CARDS).forEach(([panel, selector]) => {
    const host = document.querySelector(`.optimizer-page ${selector}`);
    if (!host) return;
    const isWorld = panel === "world";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ea-switch" + (isWorld ? " ea-switch-world" : "");
    btn.innerHTML = `<img src="${cfg.icon}" alt="">`;
    const show = () => {
      const on = elvenAssistAllows(panel);
      const tip = isWorld ? (on ? cfg.worldOn : cfg.worldOff) : on ? cfg.on : cfg.off;
      btn.classList.toggle("is-off", !on);
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", tip);
      btn.dataset.tip = tip;
    };
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const before = hidden.value;
      const off = new Set(elvenAssistOff());
      if (off.has(panel)) off.delete(panel);
      else off.add(panel);
      hidden.value = JSON.stringify(Object.keys(ELVENASSIST_CARDS).filter((p) => off.has(p)));
      show();
      // The Witch Point slider ends at the world's Witch Points only with it on
      if (panel === "limits" && window.cauldronWitchPoints) window.cauldronWitchPoints.refresh();
      try {
        await store(hidden.value);
      } catch (err) {
        // Not saved: back as it was
        hidden.value = before;
        showAll();
        if (panel === "limits" && window.cauldronWitchPoints) window.cauldronWitchPoints.refresh();
      }
    });
    host.append(btn);
    buttons.push(show);
    show();
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
  // An unchecked effect is left out of the search: no weight either (also
  // fixes settings saved before unchecking reset the weight)
  for (let i = 0; i < n; i++) {
    if (globalChecked[i] === false) globalWeights[i] = 0;
  }

  // Ensure globalWeights array is large enough
  while (globalWeights.length < n) {
    globalWeights.push(0);
  }
  // "Todos": a weight only says the effect is wanted, 0 or 1
  const binary = allEffectsOn();
  if (binary) {
    for (let i = 0; i < n; i++) if (globalWeights[i] > 0) globalWeights[i] = 1;
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
      step: binary ? 1 : 0.01,
      value: currentW,
      format: (x) => Number(x).toFixed(2),
    });

    // No name text: it shows on hover, as in the ingredients grid
    card.querySelector(".weight-label").remove();
    card.dataset.tip = effectNames[i] ?? "";

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
    // A click anywhere on the box: weight 1 goes to 0, any other to 1 (the
    // checkbox and the slider keep their own clicks). "Todos" also dresses
    // the slider as a toggle (flip-weight)
    card.classList.add("click-weight");
    card.classList.toggle("flip-weight", binary);
    card.addEventListener("click", (e) => {
      if (e.target.closest("input, .effect-check")) return;
      slider.value = Number(slider.value) === 1 ? 0 : 1;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      setRangeFill(slider);
    });

    dom.weightsContainer.appendChild(card);
  }

  updateEffectLocks(dom.weightsContainer);
  initRangeFills(dom.weightsContainer);
  updateHiddenWeights(globalWeights.slice(0, n));
  updateHiddenExcluded(n);
}

// Hooks for complement.js
window.cauldronForm = {
  // Used by autofill.js: check exactly these effects (indexes below the
  // diplomas), as if the player clicked the boxes; the unchecked ones lose
  // their weight
  setSelectedEffects(indexes) {
    const n = Number(window.OPTIMIZER_CONFIG.dom.nDiploma.value);
    const selected = new Set(indexes);
    for (let i = 0; i < n; i++) globalChecked[i] = selected.has(i);
    rebuildWeights();
  },
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
    // "Todos en" first: switching it moves the cap, set right after (searches
    // saved before it have none: off). The search's weights replace the
    // form's, so it brings none back
    const all = window.cauldronAllEffects;
    if (all) {
      all.forgetWeights();
      if (p.n_rounds) all.setRounds(p.n_rounds);
      all.setOn(Boolean(p.n_rounds));
    }
    [["alpha_UB", p.alpha_ub], ["prob_UB", p.prob_ub], ["n_starts", p.depth]].forEach(
      ([name, value]) => {
        const el = document.querySelector(`input[name='${name}']`);
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    );
    // "Óptima" as the search had it (searches saved before it: off). After
    // the depth, whose code-set value leaves it as it is
    const exact = document.getElementById("exactSearch");
    if (exact) {
      exact.checked = Boolean(p.exact);
      exact.dispatchEvent(new Event("change"));
    }
    // The school's level first: the limit is priced with it (searches saved
    // before it have none: not built)
    const wpLimit = window.cauldronWitchPoints;
    if (wpLimit) wpLimit.setLevel(p.wonder_level ?? 0);
    // Searches saved before the Witch Point limit have none
    const wp = document.getElementById("wpMax");
    wp.value = p.wp_max ? String(p.wp_max) : "";
    wp.dispatchEvent(new Event("change", { bubbles: true }));
    rebuildWeights();
    // Keeps the -/+ buttons in step with the new count
    dom.nDiploma.dispatchEvent(new Event("input"));
    // At least k: after the weights, which set its maximum
    if (all) all.setMinEffects(p.n_rounds ? p.min_effects || 0 : 0);
    // Avoided ingredients per run (searches saved before it: 4)
    setNPremium(p.n_avoid ?? MAX_PREMIUM_INGREDIENTS);
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
  const buttons = document.querySelectorAll(".diploma-input .step-btn");
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
  initAllEffects();
  initWitchPointLimit();
  initEffectsAll();
  initCardFolds();
  initElvenAssistSwitches();

  rebuildWeights();

  // Premium ingredients: lock unchecked ones once the maximum is reached
  initPremiumSelect();
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
