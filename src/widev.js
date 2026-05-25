import { defaultTheme } from "./wii.js";

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const debounce = (fn, wait = 400) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

export const uid = () => `wd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  remove(key) {
    localStorage.removeItem(key);
  },
};

export const textFromHtml = (html = "") => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
};

export const initial = (name = "U") => (name.trim()[0] || "U").toUpperCase();

export const formatDateTime = (value) => {
  if (!value) return "Ahora";
  const date = value?.toDate?.() || new Date(value);
  return date.toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export const relativeTime = (value) => {
  if (!value) return "Ahora";
  const time = value?.toDate?.()?.getTime?.() || new Date(value).getTime();
  const diff = Math.max(0, Date.now() - time);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Hace un momento";
  if (min < 60) return `Hace ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `Hace ${days}d`;
  return formatDateTime(time);
};

export function applyTheme(rawTheme = storage.get("zenwii_theme", defaultTheme)) {
  const [name, color] = String(rawTheme || defaultTheme).split("|");
  document.documentElement.dataset.theme = name || "Oro";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = color || "#FFDA34";
  storage.set("zenwii_theme", rawTheme || defaultTheme);
  $$(".theme-dot").forEach((dot) => dot.classList.toggle("active", dot.dataset.theme === name));
}

export function notify(message, type = "info", timeout = 2600) {
  let stack = $(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(16px)";
    setTimeout(() => toast.remove(), 180);
  }, timeout);
}

export function openModal(id) {
  const modal = document.getElementById(id);
  modal?.classList.add("active");
  setTimeout(() => modal?.querySelector("input, button")?.focus(), 30);
}

export function closeModal(id) {
  document.getElementById(id)?.classList.remove("active");
}

export function closeAllModals() {
  $$(".modal-backdrop.active").forEach((modal) => modal.classList.remove("active"));
}

document.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) closeAllModals();
  if (event.target.classList.contains("modal-backdrop")) event.target.classList.remove("active");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllModals();
});
