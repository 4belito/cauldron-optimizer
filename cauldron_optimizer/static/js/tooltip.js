// Game-styled help tooltips: any element with data-tip shows its text when
// hovered or focused. One shared bubble, placed above the element (or below
// when there is no room), kept inside the screen.

function initTooltips() {
  const tip = document.createElement("div");
  tip.className = "game-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.appendChild(tip);
  let current = null;

  function show(el) {
    current = el;
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const margin = 8;
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - t.width - margin));
    let top = r.top - t.height - margin;
    const below = top < margin;
    if (below) top = r.bottom + margin;
    tip.classList.toggle("below", below);
    tip.style.left = `${left + window.scrollX}px`;
    tip.style.top = `${top + window.scrollY}px`;
  }

  function hide() {
    current = null;
    tip.hidden = true;
  }

  // Delegated, so it also works for elements added later. The text is read
  // on each show, so it follows changes (e.g. after renaming a world)
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el && el !== current) show(el);
    else if (!el && current) hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest("[data-tip]");
    if (el) show(el);
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide);
  window.addEventListener("scroll", hide, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTooltips);
} else {
  initTooltips();
}
