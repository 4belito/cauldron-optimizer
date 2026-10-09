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
// Fields (both optional):
//   n_diploma     integer, 1..number of effects; rebuilds the effect sliders
//   premium_ingr  ingredient indexes 0..11 (game order), at most 4

const AUTOFILL_VERSION = 1;
const N_INGREDIENTS = 12;

function applyAutofill(data) {
  const { dom, effectNames } = window.OPTIMIZER_CONFIG;
  const result = { ok: true, applied: {}, errors: [] };
  if (!data || typeof data !== "object") {
    return { ok: false, applied: {}, errors: ["data must be an object"] };
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
  return result;
}

window.cauldronAutofill = applyAutofill;

// Messages from extension content scripts share this window, so only accept
// messages sent from this same window
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.type !== "cauldron:autofill") {
    return;
  }
  const result = applyAutofill(event.data);
  window.postMessage({ type: "cauldron:autofill:result", ...result }, window.location.origin);
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
