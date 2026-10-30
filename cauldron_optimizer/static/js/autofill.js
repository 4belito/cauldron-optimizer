// Autofill API for browser extensions (e.g. ElvenAssist): fills the number of
// diplomas and the premium ingredients to avoid.
//
// Two ways to call it, same data and same result:
//
// 1. From page scripts:
//      window.cauldronAutofill({ n_diploma: 7, premium_ingr: [0, 1, 10, 11] })
//
// 2. From an extension content script (which cannot see page functions),
//    with window.postMessage:
//      window.postMessage({ type: "cauldron:autofill", n_diploma: 7,
//                           premium_ingr: [0, 1, 10, 11] }, window.location.origin)
//    The page answers with { type: "cauldron:autofill:result", ok, applied,
//    errors }, and announces { type: "cauldron:ready", version } once loaded.
//
// Fields (all optional):
//   n_diploma     integer, 1..number of effects; rebuilds the effect sliders
//   premium_ingr  ingredient indexes 0..11 (game order), at most 4. When the
//                 world avoids fewer (its premium setting, 0..3) and more come,
//                 none are applied: the user picks which ones to avoid
//   selected_effects  effect indexes 0..n_diploma - 1 to check; the rest are
//                 unchecked and lose their weight (applied after n_diploma)
//   wonder_level  integer, 0..35: level of the Escuela de hechicería
//                 valoriana (0: not built); sets the Witch Point prices
//   wp_max        the world's Witch Points: the recipe may cost at most that
//                 (the limit) and the slider ends there. Integer >= 1, or
//                 null for not known: no limit (applied after wonder_level; at or above the
//                 dearest recipe it means no limit, so `applied` gets null)
//   goblets       integer, 1..5: goblets (brews) for "Todos en" / "All in"
//   all_in        boolean; the "Todos en" / "All in" switch: the best chance
//                 of getting all the wanted effects within the goblets (the
//                 weights become 0 or 1). Applied after selected_effects
//   at_least      integer, 0..5: at least this many of the wanted effects
//                 (0: all of them). At or above min(goblets, wanted
//                 effects) it means all, so `applied` gets 0. "mean" (or -1):
//                 the expected number of different wanted effects instead
//   save           boolean; save settings after applying the values

// A content script may also select (or create) a world by name:
//   window.postMessage({ type: "cauldron:selectWorld",
//                        name: "EA-Balrogville-en3", create: true },
//                      window.location.origin)
// With create and no world of that name, no world is made: the active one
// is used, renamed to that name only if the player never named it (no
// name, or "Mundo 1" / "World 1" as suggested; result: renamed). A name the
// player chose stays: the data fills that world as it is.
//
// Each panel of the page has an ElvenAssist switch (saved per world). With
// it off, that panel's fields are skipped: the result lists them in
// `blocked` (ok stays true). Panels: diplomas and effects (n_diploma,
// selected_effects, goblets, all_in, at_least), premium ingredients
// (premium_ingr), limits (wonder_level, wp_max).
//
// Failed results carry a stable `code` (besides the readable `errors`):
//   complement_mode  "Completar efectos" is on: nothing is changed
//   not_found        no world with that name (and create was not true)
//   invalid_name     empty or too long name
//   invalid_data     wrong fields (see errors)
//   network, db_error, save_failed

// "Completar efectos" mode shows a search's settings, locked: leave it alone
function complementActive() {
  return Boolean(window.cauldronComplement && window.cauldronComplement.active());
}

const COMPLEMENT_ERROR = "Complete effects mode is on: turn it off first";

const AUTOFILL_VERSION = 8;
const N_INGREDIENTS = 12;

// The panel each field fills: with its ElvenAssist switch off (optimizer.js,
// saved per world) the field is skipped and listed in `blocked`, not an error
const FIELD_PANELS = {
  n_diploma: "effects",
  selected_effects: "effects",
  goblets: "effects",
  all_in: "effects",
  at_least: "effects",
  premium_ingr: "premium",
  wonder_level: "limits",
  wp_max: "limits",
};

function applyAutofill(data) {
  const { dom, effectNames } = window.OPTIMIZER_CONFIG;
  const result = { ok: true, applied: {}, errors: [] };
  if (!data || typeof data !== "object") {
    return { ok: false, code: "invalid_data", applied: {}, errors: ["data must be an object"] };
  }
  if (complementActive()) {
    return { ok: false, code: "complement_mode", applied: {}, errors: [COMPLEMENT_ERROR] };
  }

  // Fields of panels the user closed to ElvenAssist are left out
  const ea = window.cauldronElvenAssist;
  result.blocked = [];
  data = { ...data };
  Object.entries(FIELD_PANELS).forEach(([field, panel]) => {
    if (data[field] !== undefined && ea && !ea.allows(panel)) {
      delete data[field];
      result.blocked.push(field);
    }
  });

  if (data.save !== undefined && typeof data.save !== "boolean") {
    result.errors.push("save must be a boolean");
  }

  if (data.n_diploma !== undefined) {
    const n = data.n_diploma;
    if (Number.isInteger(n) && n >= 1 && n <= effectNames.length) {
      dom.nDiploma.value = n;
      // As if the user changed the field: one slider per diploma
      rebuildWeights();
      result.applied.n_diploma = n;
    } else {
      result.errors.push(`n_diploma must be an integer from 1 to ${effectNames.length}`);
    }
  }

  if (data.premium_ingr !== undefined) {
    const valid = Array.isArray(data.premium_ingr)
      && data.premium_ingr.every((i) => Number.isInteger(i) && i >= 0 && i < N_INGREDIENTS);
    const unique = valid ? [...new Set(data.premium_ingr)] : [];
    if (!valid) {
      result.errors.push(`premium_ingr must be a list of integers from 0 to ${N_INGREDIENTS - 1}`);
    } else if (unique.length > MAX_PREMIUM_INGREDIENTS) {
      result.errors.push(`premium_ingr can have at most ${MAX_PREMIUM_INGREDIENTS} ingredients`);
    } else if (unique.length > nPremium()) {
      result.errors.push(
        `premium_ingr has ${unique.length} ingredients but this world avoids ${nPremium()}: not applied`
      );
    } else {
      document
        .querySelectorAll("input[name='premium_ingredients[]']")
        .forEach((cb) => {
          cb.checked = unique.includes(Number(cb.value));
        });
      updatePremiumLocks();
      result.applied.premium_ingr = unique;
    }
  }

  if (data.selected_effects !== undefined) {
    const n = Number(dom.nDiploma.value);
    const v = data.selected_effects;
    const valid = Array.isArray(v) && v.every((i) => Number.isInteger(i) && i >= 0 && i < n);
    if (!valid) {
      result.errors.push(`selected_effects must be a list of integers from 0 to ${n - 1}`);
    } else {
      const unique = [...new Set(v)].sort((a, b) => a - b);
      window.cauldronForm.setSelectedEffects(unique);
      result.applied.selected_effects = unique;
    }
  }

  const wp = window.cauldronWitchPoints;
  if (data.wonder_level !== undefined) {
    const n = data.wonder_level;
    if (!wp) {
      result.errors.push("wonder_level is not available");
    } else if (Number.isInteger(n) && n >= 0 && n <= wp.maxLevel) {
      wp.setLevel(n);
      result.applied.wonder_level = n;
    } else {
      result.errors.push(`wonder_level must be an integer from 0 to ${wp.maxLevel}`);
    }
  }

  if (data.wp_max !== undefined) {
    const v = data.wp_max;
    if (!wp) {
      result.errors.push("wp_max is not available");
    } else if (v === null || (Number.isInteger(v) && v >= 1)) {
      // The world's Witch Points: the limit and the slider's end
      result.applied.wp_max = wp.setOwned(v);
    } else {
      result.errors.push("wp_max must be a positive integer or null");
    }
  }

  const all = window.cauldronAllEffects;
  if (data.goblets !== undefined) {
    const n = data.goblets;
    if (!all) {
      result.errors.push("goblets is not available");
    } else if (Number.isInteger(n) && n >= 1 && n <= all.maxRounds) {
      all.setRounds(n);
      result.applied.goblets = n;
    } else {
      result.errors.push(`goblets must be an integer from 1 to ${all.maxRounds}`);
    }
  }

  if (data.all_in !== undefined) {
    if (!all) {
      result.errors.push("all_in is not available");
    } else if (typeof data.all_in === "boolean") {
      all.setOn(data.all_in);
      result.applied.all_in = data.all_in;
    } else {
      result.errors.push("all_in must be a boolean");
    }
  }

  if (data.at_least !== undefined) {
    const k = data.at_least === "mean" ? -1 : data.at_least;
    if (!all) {
      result.errors.push("at_least is not available");
    } else if (Number.isInteger(k) && k >= -1 && k <= all.maxRounds) {
      const kept = all.setMinEffects(k);
      result.applied.at_least = kept === -1 ? "mean" : kept;
    } else {
      result.errors.push(`at_least must be "mean" or an integer from 0 to ${all.maxRounds}`);
    }
  }

  result.ok = result.errors.length === 0;
  if (!result.ok) result.code = "invalid_data";
  // Changed values: the restore button can undo them (until saved)
  if (Object.keys(result.applied).length) setUnsaved(true);
  return result;
}

async function applyAndMaybeSave(data) {
  const result = applyAutofill(data);
  if (!result.ok || data.save !== true) return result;

  if (typeof window.cauldronSaveSettings !== "function") {
    result.ok = false;
    result.code = "save_failed";
    result.errors.push("save is not available");
    return result;
  }

  const saveResult = await window.cauldronSaveSettings();
  if (!saveResult.ok) {
    result.ok = false;
    result.code = "save_failed";
    result.errors.push(saveResult.error || "settings could not be saved");
    return result;
  }

  result.saved = true;
  return result;
}

// Calls without save remain synchronous for backwards compatibility.
window.cauldronAutofill = (data) => (
  data && data.save === true ? applyAndMaybeSave(data) : applyAutofill(data)
);

function trustedMessage(event) {
  return event.source === window
    && event.origin === window.location.origin
    && event.data
    && typeof event.data === "object";
}

function selectWorldError(code, message) {
  return {
    ok: false,
    code,
    created: false,
    reloading: false,
    errors: [message],
  };
}

async function selectWorld(data) {
  if (typeof data.name !== "string" || !data.name.trim()) {
    return selectWorldError("invalid_name", "name must be a non-empty string");
  }
  if (data.create !== undefined && typeof data.create !== "boolean") {
    return selectWorldError("invalid_data", "create must be a boolean");
  }
  // Switching reloads the page: not while the mode shows a search (a running
  // search would also stop the reload with a "leave page?" dialog)
  if (complementActive()) return selectWorldError("complement_mode", COMPLEMENT_ERROR);

  const url = window.CAULDRON_INTEGRATION?.selectWorldUrl;
  if (!url) return selectWorldError("invalid_data", "world selection is not available");

  const body = new FormData();
  body.append("name", data.name);
  body.append("create", data.create === true ? "1" : "0");
  const csrf = document.querySelector("input[name='csrf_token']");
  if (csrf) body.append("csrf_token", csrf.value);

  try {
    const response = await fetch(url, {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      return selectWorldError(payload.code || "network", payload.error || response.statusText);
    }

    return {
      ok: true,
      created: Boolean(payload.created),
      renamed: Boolean(payload.renamed),
      reloading: Boolean(payload.changed),
      errors: [],
      world: payload.world,
    };
  } catch (err) {
    return selectWorldError("network", err instanceof Error ? err.message : String(err));
  }
}

// Messages from extension content scripts share this window, so only accept
// messages sent from this same window and origin.
window.addEventListener("message", async (event) => {
  if (!trustedMessage(event)) return;

  if (event.data.type === "cauldron:autofill") {
    const result = await applyAndMaybeSave(event.data);
    window.postMessage(
      { type: "cauldron:autofill:result", ...result },
      window.location.origin
    );
    return;
  }

  if (event.data.type === "cauldron:selectWorld") {
    const result = await selectWorld(event.data);
    window.postMessage(
      { type: "cauldron:selectWorld:result", ...result },
      window.location.origin
    );
    if (result.reloading) {
      setTimeout(() => window.location.reload(), 100);
    }
  }
});

// Announced after optimizer.js has built the form (its DOMContentLoaded
// handler was registered first, so it runs first)
function announceReady() {
  window.postMessage(
    { type: "cauldron:ready", version: AUTOFILL_VERSION },
    window.location.origin
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", announceReady);
} else {
  announceReady();
}
