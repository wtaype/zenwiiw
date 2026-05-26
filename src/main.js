import {
  $$,
  $,
  applyTheme,
  debounce,
  formatDateTime,
  initial,
  notify,
  relativeTime,
  storage,
  textFromHtml,
  uid,
} from "./widev.js";
import { app, defaultTheme, version } from "./wii.js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { htmlToMarkdown, markdownToHtml } from "./notas/convertirMd.js";

const LS_NOTES = "notas_ls";
const LS_OPEN_TABS = "zenwii_windows_open_tabs";
const LS_ACTIVE = "zenwii_windows_active_note";

const demoNote = () => ({
  id: uid(),
  title: "Mi primera nota",
  content: "<p>Bienvenido a Zenwii Windows. Escribe aqui: se guarda local al instante y sincroniza en segundo plano cuando inicias sesion.</p>",
  contentMd: "Bienvenido a Zenwii Windows. Escribe aqui: se guarda local al instante y sincroniza en segundo plano cuando inicias sesion.",
  pinned: true,
  created: Date.now(),
  updated: Date.now(),
  synced: false,
  remote: false,
});

const state = {
  notes: [],
  openTabs: [],
  activeId: null,
  user: storage.get("zenwii_cached_user", null), // Carga instantánea de sesión desde caché local
  syncState: navigator.onLine ? "local" : "offline",
  query: "",
};

let cloudApi = null;
let cloudBoot = null;
let cloudListening = false;
let unsubscribeNotes = null;
let realtimeSyncEnabled = storage.get("zenwii_realtime_sync", true); // Default: ON

const iconClasses = {
  menu: "fa-solid fa-bars",
  focus: "fa-solid fa-expand",
  save: "fa-solid fa-floppy-disk",
  trash: "fa-solid fa-trash-can",
  plus: "fa-solid fa-plus",
  pin: "fa-solid fa-thumbtack",
  cloud: "fa-solid fa-cloud",
  upload: "fa-solid fa-cloud-arrow-up",
  login: "fa-solid fa-arrow-right-to-bracket",
  userPlus: "fa-solid fa-user-plus",
  logout: "fa-solid fa-arrow-right-from-bracket",
  bold: "fa-solid fa-bold",
  italic: "fa-solid fa-italic",
  underline: "fa-solid fa-underline",
  strike: "fa-solid fa-strikethrough",
  alignLeft: "fa-solid fa-align-left",
  alignCenter: "fa-solid fa-align-center",
  alignRight: "fa-solid fa-align-right",
  alignJustify: "fa-solid fa-align-justify",
  list: "fa-solid fa-list-ul",
  listOrdered: "fa-solid fa-list-ol",
  search: "fa-solid fa-magnifying-glass",
  key: "fa-solid fa-key",
  google: "fa-brands fa-google",
  email: "fa-solid fa-envelope",
  user: "fa-solid fa-user",
  x: "fa-solid fa-xmark",
  font: "fa-solid fa-font",
  highlighter: "fa-solid fa-highlighter",
  feather: "fa-solid fa-feather-pointed",
  link: "fa-solid fa-link",
  info: "fa-solid fa-circle-info",
};

function icon(name) {
  return `<i class="ico ${iconClasses[name] || ""}" aria-hidden="true"></i>`;
}

async function dbLoadAll() {
  const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ || window.origin?.includes("tauri") || location.protocol === "tauri:";
  if (isTauri) {
    try {
      const dbNotes = await window.__TAURI__.core.invoke("db_load_notes");
      if (dbNotes && dbNotes.length > 0) {
        state.notes = dbNotes;
      } else {
        const note = demoNote();
        state.notes = [note];
        await window.__TAURI__.core.invoke("db_save_note", { note });
      }
    } catch (err) {
      console.error("[SQLite load error, falling back to LocalStorage]", err);
      state.notes = storage.get(LS_NOTES, []);
    }
  } else {
    state.notes = storage.get(LS_NOTES, []);
  }

  state.openTabs = storage.get(LS_OPEN_TABS, []);
  state.activeId = storage.get(LS_ACTIVE, null);
  
  if (!state.notes.length) {
    const note = demoNote();
    state.notes = [note];
  }
  state.openTabs = state.openTabs.filter((id) => state.notes.some((note) => note.id === id));
  if (!state.openTabs.length) {
    state.openTabs = [state.notes[0].id];
  }
  if (!state.activeId || !state.notes.some((n) => n.id === state.activeId)) {
    state.activeId = state.notes[0].id;
  }
}

async function persist() {
  storage.set(LS_OPEN_TABS, state.openTabs);
  storage.set(LS_ACTIVE, state.activeId);
  
  const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ || window.origin?.includes("tauri") || location.protocol === "tauri:";
  if (isTauri) {
    const note = activeNote();
    if (note) {
      try {
        await window.__TAURI__.core.invoke("db_save_note", { note });
      } catch (err) {
        console.error("[SQLite save error]", err);
      }
    }
  } else {
    storage.set(LS_NOTES, state.notes);
  }
}

const persistSoon = debounce(persist, 180);
const renderChromeSoon = debounce(() => {
  renderDocs();
  renderTabs();
}, 120);

window.addEventListener("beforeunload", persist);

function activeNote() {
  return state.notes.find((note) => note.id === state.activeId) || state.notes[0] || null;
}

function sortedNotes() {
  return [...state.notes].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.updated || 0) - (a.updated || 0);
  });
}

function filteredNotes() {
  const q = state.query.trim().toLowerCase();
  if (!q) return sortedNotes();
  return sortedNotes().filter((note) => `${note.title} ${textFromHtml(note.content)}`.toLowerCase().includes(q));
}

function setSyncState(next, label = null) {
  state.syncState = next;
  const pill = $("#syncPill");
  const text = label || {
    local: "Local",
    pending: "Pendiente",
    syncing: "Guardando",
    synced: "Guardado",
    offline: "Sin conexion",
    error: "Error",
  }[next];
  if (pill) {
    pill.dataset.state = next;
    $(".sync-label", pill).textContent = text;
  }

  // Spin del botón de nube en el topbar durante sincronización
  const cloudIco = $("#btnSyncManual i");
  if (cloudIco) {
    if (next === "syncing") {
      cloudIco.classList.add("syncing-animate");
    } else {
      cloudIco.classList.remove("syncing-animate");
    }
  }

  renderMeta();
}

function renderApp() {
  document.getElementById("app").innerHTML = `
    <section class="app-shell" id="shell">
      <header class="topbar">
        <div class="topbar-left">
          <div class="brand"><div class="brand-mark">${icon("feather")}</div><span>${app}</span></div>
          <button class="icon-btn" id="btnSidebar" title="Archivos">${icon("menu")}</button>
        </div>
        
        <div class="topbar-right">
          <button class="icon-btn" id="btnToggleSearch" title="Buscar notas"><i class="fa-solid fa-magnifying-glass"></i></button>
          <button class="icon-btn" id="btnToggleFormatting" title="Formato de texto"><i class="fa-solid fa-font"></i></button>
          <button class="icon-btn sync-manual-btn" id="btnSyncManual" title="Sincronizar ahora">${icon("cloud")}</button>
          <label class="rt-sync-label" id="rtSyncLabel" title="Tiempo real: ${realtimeSyncEnabled ? 'Activo' : 'Pausado'} — haz clic para ${realtimeSyncEnabled ? 'pausar' : 'activar'} la sincronización en tiempo real">
            <input type="checkbox" id="rtSyncToggle" ${realtimeSyncEnabled ? 'checked' : ''} />
            <span class="rt-sync-track">
              <i class="fas ${realtimeSyncEnabled ? 'fa-cloud' : 'fa-cloud-arrow-up'} rt-sync-icon"></i>
            </span>
          </label>
          <button class="icon-btn meta-status-btn" id="btnMetaInfo" title="Información de la nota"><i class="fa-solid fa-circle-info"></i></button>
          <div id="accountArea"></div>
        </div>
      </header>

      <div class="search-panel" id="searchPanel">
        <div class="search-group">
          ${icon("search")}
          <input class="search-input-top" id="searchInput" placeholder="Buscar notas..." autocomplete="off" />
        </div>
      </div>

      <div class="formatting-panel" id="formattingPanel">
        <div class="tool-group">
          <input class="number-input" id="fontSize" type="number" min="10" max="48" value="16" title="Tamaño de letra" />
        </div>
        <div class="tool-group">
          <button class="tool-btn" data-cmd="bold" title="Negrita">${icon("bold")}</button>
          <button class="tool-btn" data-cmd="italic" title="Cursiva">${icon("italic")}</button>
        </div>
        <div class="tool-group">
          <button class="tool-btn" data-cmd="justifyLeft" title="Alinear izquierda">${icon("alignLeft")}</button>
          <button class="tool-btn" data-cmd="justifyCenter" title="Centrar">${icon("alignCenter")}</button>
          <button class="tool-btn" data-cmd="justifyRight" title="Alinear derecha">${icon("alignRight")}</button>
          <button class="tool-btn" data-cmd="justifyFull" title="Justificar">${icon("alignJustify")}</button>
        </div>
        <div class="tool-group">
          <button class="tool-btn" data-cmd="insertUnorderedList" title="Lista con viñetas">${icon("list")}</button>
          <button class="tool-btn" data-cmd="insertOrderedList" title="Lista numerada">${icon("listOrdered")}</button>
          <button class="tool-btn" id="btnLink" title="Insertar Enlace">${icon("link")}</button>
        </div>
        <div class="tool-group">
          <span class="color-tool">${icon("font")}<input class="color-input" id="textColor" type="color" value="#1f1f1f" title="Color de texto" /></span>
          <span class="color-tool">${icon("highlighter")}<input class="color-input" id="highlightColor" type="color" value="#fff176" title="Color de resaltado" /></span>
        </div>
      </div>

      <div class="workspace">
        <aside class="sidebar">
          <div class="sidebar-head">
            <div class="sidebar-head-row">
              <h2>Archivos</h2>
              <button class="icon-btn" id="btnNew" title="Nueva nota">${icon("plus")}</button>
            </div>
            <div class="new-note-container">
              <input class="new-note-input" id="newNoteInput" placeholder="Nueva nota... (Enter)" autocomplete="off" />
            </div>
          </div>
          <div class="doc-list" id="docList"></div>
        </aside>

        <main class="main-pane">
          <nav class="tabs" id="tabs"></nav>
          <section class="editor-shell">
            <article class="paper">
              <input class="editor-title-input" id="titleInput" placeholder="Sin título" autocomplete="off" />
              <div id="editor" class="editor" contenteditable="true" spellcheck="false" data-placeholder="Comienza a escribir tus ideas..."></div>
            </article>
          </section>
        </main>
      </div>

      <footer class="statusbar">
        <div class="status-left"><button id="btnFocus" class="status-btn">${icon("focus")} <span>Modo Zen</span></button></div>
        <div class="status-center">
          <span class="status-words-badge" id="wordCount" title="Contador de palabras">0</span>
          <span class="status-theme-label">Tema:</span>
          <div class="theme-picker">
            ${["Oro", "Cielo", "Dulce", "Paz", "Mora", "Futuro"].map((theme) => `<button class="theme-dot" data-theme="${theme}" title="${theme}"></button>`).join("")}
          </div>
        </div>
        <div class="status-right">
          <button class="shortcuts-trigger-btn" id="btnSettings" title="Ajustes de la aplicación">
            <i class="fa-solid fa-gear"></i> <span>Ajustes</span>
          </button>
        </div>
      </footer>
    </section>
    <div id="modalContainer"></div>
  `;

  bindEvents();
  applyTheme(storage.get("zenwii_theme", defaultTheme));
  
  // Cargar asíncronamente desde SQLite
  dbLoadAll().then(() => {
    renderAll();
  }).catch((err) => {
    console.error(err);
    renderAll();
  });
}

function runIdle(task) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(task, { timeout: 1400 });
    return;
  }
  setTimeout(task, 160);
}

async function loadCloudApi() {
  if (cloudApi) return cloudApi;
  if (!cloudBoot) {
    cloudBoot = import("./firebase.js")
      .then((api) => {
        cloudApi = api;
        return api;
      })
      .catch((error) => {
        console.warn("[cloud-import]", error);
        setSyncState(navigator.onLine ? "local" : "offline");
        return null;
      });
  }
  return cloudBoot;
}

async function startCloudInBackground() {
  if (cloudListening || !navigator.onLine) return;
  const api = await loadCloudApi();
  if (!api || cloudListening) return;
  cloudListening = true;
  api.onUser((user) => {
    if (!user) {
      if (unsubscribeNotes) {
        unsubscribeNotes();
        unsubscribeNotes = null;
      }
      state.user = null;
      storage.set("zenwii_cached_user", null); // Limpiar sesión en caché
      renderAccount();
      setSyncState(navigator.onLine ? "local" : "offline");
      return;
    }
    setSyncState("syncing", "Conectando");
    api.getProfile(user)
      .then((profile) => {
        state.user = profile || user;
        storage.set("zenwii_cached_user", state.user); // Guardar perfil en caché de alta velocidad
        renderAccount();
        if (profile?.tema) applyTheme(profile.tema);
        return api.loadPreferences(user);
      })
      .then((preferences) => {
        if (preferences?.theme) applyTheme(preferences.theme);
        return loadCloudIntoLocal(api);
      })
      .catch((error) => {
        console.error("[profile-load]", error);
        state.user = user;
        storage.set("zenwii_cached_user", state.user); // Cachear de respaldo
        renderAccount();
        loadCloudIntoLocal(api);
      });
  });
}

async function setSignedProfile(api, userOrProfile) {
  if (!userOrProfile) return;
  const profile = userOrProfile.email && userOrProfile.rol ? userOrProfile : await api.getProfile();
  state.user = profile || userOrProfile;
  renderAccount();
  if (profile?.tema) applyTheme(profile.tema);
  await api.loadPreferences(profile || userOrProfile)
        .then((preferences) => {
          if (preferences?.theme) applyTheme(preferences.theme);
        })
        .catch(console.error);
  await loadCloudIntoLocal(api);
}

function scheduleCloudBoot() {
  runIdle(() => startCloudInBackground().catch(console.error));
}



function renderAccount() {
  const area = $("#accountArea");
  if (!state.user) {
    area.innerHTML = `
      <div class="auth-buttons">
        <button class="google-login-btn" id="btnLogin">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.705A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.705V4.963H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.037l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.963L3.964 7.295C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Login
        </button>
      </div>
    `;
    return;
  }
  const fullName = state.user.nombre && state.user.apellidos ? `${state.user.nombre} ${state.user.apellidos}` : state.user.nombre;
  const displayName = fullName || state.user.usuario || state.user.displayName || state.user.email || "Usuario";
  const avatarUrl = state.user.avatar || state.user.photoURL || state.user.photoUrl;
  area.innerHTML = `
    <div class="user-dropdown-container">
      <button class="account-chip-btn" id="btnUserMenu" aria-label="Menú de usuario" aria-haspopup="true">
        ${avatarUrl ? `<img class="avatar-img" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">` : `<span class="avatar">${initial(displayName)}</span>`}
        <span class="account-name">${displayName}</span>
        <svg class="chevron-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      
      <div class="user-dropdown-menu" id="userMenuDropdown">
        <div class="user-dropdown-header">
          <p class="user-name">${escapeHtml(displayName)}</p>
          <p class="user-email">${escapeHtml(state.user.email || "")}</p>
          <span class="user-badge">${escapeHtml((state.user.rol || "Smile").toUpperCase())}</span>
        </div>
        <div class="user-dropdown-divider"></div>
        <button class="user-dropdown-item" id="btnShowProfile">
          ${icon("user")} <span>Mi Perfil</span>
        </button>
        <button class="user-dropdown-item logout" id="btnLogoutDropdown">
          ${icon("logout")} <span>Cerrar sesión</span>
        </button>
      </div>
    </div>
  `;
}

function showProfileModal() {
  const container = $("#modalContainer");
  if (!container || !state.user) return;
  
  const fullName = state.user.nombre && state.user.apellidos ? `${state.user.nombre} ${state.user.apellidos}` : state.user.nombre;
  const displayName = fullName || state.user.usuario || state.user.displayName || state.user.email || "Usuario";
  const avatarUrl = state.user.avatar || state.user.photoURL || state.user.photoUrl;
  const email = state.user.email || "Sin correo";
  const role = state.user.rol || "smile";
  const plan = state.user.plan || "free";
  const registeredBy = state.user.registradoPor || "Google";
  
  container.innerHTML = `
    <div class="modal-backdrop active" id="profileModalBackdrop">
      <div class="modal profile-modal">
        <div class="modal-head">
          <h2>Mi Perfil Premium</h2>
          <button class="icon-btn" id="btnCloseProfileModal" title="Cerrar">${icon("x")}</button>
        </div>
        <div class="profile-modal-content">
          <div class="profile-avatar-large">
            ${avatarUrl ? `<img class="avatar-large-img" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">` : `<span class="avatar-large-text">${initial(displayName)}</span>`}
          </div>
          <div class="profile-info-grid">
            <div class="profile-info-item">
              <span class="info-label">Nombre</span>
              <span class="info-val" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
            </div>
            <div class="profile-info-item">
              <span class="info-label">Correo</span>
              <span class="info-val" title="${escapeHtml(email)}">${escapeHtml(email)}</span>
            </div>
            <div class="profile-info-item">
              <span class="info-label">Rol</span>
              <span class="info-val badge-val">${escapeHtml(role.toUpperCase())}</span>
            </div>
            <div class="profile-info-item">
              <span class="info-label">Plan</span>
              <span class="info-val badge-val plan-val">${escapeHtml(plan.toUpperCase())}</span>
            </div>
            <div class="profile-info-item full-width">
              <span class="info-label">Origen de Registro</span>
              <span class="info-val">${escapeHtml(registeredBy === "google-desktop" || registeredBy === "google" ? "Google OAuth 2.0" : "Correo Electrónico")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function closeProfileModal() {
  const container = $("#modalContainer");
  if (container) container.innerHTML = "";
}

function showSettingsModal() {
  const container = $("#modalContainer");
  if (!container) return;
  
  const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ || window.origin?.includes("tauri") || location.protocol === "tauri:";
  
  container.innerHTML = `
    <div class="modal-backdrop active" id="settingsModalBackdrop">
      <div class="modal settings-modal glassmorphic animate-in">
        <div class="modal-head">
          <h2>${icon("feather")} Ajustes del Sistema</h2>
          <button class="icon-btn" id="btnCloseSettingsModal" title="Cerrar">${icon("x")}</button>
        </div>
        <div class="settings-modal-content">
          <div class="settings-tab-section">
            <h3>Configuración General</h3>
            <div class="settings-row">
              <span class="settings-label">Motor de Base de Datos:</span>
              <span class="settings-val badge-val">${isTauri ? "SQLite Nativo (Bundled)" : "LocalStorage Fallback"}</span>
            </div>
            <div class="settings-row">
              <span class="settings-label">Estado Offline:</span>
              <span class="settings-val badge-val">${navigator.onLine ? "Sincronizado" : "Modo Sin Conexión"}</span>
            </div>
            <div class="settings-row">
              <span class="settings-label">Mantenimiento:</span>
              <button class="btn btn-secondary compact-settings-btn" id="btnClearCacheBtn" title="Limpia cookies y sesión del sistema">${icon("trash")} Limpiar Sesión</button>
            </div>
          </div>
          
          <div class="settings-tab-section">
            <h3>Atajos del Teclado</h3>
            <div class="shortcuts-grid">
              <div class="shortcut-row">
                <span class="shortcut-desc">Sincronizar en Firebase</span>
                <div class="shortcut-keys"><kbd>Ctrl</kbd> + <kbd>S</kbd></div>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Nueva nota / Pestaña</span>
                <div class="shortcut-keys"><kbd>Ctrl</kbd> + <kbd>N</kbd></div>
              </div>
              <div class="shortcut-row">
                <span class="shortcut-desc">Cerrar modales o salir de Modo Zen</span>
                <div class="shortcut-keys"><kbd>Esc</kbd></div>
              </div>
            </div>
          </div>
          
          <div class="shortcuts-brand-footer">
            <img class="shortcuts-logo" src="/icon.png" alt="Zenwii Logo" />
            <span>${app} Windows v${version}</span>
          </div>
        </div>
      </div>
    </div>
  `;
  
  const close = () => { container.innerHTML = ""; };
  document.getElementById("btnCloseSettingsModal")?.addEventListener("click", close);
  document.getElementById("settingsModalBackdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "settingsModalBackdrop") close();
  });
  
  document.getElementById("btnClearCacheBtn")?.addEventListener("click", async () => {
    close();
    if (unsubscribeNotes) {
      unsubscribeNotes();
      unsubscribeNotes = null;
    }
    state.user = null;
    storage.set("zenwii_cached_user", null);
    renderAccount();
    const api = await loadCloudApi();
    await api?.logout();
    
    if (window.wisafe && typeof window.wisafe.salir === "function") {
      window.wisafe.salir(["wiTema", "wiSmart", "cookiesPrivacidad"]).then(() => {
        location.reload();
      });
    } else {
      location.reload();
    }
  });
}

function showMetaModal() {
  const container = $("#modalContainer");
  if (!container) return;
  
  const note = activeNote();
  if (!note) return;
  
  const stateText = {
    local: "Guardado localmente en SQLite",
    pending: "Cambios locales pendientes de sincronizar",
    syncing: "Sincronizando con Firebase Firestore...",
    synced: "Sincronizado correctamente en la nube",
    offline: "Sin conexión a internet (Modo Offline)",
    error: "Error de sincronización con la nube",
  }[state.syncState] || "Guardado local";
  
  container.innerHTML = `
    <div class="modal-backdrop active" id="metaModalBackdrop">
      <div class="modal meta-info-modal glassmorphic animate-in">
        <div class="modal-head">
          <h2>${icon("feather")} Info del Documento</h2>
          <button class="icon-btn" id="btnCloseMetaModal" title="Cerrar">${icon("x")}</button>
        </div>
        <div class="modal-body meta-modal-body">
          <div class="meta-detail-row">
            <span class="meta-detail-label">Título:</span>
            <span class="meta-detail-value">${escapeHtml(note.title || "Documento sin título")}</span>
          </div>
          <div class="meta-detail-row">
            <span class="meta-detail-label">Estado:</span>
            <span class="meta-detail-value badge-val state-${state.syncState}">${stateText}</span>
          </div>
          <div class="meta-detail-row">
            <span class="meta-detail-label">Creado:</span>
            <span class="meta-detail-value">${formatDateTime(note.created)}</span>
          </div>
          <div class="meta-detail-row">
            <span class="meta-detail-label">Modificado:</span>
            <span class="meta-detail-value">${formatDateTime(note.updated)}</span>
          </div>
          <div class="meta-detail-row">
            <span class="meta-detail-label">ID de Nota:</span>
            <span class="meta-detail-value code-val">${note.id}</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" id="btnOkMeta">Aceptar</button>
        </div>
      </div>
    </div>
  `;
  
  const close = () => { container.innerHTML = ""; };
  document.getElementById("btnCloseMetaModal")?.addEventListener("click", close);
  document.getElementById("btnOkMeta")?.addEventListener("click", close);
  document.getElementById("metaModalBackdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "metaModalBackdrop") close();
  });
}

function renderMeta() {
  const note = activeNote();
  const syncBtn = $("#btnSyncManual");
  const infoBtn = $("#btnMetaInfo");
  if (!note) return;
  
  if (syncBtn) {
    syncBtn.innerHTML = icon("cloud");
    
    if (note.synced && state.syncState === "synced") {
      syncBtn.style.color = "var(--success)";
      syncBtn.style.filter = "drop-shadow(0 0 3px var(--success))";
    } else if (state.syncState === "syncing") {
      syncBtn.style.color = "var(--warning)";
      syncBtn.style.filter = "none";
    } else {
      syncBtn.style.color = "#8c8c8c";
      syncBtn.style.filter = "none";
    }
    
    // Spin only during syncing
    const syncIco = syncBtn.querySelector("i");
    if (syncIco) {
      if (state.syncState === "syncing") {
        syncIco.classList.add("syncing-animate");
      } else {
        syncIco.classList.remove("syncing-animate");
      }
    }
    
    const stateText = {
      local: "Guardado local",
      pending: "Cambios locales pendientes",
      syncing: "Guardando cambio...",
      synced: "Guardado exitosamente",
      offline: "Sin conexión",
      error: "Error al guardar",
    }[state.syncState] || "Local";
    syncBtn.title = `${stateText} — clic para sincronizar`;
  }
  
  if (infoBtn) {
    infoBtn.innerHTML = icon("info");
    infoBtn.style.color = "var(--accent-strong)";
    infoBtn.title = "Información del documento";
  }
}

function renderDocs() {
  const list = $("#docList");
  if (!list) return;
  const notes = filteredNotes();
  const counter = $(".doc-count");
  if (counter) counter.textContent = `${state.notes.length} nota${state.notes.length === 1 ? "" : "s"}`;
  list.innerHTML = notes.length
    ? notes.map((note) => {
        const active = note.id === state.activeId ? "active" : "";
        const snippet = textFromHtml(note.content) || "Sin contenido...";
        const cloud = note.synced ? icon("cloud") : icon("upload");
        return `
          <button class="doc-card ${active} ${note.pinned ? "pinned" : ""}" data-id="${note.id}">
            <div class="doc-card-title">
              <h3>${escapeHtml(note.title || "Documento sin título")}</h3>
              <span class="card-icons">
                ${note.pinned ? icon("pin") : ""}
                <span class="delete-card-btn" data-id="${note.id}" title="Eliminar nota">${icon("trash")}</span>
              </span>
            </div>
            <p>${escapeHtml(snippet)}</p>
            <div class="doc-meta"><span>${relativeTime(note.updated)}</span><span>${cloud}</span></div>
          </button>
        `;
      }).join("")
    : `<div class="doc-card"><h3>Sin resultados</h3><p>Prueba otra búsqueda.</p></div>`;
}

function renderTabs() {
  const tabs = $("#tabs");
  if (!tabs) return;
  state.openTabs = state.openTabs.filter((id) => state.notes.some((note) => note.id === id));
  if (state.activeId && !state.openTabs.includes(state.activeId)) state.openTabs.push(state.activeId);
  tabs.innerHTML = state.openTabs.map((id) => {
    const note = state.notes.find((item) => item.id === id);
    if (!note) return "";
    return `
      <button class="tab ${id === state.activeId ? "active" : ""}" data-id="${id}">
        <span class="tab-status-dot ${note.synced ? "synced" : "unsynced"}" title="${note.synced ? "Sincronizado con la nube" : "Cambios locales no guardados"}"></span>
        <span>${escapeHtml(note.title || "Sin título")}</span>
        <button class="tab-close" data-close="${id}">${icon("x")}</button>
      </button>
    `;
  }).join("") + `<button class="tab-btn icon-btn" id="btnNewTab">${icon("plus")}</button>`;
}

function renderEditor() {
  const note = activeNote();
  if (!note) return;
  const titleInput = $("#titleInput");
  if (titleInput) titleInput.value = note.title || "";
  const editor = $("#editor");
  if (editor) {
    editor.innerHTML = note.content || "";
  }
  updateStats();
}

function renderAll({ editor = true } = {}) {
  renderAccount();
  renderDocs();
  renderTabs();
  renderMeta();
  if (editor) renderEditor();
  setSyncState(navigator.onLine ? state.syncState : "offline");
  persist();
}

async function createNote() {
  const note = {
    id: uid(),
    title: "",
    content: "",
    contentMd: "",
    pinned: false,
    created: Date.now(),
    updated: Date.now(),
    synced: false,
    remote: false,
  };
  state.notes.unshift(note);
  state.activeId = note.id;
  state.openTabs.push(note.id);
  
  const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ || window.origin?.includes("tauri") || location.protocol === "tauri:";
  if (isTauri) {
    try {
      await window.__TAURI__.core.invoke("db_save_note", { note });
    } catch (err) {
      console.error("[SQLite save note error]", err);
    }
  }
  
  renderAll();
  $("#titleInput").focus();
}

function markChanged() {
  const note = activeNote();
  if (!note) return;
  note.title = $("#titleInput").value.trim();
  note.content = $("#editor").innerHTML;
  note.contentMd = htmlToMarkdown(note.content);
  note.updated = Date.now();
  note.synced = false;
  persistSoon();
  updateStats();
  renderChromeSoon();
  setSyncState(navigator.onLine ? "pending" : "offline");
  autoSync();
}

const autoSync = debounce(() => realtimeSyncEnabled ? syncActiveNote(false) : null, 900);

async function syncActiveNote(manual = true) {
  const note = activeNote();
  if (!note) return;
  if (!navigator.onLine) {
    setSyncState("offline");
    if (manual) notify("Estas sin conexion. Tu nota quedo guardada localmente.", "warning");
    return;
  }
  if (!state.user) {
    if (manual) scheduleCloudBoot();
    setSyncState("local");
    if (manual) notify("Guardado local. Inicia sesion para sincronizar en la nube.", "info");
    return;
  }
  const api = await loadCloudApi();
  if (!api) {
    if (manual) notify("La app sigue en modo local. Firebase cargara en segundo plano.", "warning");
    return;
  }
  try {
    setSyncState("syncing");
    note.contentMd = htmlToMarkdown(note.content);
    const oldId = note.id;
    const syncedId = await api.saveRemoteNote(state.user, note);
    note.synced = true;
    note.remote = true;
    note.updated = Date.now();

    if (syncedId && syncedId !== oldId) {
      note.id = syncedId;
      state.openTabs = state.openTabs.map((tid) => (tid === oldId ? syncedId : tid));
      if (state.activeId === oldId) {
        state.activeId = syncedId;
      }
      const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ || window.origin?.includes("tauri") || location.protocol === "tauri:";
      if (isTauri) {
        try {
          await window.__TAURI__.core.invoke("db_delete_note", { id: oldId });
        } catch (err) {
          console.error("[SQLite delete old note error]", err);
        }
      }
    }

    persist();
    renderDocs();
    setSyncState("synced");
    if (manual) notify("Guardado exitosamente.", "success");
  } catch (error) {
    console.error("[sync]", error);
    setSyncState("error");
    if (manual) notify("No pude sincronizar. Reviso Firebase/Auth y seguimos.", "error");
  }
}

async function syncAllPending() {
  if (!state.user || !navigator.onLine) return;
  const api = await loadCloudApi();
  if (!api) return;
  const pending = state.notes.filter((note) => !note.synced && (note.title || textFromHtml(note.content)));
  if (!pending.length) return;
  setSyncState("syncing");
  for (const note of pending) {
    note.contentMd = htmlToMarkdown(note.content);
    const oldId = note.id;
    const syncedId = await api.saveRemoteNote(state.user, note);
    note.synced = true;
    note.remote = true;
    if (syncedId && syncedId !== oldId) {
      note.id = syncedId;
      state.openTabs = state.openTabs.map((tid) => (tid === oldId ? syncedId : tid));
      if (state.activeId === oldId) {
        state.activeId = syncedId;
      }
      const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ || window.origin?.includes("tauri") || location.protocol === "tauri:";
      if (isTauri) {
        try {
          await window.__TAURI__.core.invoke("db_delete_note", { id: oldId });
        } catch (err) {
          console.error("[SQLite delete old note error]", err);
        }
      }
    }
  }
  persist();
  renderDocs();
  setSyncState("synced");
}

async function loadCloudIntoLocal(api = cloudApi) {
  if (!state.user) return;
  if (!api) return;
  try {
    setSyncState("syncing");
    
    // Desvincular suscripción previa si existe
    if (unsubscribeNotes) {
      unsubscribeNotes();
      unsubscribeNotes = null;
    }
    
    if (realtimeSyncEnabled) {
      // Iniciar suscripción en tiempo real
      unsubscribeNotes = api.subscribeRemoteNotes(state.user, async (remoteNotes) => {
        const byId = new Map(state.notes.map((note) => [note.id, note]));
        let changed = false;
        
        remoteNotes.forEach((note) => {
          const local = byId.get(note.id);
          
          // Si es una nota nueva o tiene cambios más recientes en la nube
          if (!local || (note.updated || 0) > (local.updated || 0)) {
            // Si el usuario está editando activamente esta nota, evitamos sobrescribir para no perder foco
            if (local && local.id === state.activeId && document.activeElement === document.getElementById("editor")) {
              console.log("[Sync] Obviando sobrescritura en caliente para evitar pérdida de foco.");
              return;
            }
            byId.set(note.id, note);
            changed = true;
          }
        });
        
        // Mantener las notas locales no sincronizadas todavía
        state.notes.forEach((note) => {
          if (!note.synced && !byId.has(note.id)) {
            byId.set(note.id, note);
          }
        });
        
        if (changed || !state.notes.length) {
          state.notes = [...byId.values()];
          if (!state.notes.length) createNote();
          if (!state.activeId || !state.notes.some((note) => note.id === state.activeId)) {
            state.activeId = sortedNotes()[0]?.id;
          }
          
          // Renderizar el editor solo si no tiene el foco activo para no interrumpir la escritura
          renderAll({ editor: document.activeElement !== document.getElementById("editor") });
        }
        setSyncState("synced");
      });
    } else {
      // Modo sin tiempo real: carga única (snapshot)
      const remoteNotes = await api.loadRemoteNotesOnce(state.user);
      if (remoteNotes && remoteNotes.length) {
        const byId = new Map(state.notes.map((note) => [note.id, note]));
        remoteNotes.forEach((note) => {
          const local = byId.get(note.id);
          if (!local || (note.updated || 0) > (local.updated || 0)) {
            byId.set(note.id, note);
          }
        });
        state.notes.forEach((note) => {
          if (!note.synced && !byId.has(note.id)) byId.set(note.id, note);
        });
        state.notes = [...byId.values()];
        if (!state.notes.length) createNote();
        if (!state.activeId || !state.notes.some((note) => note.id === state.activeId)) {
          state.activeId = sortedNotes()[0]?.id;
        }
        renderAll({ editor: document.activeElement !== document.getElementById("editor") });
      }
      setSyncState("synced");
    }
    
    // Sincronizar cualquier nota local pendiente acumulada en offline
    await syncAllPending();
  } catch (error) {
    console.error("[cloud-load]", error);
    setSyncState("error");
    notify("No pude cargar notas de Firebase. La app sigue funcionando local.", "warning");
  }
}

async function deleteNote(note) {
  if (!note) return;
  
  showDeleteModalForNote(note, async () => {
    state.notes = state.notes.filter((item) => item.id !== note.id);
    state.openTabs = state.openTabs.filter((id) => id !== note.id);
    
    const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ || window.origin?.includes("tauri") || location.protocol === "tauri:";
    if (isTauri) {
      try {
        await window.__TAURI__.core.invoke("db_delete_note", { id: note.id });
      } catch (err) {
        console.error("[SQLite delete note error]", err);
      }
    }
    
    if (state.user && note.remote) {
      loadCloudApi().then((api) => api?.deleteRemoteNote(state.user, note.id)).catch(console.error);
    }
    
    if (!state.notes.length) {
      const dNote = demoNote();
      state.notes.push(dNote);
      if (isTauri) {
        await window.__TAURI__.core.invoke("db_save_note", { note: dNote });
      }
    }
    
    if (state.activeId === note.id) {
      state.activeId = sortedNotes()[0].id;
    }
    renderAll();
    notify("Nota eliminada.", "info");
  });
}

function updateStats() {
  const note = activeNote();
  const words = textFromHtml(note?.content || "").split(/\s+/).filter(Boolean).length;
  const wordCount = $("#wordCount");
  if (wordCount) wordCount.textContent = words;
}

function showDeleteModalForNote(note, onConfirm) {
  const container = document.getElementById("modalContainer");
  if (!container) return;
  container.innerHTML = `
    <div class="modal-backdrop active" id="deleteModalBackdrop">
      <div class="modal delete-modal glassmorphic animate-in">
        <div class="modal-head">
          <h2>${icon("trash")} ¿Eliminar nota?</h2>
          <button class="icon-btn" id="btnCloseDeleteModal" title="Cerrar">${icon("x")}</button>
        </div>
        <div class="modal-body">
          <p>¿Estás seguro de que deseas eliminar la nota <strong>"${escapeHtml(note.title || "sin título")}"</strong>? Esta acción es permanente y borrará la nota de tu disco local y de la nube.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="btnCancelDelete">Cancelar</button>
          <button class="btn btn-danger" id="btnConfirmDelete">Eliminar</button>
        </div>
      </div>
    </div>
  `;
  const close = () => { container.innerHTML = ""; };
  document.getElementById("btnCloseDeleteModal")?.addEventListener("click", close);
  document.getElementById("btnCancelDelete")?.addEventListener("click", close);
  document.getElementById("btnConfirmDelete")?.addEventListener("click", () => {
    close();
    onConfirm();
  });
  document.getElementById("deleteModalBackdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "deleteModalBackdrop") close();
  });
}

function showLinkModal() {
  const container = document.getElementById("modalContainer");
  if (!container) return;
  
  const selection = window.getSelection();
  let savedRange = null;
  if (selection.rangeCount > 0) {
    savedRange = selection.getRangeAt(0).cloneRange();
  }
  
  container.innerHTML = `
    <div class="modal-backdrop active" id="linkModalBackdrop">
      <div class="modal link-modal glassmorphic animate-in">
        <div class="modal-head">
          <h2>${icon("link")} Insertar Enlace</h2>
          <button class="icon-btn" id="btnCloseLinkModal" title="Cerrar">${icon("x")}</button>
        </div>
        <div class="modal-body">
          <input class="title-input" id="linkText" placeholder="Texto del enlace (opcional)" autocomplete="off" />
          <input class="search-input" id="linkUrl" placeholder="https://ejemplo.com" autocomplete="off" />
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="btnCancelLink">Cancelar</button>
          <button class="btn btn-primary" id="btnConfirmLink">Insertar</button>
        </div>
      </div>
    </div>
  `;
  
  const close = () => { container.innerHTML = ""; };
  
  const linkText = document.getElementById("linkText");
  const linkUrl = document.getElementById("linkUrl");
  if (linkText && savedRange) {
    linkText.value = savedRange.toString();
  }
  
  linkUrl?.focus();
  
  document.getElementById("btnCloseLinkModal")?.addEventListener("click", close);
  document.getElementById("btnCancelLink")?.addEventListener("click", close);
  document.getElementById("btnConfirmLink")?.addEventListener("click", () => {
    const url = linkUrl?.value.trim();
    const text = linkText?.value.trim() || url;
    if (url) {
      if (savedRange) {
        selection.removeAllRanges();
        selection.addRange(savedRange);
      }
      if (!savedRange || savedRange.collapsed) {
        const html = `<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(text)}</a>`;
        document.execCommand("insertHTML", false, html);
      } else {
        document.execCommand("createLink", false, url);
      }
      markChanged();
    }
    close();
  });
  
  document.getElementById("linkModalBackdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "linkModalBackdrop") close();
  });
}

function exec(command, value = null) {
  document.execCommand("styleWithCSS", false, true);
  document.execCommand(command, false, value);
  $("#editor").focus();
  markChanged();
}

function closeAllDropdowns() {
  $$(".dropdown-menu.active").forEach((m) => m.classList.remove("active"));
}

function showDropdown(btn, dropdown) {
  closeAllDropdowns();
  const rect = btn.getBoundingClientRect();
  dropdown.style.top = `${rect.bottom + window.scrollY + 6}px`;
  dropdown.style.left = `${rect.left + window.scrollX}px`;
  dropdown.classList.add("active");
}

function bindEvents() {
  // Sidebar toggle
  $("#btnSidebar")?.addEventListener("click", () => {
    $("#shell").classList.toggle("sidebar-closed");
  });

  // Main controls
  $("#btnFocus")?.addEventListener("click", () => $("#shell").classList.toggle("focus"));
  $("#btnNew")?.addEventListener("click", createNote);
  $("#titleInput")?.addEventListener("input", markChanged);
  $("#editor")?.addEventListener("input", markChanged);
  $("#newNoteInput")?.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      const title = e.target.value.trim();
      if (!title) return;
      e.target.value = "";
      
      const note = {
        id: uid(),
        title: title,
        content: "",
        contentMd: "",
        pinned: false,
        created: Date.now(),
        updated: Date.now(),
        synced: false,
        remote: false,
      };
      
      state.notes.unshift(note);
      state.activeId = note.id;
      state.openTabs.push(note.id);
      
      const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ || window.origin?.includes("tauri") || location.protocol === "tauri:";
      if (isTauri) {
        try {
          await window.__TAURI__.core.invoke("db_save_note", { note });
        } catch (err) {
          console.error("[SQLite save note error]", err);
        }
      }
      
      renderAll();
      $("#editor").focus();
      notify("Nota creada: " + title, "success");
    }
  });
  $("#editor")?.addEventListener("keydown", (e) => {
    if (e.key === " ") {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        const startOffset = range.startOffset;
        if (text.startsWith("#") && startOffset === 1) {
          e.preventDefault();
          node.textContent = text.slice(1);
          document.execCommand("formatBlock", false, "h1");
        } else if (text.startsWith("##") && startOffset === 2) {
          e.preventDefault();
          node.textContent = text.slice(2);
          document.execCommand("formatBlock", false, "h2");
        } else if (text.startsWith("###") && startOffset === 3) {
          e.preventDefault();
          node.textContent = text.slice(3);
          document.execCommand("formatBlock", false, "h3");
        } else if (text.startsWith("-") && startOffset === 1) {
          e.preventDefault();
          node.textContent = text.slice(1);
          document.execCommand("insertUnorderedList");
        } else if (text.startsWith("1.") && startOffset === 2) {
          e.preventDefault();
          node.textContent = text.slice(2);
          document.execCommand("insertOrderedList");
        }
      }
    }
  });

  $("#searchInput")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderDocs();
  });

  document.addEventListener("click", async (event) => {
    // Intercept click on delete-card-btn
    const deleteCardBtn = event.target.closest(".delete-card-btn");
    if (deleteCardBtn) {
      event.stopPropagation();
      event.preventDefault();
      const noteId = deleteCardBtn.dataset.id;
      const noteToDelete = state.notes.find((n) => n.id === noteId);
      if (noteToDelete) {
        deleteNote(noteToDelete);
      }
      return;
    }

    // Toggle user dropdown on click
    const userMenuBtn = event.target.closest("#btnUserMenu");
    if (userMenuBtn) {
      event.stopPropagation();
      $("#userMenuDropdown")?.classList.toggle("active");
      $("#btnUserMenu")?.classList.toggle("active");
    } else if (!event.target.closest("#userMenuDropdown")) {
      $("#userMenuDropdown")?.classList.remove("active");
      $("#btnUserMenu")?.classList.remove("active");
    }

    // Close mobile profile modal when clicking backdrop outside the card
    if (event.target.id === "profileModalBackdrop" || event.target.closest("#btnCloseProfileModal")) {
      closeProfileModal();
    }

    // Close shortcuts modal when clicking backdrop or close button
    if (event.target.id === "shortcutsModalBackdrop" || event.target.closest("#btnCloseShortcutsModal")) {
      closeShortcutsModal();
    }

    const doc = event.target.closest(".doc-card[data-id]");
    if (doc) {
      state.activeId = doc.dataset.id;
      if (!state.openTabs.includes(state.activeId)) state.openTabs.push(state.activeId);
      renderAll();
      // Auto-close sidebar drawer on note select (mobile screens <= 820px)
      if (window.innerWidth <= 820) {
        $("#shell")?.classList.add("sidebar-closed");
      }
    }

    // Click outside sidebar closes it on mobile/tablet widths
    if (window.innerWidth <= 820) {
      if (!event.target.closest(".sidebar") && !event.target.closest("#btnSidebar") && !event.target.closest(".toast-stack") && !event.target.closest(".modal-backdrop")) {
        $("#shell")?.classList.add("sidebar-closed");
      }
    }

    const tab = event.target.closest(".tab[data-id]");
    if (tab && !event.target.closest(".tab-close")) {
      state.activeId = tab.dataset.id;
      renderAll();
    }

    const close = event.target.closest(".tab-close");
    if (close) {
      event.stopPropagation();
      state.openTabs = state.openTabs.filter((id) => id !== close.dataset.close);
      if (state.activeId === close.dataset.close) state.activeId = state.openTabs[0] || sortedNotes()[0]?.id;
      renderAll();
    }

    if (event.target.closest("#btnLogin")) {
      handleGoogleLogin();
    }
    if (event.target.closest("#googleBtn")) handleGoogleLogin();
    if (event.target.closest("#btnNewTab")) createNote();
    if (event.target.closest("#btnShowProfile")) {
      $("#userMenuDropdown")?.classList.remove("active");
      $("#btnUserMenu")?.classList.remove("active");
      showProfileModal();
    }
    if (event.target.closest("#btnLink")) {
      showLinkModal();
    }
    if (event.target.closest("#btnLogout") || event.target.closest("#btnLogoutDropdown")) {
      $("#userMenuDropdown")?.classList.remove("active");
      $("#btnUserMenu")?.classList.remove("active");
      if (unsubscribeNotes) {
        unsubscribeNotes();
        unsubscribeNotes = null;
      }
      state.user = null;
      storage.set("zenwii_cached_user", null); // Limpiar sesión en caché al instante
      renderAccount();
      const api = await loadCloudApi();
      await api?.logout();
      notify("Sesión cerrada. Tus notas locales siguen aquí.", "info");
    }
    if (event.target.closest("#btnSettings")) {
      showSettingsModal();
    }
    if (event.target.closest("#btnMetaInfo")) {
      showMetaModal();
    }
    if (event.target.closest("#btnSyncManual")) {
      syncActiveNote(true);
    }
    if (event.target.closest("#btnToggleSearch")) {
      $("#searchPanel")?.classList.toggle("active");
      $("#btnToggleSearch")?.classList.toggle("active");
      if ($("#searchPanel")?.classList.contains("active")) {
        $("#searchInput")?.focus();
        $("#formattingPanel")?.classList.remove("active");
        $("#btnToggleFormatting")?.classList.remove("active");
      }
    }
    if (event.target.closest("#btnToggleFormatting")) {
      $("#formattingPanel")?.classList.toggle("active");
      $("#btnToggleFormatting")?.classList.toggle("active");
      if ($("#formattingPanel")?.classList.contains("active")) {
        $("#searchPanel")?.classList.remove("active");
        $("#btnToggleSearch")?.classList.remove("active");
      }
    }
    
    if (!event.target.closest("#formattingPanel") && !event.target.closest("#btnToggleFormatting") &&
        !event.target.closest("#searchPanel") && !event.target.closest("#btnToggleSearch")) {
      $("#formattingPanel")?.classList.remove("active");
      $("#btnToggleFormatting")?.classList.remove("active");
      $("#searchPanel")?.classList.remove("active");
      $("#btnToggleSearch")?.classList.remove("active");
    }
  });

  // Direct Desktop Text Formatting Controls
  $$(".tool-btn[data-cmd]").forEach((button) => button.addEventListener("click", () => exec(button.dataset.cmd)));
  $("#fontSize")?.addEventListener("change", (event) => {
    const size = Math.max(10, Math.min(48, Number(event.target.value) || 16));
    const editor = $("#editor");
    if (editor) editor.style.fontSize = `${size}px`;
    markChanged();
  });
  $("#textColor")?.addEventListener("input", (event) => exec("foreColor", event.target.value));
  $("#highlightColor")?.addEventListener("input", (event) => exec("hiliteColor", event.target.value));

  $$(".theme-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      const color = getComputedStyle(dot).backgroundColor;
      const rawTheme = `${dot.dataset.theme}|${rgbToHex(color)}`;
      applyTheme(rawTheme);
      if (state.user) saveThemePreference(rawTheme).catch(console.error);
      notify(`Tema ${dot.dataset.theme} aplicado.`, "success", 1600);
    });
  });

  window.addEventListener("online", () => {
    setSyncState("pending");
    scheduleCloudBoot();
    syncAllPending().catch(console.error);
  });
  window.addEventListener("offline", () => setSyncState("offline"));

  // Real-time sync toggle handler
  document.addEventListener("change", (event) => {
    if (event.target.id === "rtSyncToggle") {
      const on = event.target.checked;
      realtimeSyncEnabled = on;
      storage.set("zenwii_realtime_sync", on);
      
      const rtIcon = document.querySelector(".rt-sync-icon");
      if (rtIcon) rtIcon.className = `fas ${on ? "fa-cloud" : "fa-cloud-arrow-up"} rt-sync-icon`;
      const rtLabel = document.getElementById("rtSyncLabel");
      if (rtLabel) rtLabel.title = `Tiempo real: ${on ? "Activo" : "Pausado"}`;

      if (on && state.user) {
        // Reanudar: cargar nube y refrescar editor inmediatamente
        notify("Tiempo real activado. Actualizando...", "info", 2000);
        loadCloudApi().then(async (api) => {
          if (!api) return;
          await loadCloudIntoLocal(api);
          // Forzar render del editor con el contenido más reciente
          renderEditor();
        }).catch(console.error);
      } else if (!on && unsubscribeNotes) {
        unsubscribeNotes();
        unsubscribeNotes = null;
        setSyncState(state.syncState === "syncing" ? "synced" : state.syncState);
        notify("Tiempo real pausado. Ctrl+S para guardar en la nube.", "info", 2500);
      }
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if ($("#shell").classList.contains("focus")) $("#shell").classList.remove("focus");
      $("#userMenuDropdown")?.classList.remove("active");
      $("#btnUserMenu")?.classList.remove("active");
      $("#formattingPanel")?.classList.remove("active");
      $("#btnToggleFormatting")?.classList.remove("active");
      $("#searchPanel")?.classList.remove("active");
      $("#btnToggleSearch")?.classList.remove("active");
      closeProfileModal();
      const modalCont = document.getElementById("modalContainer");
      if (modalCont) modalCont.innerHTML = "";
    }
    if (event.ctrlKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      createNote();
    }
    if (event.ctrlKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      syncActiveNote(true);
    }
  });
}
async function saveThemePreference(theme) {
  storage.set("zenwii_theme", theme);
  if (!state.user) return;
  const api = await loadCloudApi();
  await api?.savePreferences(state.user, { theme, surface: "windows" });
}

async function handleGoogleLogin() {
  const isTauri = window.__TAURI__ || window.__TAURI_INTERNALS__ || window.origin?.includes("tauri") || location.protocol === "tauri:";
  const btn = $("#btnLogin");

  // Label hardcodeado para que el finally SIEMPRE restaure correctamente
  // sin importar cuantas veces se haya llamado antes
  const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.705A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.705V4.963H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.037l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.963L3.964 7.295C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>`;
  const ORIGINAL_LABEL = `${GOOGLE_SVG} Login`;

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${GOOGLE_SVG} Login...`;
    }
    setSyncState("syncing", "Conectando");

    if (isTauri) {
      // 1. Iniciar el servidor TCP en Rust (escucha en puerto 1425)
      const invokePromise = window.__TAURI__.core.invoke("start_auth_server");

      // 2. Abrir la pasarela de auth en el navegador del sistema
      await openUrl("https://zenwii.web.app/notawin.html");
      notify("Se abrió tu navegador. Inicia sesión con Google y regresa aquí.", "info", 7000);

      // 3. Esperar a que el servidor Rust capture los tokens del browser
      const tokens = await invokePromise;
      const idToken = decodeURIComponent(tokens.idToken || "");
      const accessToken = decodeURIComponent(tokens.accessToken || "");

      // 4. Autenticar en Firebase con el token capturado
      const api = await loadCloudApi();
      const result = await api.loginWithGoogleCredential(idToken, accessToken);

      // 5. Mostrar avatar e iniciar cache INMEDIATAMENTE con los datos que ya tenemos
      const quickUser = result?.profile || result?.user;
      if (quickUser) {
        state.user = quickUser;
        storage.set("zenwii_cached_user", state.user); // Cachear sesión al instante
        renderAccount();
        setSyncState("syncing", "Sincronizando");
        if (quickUser.tema) applyTheme(quickUser.tema);
      }

      // 6. Si es usuario nuevo, auto-crear perfil con datos de Google
      if (result?.needsProfile && result?.user) {
        const profile = await api.autoCreateGoogleProfile(result.user);
        state.user = profile || result.user;
        renderAccount();
      }

      // 7. Sincronizar notas en segundo plano — si falla no bloquea la UI
      notify("¡Bienvenido a Zenwii! Sesión iniciada con Google.", "success");
      setSignedProfile(api, state.user).catch((err) => {
        console.warn("[sync-bg]", err);
        setSyncState(navigator.onLine ? "local" : "offline");
      });

    } else {
      // Fallback navegador (dev)
      const api = await loadCloudApi();
      const result = await api.loginGoogleFlow();
      const quickUser = result?.profile || result?.user;
      if (quickUser) {
        state.user = quickUser;
        renderAccount();
        setSyncState("syncing", "Sincronizando");
        if (quickUser.tema) applyTheme(quickUser.tema);
      }
      if (result?.needsProfile && result?.user) {
        const profile = await api.autoCreateGoogleProfile(result.user);
        state.user = profile || result.user;
        renderAccount();
      }
      notify("¡Bienvenido a Zenwii!", "success");
      setSignedProfile(api, state.user).catch((err) => {
        console.warn("[sync-bg]", err);
        setSyncState(navigator.onLine ? "local" : "offline");
      });
    }

  } catch (error) {
    console.error("[auth-google]", error);
    setSyncState(navigator.onLine ? "local" : "offline");
    notify(error.message || "No se pudo iniciar sesión con Google.", "error", 4200);
  } finally {
    // Siempre restaurar el botón al estado original correcto
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = ORIGINAL_LABEL;
    }
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function rgbToHex(rgb) {
  const parts = rgb.match(/\d+/g)?.slice(0, 3).map(Number) || [255, 218, 52];
  return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function renderBootError(error) {
  console.error("[boot]", error);
  document.getElementById("app").innerHTML = `
    <main class="boot-error">
      <div class="brand"><div class="brand-mark">Z</div><span>${app}</span></div>
      <h1>No pude abrir el editor</h1>
      <p>${escapeHtml(error?.message || "Error inesperado al iniciar la app.")}</p>
      <button class="primary-btn" onclick="location.reload()">Reintentar</button>
    </main>
  `;
}

try {
  renderApp();
  scheduleCloudBoot();
} catch (error) {
  renderBootError(error);
}
