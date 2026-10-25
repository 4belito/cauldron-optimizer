// Game-styled help tooltips: any element with data-tip shows its text when
// hovered or focused. With data-tip-rows (JSON [[name, value], ...]) it shows
// a two-column table: names left, values right (below the data-tip text when
// it has both); a row with a third item true ([name, value, true]) is
// highlighted. One shared bubble, placed above the element (or below
// when there is no room), kept inside the screen.

function initTooltips() {
  const tip = document.createElement("div");
  tip.className = "game-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.appendChild(tip);
  let current = null;

  // Name / value pairs as a definition list (text only, never HTML)
  function rowsList(rows) {
    const dl = document.createElement("dl");
    dl.className = "game-tip-rows";
    rows.forEach(([name, value, current]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = name;
      dd.textContent = value;
      if (current) dt.className = dd.className = "is-current";
      dl.append(dt, dd);
    });
    return dl;
  }

  function show(el) {
    if (!el.dataset.tip && !el.dataset.tipRows) return hide();
    current = el;
    if (el.dataset.tipRows) {
      const rows = JSON.parse(el.dataset.tipRows);
      const parts = [rowsList(rows)];
      if (el.dataset.tip) {
        const text = document.createElement("p");
        text.className = "game-tip-text";
        // The text describes the highlighted row: same color, to link them
        if (rows.some((row) => row[2])) text.classList.add("is-current");
        text.textContent = el.dataset.tip;
        parts.unshift(text);
      }
      tip.replaceChildren(...parts);
    } else {
      tip.textContent = el.dataset.tip;
    }
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
    const el = e.target.closest("[data-tip], [data-tip-rows]");
    if (el && el !== current) show(el);
    else if (!el && current) hide();
  });
  // Keyboard focus only: a mouse click also focuses the button, and its text
  // may change on that click (e.g. Detener -> Continuar)
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest("[data-tip], [data-tip-rows]");
    if (el && e.target.matches(":focus-visible")) show(el);
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
