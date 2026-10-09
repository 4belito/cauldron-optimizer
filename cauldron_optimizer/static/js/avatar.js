// Avatar picker: choose the avatar of the selected server, or of a new server
// ("+ Add server" in the server menu). Changing the avatar is saved via fetch,
// so unsaved search settings on the page are kept. On the register page the
// choice only fills a form input (data-input), sent with the form.

function initAvatarPicker() {
  const modal = document.getElementById("avatarModal");
  const openBtn = document.getElementById("avatarBtn");
  if (!modal || !openBtn) return;
  // Top level of the page, so the overlay covers the navbar too
  document.body.appendChild(modal);

  const preview = document.getElementById("avatarPreview");
  const saveBtn = document.getElementById("avatarSave");
  const status = document.getElementById("avatarStatus");
  const serverLabel = document.getElementById("avatarServer");
  const serverSelect = document.getElementById("serverSelect");
  const usernameLabel = document.getElementById("avatarUsername");
  const usernameField = document.getElementById("username");
  const pickInput = modal.dataset.input && document.getElementById(modal.dataset.input);
  const options = [...modal.querySelectorAll(".avatar-option")];
  let selected = modal.dataset.current || null;
  // "change": avatar of the selected server; "add": avatar of a new server
  let mode = "change";

  function markSelected(name) {
    selected = name;
    options.forEach((opt) => {
      opt.setAttribute("aria-selected", String(opt.dataset.avatar === name));
    });
    const chosen = options.find((opt) => opt.dataset.avatar === name);
    if (chosen) preview.src = chosen.querySelector("img").src;
    saveBtn.disabled = !name || (mode === "change" && name === modal.dataset.current);
  }

  function open(newMode = "change") {
    mode = newMode;
    status.textContent = "";
    if (mode === "add") {
      markSelected(null);
      preview.src = modal.dataset.defaultUrl;
      serverLabel.textContent = modal.dataset.newServerLabel;
    } else {
      markSelected(modal.dataset.current || null);
      preview.src = openBtn.querySelector("img").src;
      serverLabel.textContent = modal.dataset.serverLabel;
    }
    // Register page: the name being typed
    if (usernameField) usernameLabel.textContent = usernameField.value.trim();
    modal.hidden = false;
    document.body.classList.add("avatar-open");
    const current = options.find((opt) => opt.dataset.avatar === selected) || options[0];
    current.scrollIntoView({ block: "center" });
    current.focus();
  }

  function close() {
    modal.hidden = true;
    document.body.classList.remove("avatar-open");
    openBtn.focus();
  }

  async function save() {
    if (!selected) return;
    if (mode === "change" && selected === modal.dataset.current) {
      close();
      return;
    }
    if (pickInput) {
      pickInput.value = selected;
      modal.dataset.current = selected;
      openBtn.querySelector("img").src = preview.src;
      openBtn.classList.remove("is-default");
      close();
      return;
    }
    saveBtn.disabled = true;
    status.textContent = "";
    const body = new FormData();
    body.append("avatar", selected);
    body.append("csrf_token", document.querySelector("input[name='csrf_token']").value);
    try {
      const url = mode === "add" ? modal.dataset.addUrl : modal.dataset.url;
      const resp = await fetch(url, {
        method: "POST",
        body,
        headers: { Accept: "application/json" },
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.error || resp.statusText);

      if (mode === "add") {
        // Load the new server (now selected) with its own settings
        window.location.assign(window.location.pathname);
        return;
      }
      // Show the new avatar everywhere on the page
      modal.dataset.current = selected;
      document
        .querySelectorAll(".server-avatar-img, .user-avatar")
        .forEach((img) => { img.src = data.url; });
      openBtn.classList.remove("is-default");
      close();
    } catch (err) {
      status.textContent = err.message;
      saveBtn.disabled = false;
    }
  }

  openBtn.addEventListener("click", () => open("change"));

  // Server menu: switch server, or "+ Add server" to pick the new one's avatar
  if (serverSelect) {
    serverSelect.addEventListener("change", () => {
      if (serverSelect.value === "add") {
        serverSelect.value = serverSelect.dataset.active;
        open("add");
      } else {
        serverSelect.form.submit();
      }
    });
  }
  saveBtn.addEventListener("click", save);
  modal.querySelectorAll("[data-avatar-cancel]").forEach((btn) => {
    btn.addEventListener("click", close);
  });
  // Click outside the window closes it
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  options.forEach((opt) => {
    opt.addEventListener("click", () => markSelected(opt.dataset.avatar));
    // Double click picks and saves at once
    opt.addEventListener("dblclick", () => {
      markSelected(opt.dataset.avatar);
      save();
    });
  });

  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter" && e.target.classList.contains("avatar-option")) {
      e.preventDefault();
      markSelected(e.target.dataset.avatar);
      save();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAvatarPicker);
} else {
  initAvatarPicker();
}
