// Server profile window: name and avatar of the selected server, or of a new
// server ("+ Add server" in the server menu). Changes are saved via fetch, so
// unsaved search settings on the page are kept. On the register page the
// choice only fills form inputs (data-input, data-name-input), sent with the
// form. Also the confirmation window for deleting the selected server.

function postForm(url, fields) {
  const body = new FormData();
  Object.entries(fields).forEach(([key, value]) => body.append(key, value));
  body.append("csrf_token", document.querySelector("input[name='csrf_token']").value);
  return fetch(url, { method: "POST", body, headers: { Accept: "application/json" } })
    .then(async (resp) => {
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.error || resp.statusText);
      return data;
    });
}

// After a rename: the new name in the menu, delete window and button labels
function showServerName(name) {
  const select = document.getElementById("serverSelect");
  if (select) select.selectedOptions[0].textContent = name;
  const deleteName = document.getElementById("deleteName");
  if (deleteName) deleteName.textContent = name;
  document.querySelectorAll("[data-label-template]").forEach((el) => {
    const label = el.dataset.labelTemplate.replace("{name}", name);
    el.title = label;
    el.setAttribute("aria-label", label);
  });
  document.querySelectorAll("[data-aria-template]").forEach((el) => {
    el.setAttribute("aria-label", el.dataset.ariaTemplate.replace("{name}", name));
  });
}

// Shared open/close behaviour of the game-styled windows
function makeWindow(overlay, returnFocus) {
  return {
    open(focusEl) {
      overlay.hidden = false;
      document.body.classList.add("avatar-open");
      if (focusEl) focusEl.focus();
    },
    close() {
      overlay.hidden = true;
      document.body.classList.remove("avatar-open");
      returnFocus.focus();
    },
  };
}

function initAvatarPicker() {
  const modal = document.getElementById("avatarModal");
  const openBtn = document.getElementById("avatarBtn");
  if (!modal || !openBtn) return;
  // Top level of the page, so the overlay covers the navbar too
  document.body.appendChild(modal);
  const win = makeWindow(modal, openBtn);

  const preview = document.getElementById("avatarPreview");
  const saveBtn = document.getElementById("avatarSave");
  const status = document.getElementById("avatarStatus");
  const nameInput = document.getElementById("avatarName");
  const serverLabel = document.getElementById("avatarServer");
  const serverSelect = document.getElementById("serverSelect");
  const usernameLabel = document.getElementById("avatarUsername");
  const usernameField = document.getElementById("username");
  const pickInput = modal.dataset.input && document.getElementById(modal.dataset.input);
  const pickNameInput =
    modal.dataset.nameInput && document.getElementById(modal.dataset.nameInput);
  const options = [...modal.querySelectorAll(".avatar-option")];
  let selected = modal.dataset.current || null;
  // "change": the selected server; "add": a new server
  let mode = "change";

  const cleanName = () => nameInput.value.trim().replace(/\s+/g, " ");

  function updateSaveState() {
    const name = cleanName();
    serverLabel.textContent = name || " ";
    const changed =
      mode !== "change" ||
      (selected || "") !== modal.dataset.current ||
      name !== modal.dataset.serverName;
    // A new server needs an avatar; any server needs a name
    saveBtn.disabled = !name || (mode === "add" && !selected) || !changed;
  }

  function markSelected(name) {
    selected = name;
    options.forEach((opt) => {
      opt.setAttribute("aria-selected", String(opt.dataset.avatar === name));
    });
    const chosen = options.find((opt) => opt.dataset.avatar === name);
    if (chosen) preview.src = chosen.querySelector("img").src;
    updateSaveState();
  }

  function open(newMode = "change") {
    mode = newMode;
    status.textContent = "";
    if (mode === "add") {
      nameInput.value = modal.dataset.newServerName;
      markSelected(null);
      preview.src = modal.dataset.defaultUrl;
    } else {
      nameInput.value = modal.dataset.serverName;
      markSelected(modal.dataset.current || null);
      preview.src = openBtn.querySelector("img").src;
    }
    // Register page: the name being typed
    if (usernameField) usernameLabel.textContent = usernameField.value.trim();
    const current = options.find((opt) => opt.dataset.avatar === selected) || options[0];
    win.open();
    current.scrollIntoView({ block: "center" });
    // A new server starts by naming it
    (mode === "add" ? nameInput : current).focus();
    if (mode === "add") nameInput.select();
  }

  async function save() {
    if (saveBtn.disabled) return;
    const name = cleanName();
    if (pickInput) {
      pickInput.value = selected || "";
      if (pickNameInput) pickNameInput.value = name;
      modal.dataset.current = selected || "";
      modal.dataset.serverName = name;
      openBtn.querySelector("img").src = preview.src;
      if (selected) openBtn.classList.remove("is-default");
      win.close();
      return;
    }
    saveBtn.disabled = true;
    status.textContent = "";
    try {
      const url = mode === "add" ? modal.dataset.addUrl : modal.dataset.url;
      const data = await postForm(url, { avatar: selected || "", name });

      if (mode === "add") {
        // Load the new server (now selected) with its own settings
        window.location.assign(window.location.pathname);
        return;
      }
      // Show the new name and avatar everywhere on the page
      modal.dataset.current = selected || "";
      modal.dataset.serverName = data.name;
      showServerName(data.name);
      document
        .querySelectorAll(".server-avatar-img, .user-avatar, .delete-avatar")
        .forEach((img) => { img.src = data.url; });
      if (selected) openBtn.classList.remove("is-default");
      win.close();
    } catch (err) {
      status.textContent = err.message;
      saveBtn.disabled = false;
    }
  }

  openBtn.addEventListener("click", () => open("change"));

  // Server menu: switch server, or "+ Add server" to name the new one
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
  nameInput.addEventListener("input", updateSaveState);
  modal.querySelectorAll("[data-avatar-cancel]").forEach((btn) => {
    btn.addEventListener("click", win.close);
  });
  // Click outside the window closes it
  modal.addEventListener("click", (e) => {
    if (e.target === modal) win.close();
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
    if (e.key === "Escape") win.close();
    if (e.key !== "Enter") return;
    if (e.target === nameInput) {
      e.preventDefault();
      save();
    } else if (e.target.classList.contains("avatar-option")) {
      e.preventDefault();
      markSelected(e.target.dataset.avatar);
      save();
    }
  });
}

function initServerDelete() {
  const modal = document.getElementById("deleteModal");
  const openBtn = document.getElementById("deleteServerBtn");
  if (!modal || !openBtn) return;
  document.body.appendChild(modal);
  const win = makeWindow(modal, openBtn);
  const confirmBtn = document.getElementById("deleteConfirm");
  const status = document.getElementById("deleteStatus");
  const cancelBtn = modal.querySelector(".avatar-actions [data-delete-cancel]");

  openBtn.addEventListener("click", () => {
    status.textContent = "";
    confirmBtn.disabled = false;
    // Safe default: Cancel has the focus
    win.open(cancelBtn);
  });

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    status.textContent = "";
    try {
      await postForm(modal.dataset.url, { server_number: modal.dataset.server });
      // Load the next server, now selected
      window.location.assign(window.location.pathname);
    } catch (err) {
      status.textContent = err.message;
      confirmBtn.disabled = false;
    }
  });

  modal.querySelectorAll("[data-delete-cancel]").forEach((btn) => {
    btn.addEventListener("click", win.close);
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) win.close();
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") win.close();
  });
}

function initServerWindows() {
  initAvatarPicker();
  initServerDelete();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initServerWindows);
} else {
  initServerWindows();
}
