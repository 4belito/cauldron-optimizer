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
//   premium_ingr  ingredient indexes 0..11 (game order), at most 4
//   save           boolean; save settings after applying the values

// A content script may also select (or create) a world by name:
//   window.postMessage({ type: "cauldron:selectWorld",
//                        name: "EA-Balrogville-en3", create: true },
//                      window.location.origin)
//
// Failed results carry a stable `code` (besides the readable `errors`):
//   complement_mode  "Completar efectos" is on: nothing is changed
//   not_found        no world with that name (and create was not true)
//   too_many_worlds  the account already has the maximum number of worlds
//   invalid_name     empty or too long name
//   invalid_data     wrong fields (see errors)
//   network, db_error, save_failed

// "Completar efectos" mode shows a search's settings, locked: leave it alone
function complementActive() {
  return Boolean(window.cauldronComplement && window.cauldronComplement.active());
}

const COMPLEMENT_ERROR = "Complete effects mode is on: turn it off first";

const AUTOFILL_VERSION = 2;
const N_INGREDIENTS = 12;

function applyAutofill(data) {
  const { dom, effectNames } = window.OPTIMIZER_CONFIG;
  const result = { ok: true, applied: {}, errors: [] };
  if (!data || typeof data !== "object") {
    return { ok: false, code: "invalid_data", applied: {}, errors: ["data must be an object"] };
  }
  if (complementActive()) {
    return { ok: false, code: "complement_mode", applied: {}, errors: [COMPLEMENT_ERROR] };
  }

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
