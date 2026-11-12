/*! nathchatrestsdk 1.0.0 | MIT | Browser-only NathChat widget */

const NS = "nathchat";
const PROTOCOL_VERSION = 1;
const DEFAULT_BASE_URL = "https://chat.nathbrok.com"; // verify this is your NathChat origin
const EMBED_PATH = "/sdk/embed/";
const MARGIN = 8;
const ICON_SIZE = 56;
const DRAG_THRESHOLD = 5;
const READY_TIMEOUT_MS = 15000;
const STORAGE_KEY = "nathchat-sdk:ui";
const FULLSCREEN_MAX_WIDTH = 480;
const INBOUND = new Set(["ready", "login", "logout", "unread", "unlocked", "collapse", "error"]);
const EVENTS = new Set(["ready", "login", "logout", "unread", "unlocked", "expand", "collapse", "error"]);

export const version = "1.0.0";

/* ---------- pure helpers (exported for tests) ---------- */

/** Validate the NathChat base URL and return its origin. HTTPS only. */
export function resolveOrigin(baseUrl, { allowedOrigins, allowInsecureLocalhost = false } = {}) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("nathchatrestsdk: baseUrl is not a valid URL.");
  }
  if (url.username || url.password) {
    throw new Error("nathchatrestsdk: baseUrl must not contain credentials.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const httpsOk = url.protocol === "https:";
  const localHttpOk = allowInsecureLocalhost && local && url.protocol === "http:";
  if (!httpsOk && !localHttpOk) {
    throw new Error("nathchatrestsdk: baseUrl must use https.");
  }
  if (Array.isArray(allowedOrigins) && !allowedOrigins.includes(url.origin)) {
    throw new Error("nathchatrestsdk: baseUrl origin is not in allowedOrigins.");
  }
  return url.origin;
}

export function clampPosition(x, y, w, h, vw, vh, margin = MARGIN) {
  const maxX = Math.max(margin, vw - w - margin);
  const maxY = Math.max(margin, vh - h - margin);
  return { x: Math.min(Math.max(x, margin), maxX), y: Math.min(Math.max(y, margin), maxY) };
}

/** Resize a box while keeping the screen corner it is closest to fixed. */
export function resizeKeepingCorner(rect, newW, newH, vw, vh) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const x = cx > vw / 2 ? rect.x + rect.w - newW : rect.x;
  const y = cy > vh / 2 ? rect.y + rect.h - newH : rect.y;
  return clampPosition(x, y, newW, newH, vw, vh);
}

/** Strictly validate and copy a message from the embed. Unknown fields are dropped. */
export function parseMessage(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (data.ns !== NS || data.v !== PROTOCOL_VERSION) return null;
  if (typeof data.type !== "string" || !INBOUND.has(data.type)) return null;
  switch (data.type) {
    case "login": {
      const n = data.nathlink;
      // eslint-disable-next-line no-control-regex
      if (typeof n !== "string" || n.length < 1 || n.length > 64 || /[\u0000-\u001f\u007f]/.test(n)) return null;
      return { type: "login", nathlink: n };
    }
    case "unread": {
      const c = data.count;
      if (!Number.isInteger(c) || c < 0 || c > 9999) return null;
      return { type: "unread", count: c };
    }
    case "unlocked": {
      const c = data.count;
      if (!Number.isInteger(c) || c < 0 || c > 9999) return null;
      return { type: "unlocked", count: c };
    }
    case "error": {
      const code = typeof data.code === "string" ? data.code.slice(0, 40).replace(/[^\w.-]/g, "") : "";
      return { type: "error", code: code || "unknown" };
    }
    default:
      return { type: data.type };
  }
}

/* ---------- styles (adopted stylesheet: no inline <style> needed under strict CSP) ---------- */

const CSS = `
:host{all:initial;position:fixed;display:block;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
.panel{width:var(--nc-w,360px);height:var(--nc-h,560px);display:flex;flex-direction:column;background:#fff;color:#1f1d1a;border:1px solid #d8d2c4;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden}
.header{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#3d3830;color:#f5efe0;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.header:active{cursor:grabbing}
.title{font-weight:650}
.origin{margin-left:auto;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:.85}
.btn{appearance:none;border:0;border-radius:6px;background:rgba(255,255,255,.12);color:inherit;width:28px;height:28px;font:inherit;line-height:1;cursor:pointer}
.btn:hover{background:rgba(255,255,255,.22)}
.body{position:relative;flex:1;min-height:0;background:#fff}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}
.status{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;background:#fff;color:#3d3830;text-align:center}
.retry{appearance:none;border:2px solid #c9a84c;background:#fff;color:#3d3830;border-radius:8px;padding:6px 14px;font:inherit;cursor:pointer}
.icon{position:relative;width:56px;height:56px;display:grid;place-items:center;padding:0;border:2px solid #c9a84c;border-radius:50%;background:#3d3830;color:#c9a84c;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.icon:active{cursor:grabbing}
.icon svg{width:26px;height:26px;fill:currentColor;pointer-events:none}
.badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#b3261e;color:#fff;font-size:11px;font-weight:700;line-height:20px;text-align:center}
:focus-visible{outline:3px solid #c9a84c;outline-offset:2px}
@media (max-width:${FULLSCREEN_MAX_WIDTH}px){
  :host(.nc-expanded){inset:0!important;width:100%!important;height:100%!important}
  :host(.nc-expanded) .panel{width:100%;height:100%;border-radius:0;border:0}
}
@media (prefers-reduced-motion:no-preference){.panel,.icon{animation:nc-in .12s ease-out}}
@keyframes nc-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
`;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

function chatIcon() {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", "M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z");
  svg.appendChild(path);
  return svg;
}

/* ---------- widget ---------- */

export class NathChatWidget {
  #o;
  #origin;
  #host;
  #shadow;
  #styleSheet = null;
  #styleElement = null;
  #panel;
  #header;
  #collapseBtn;
  #icon;
  #badge;
  #body;
  #status;
  #statusText;
  #retry;
  #iframe = null;
  #src = "";
  #listeners = new Map();
  #collapsed;
  #pos = { x: 0, y: 0 };
  #ready = false;
  #loggedIn = false;
  #nathlink = null;
  #unread = 0;
  #timer = null;
  #destroyed = false;
  #onMessage;
  #onResize;

  constructor(options = {}) {
    if (typeof window === "undefined" || typeof document === "undefined") {
      throw new Error("nathchatrestsdk runs in the browser only.");
    }
    this.#o = {
      baseUrl: DEFAULT_BASE_URL,
      allowedOrigins: undefined,
      allowInsecureLocalhost: false,
      clientId: "",
      container: document.body,
      width: 360,
      height: 560,
      startCollapsed: true,
      lazy: true,
      rememberUi: true,
      permissions: "clipboard-write",
      title: "NathChat",
      locale: "",
      theme: "auto",
      nonce: "",
      zIndex: 2147483000,
      offset: 24,
      ...options,
    };
    const o = this.#o;
    if (!o.container || typeof o.container.appendChild !== "function") {
      throw new Error("nathchatrestsdk: container must be a DOM element.");
    }
    if (!Number.isFinite(o.width) || !Number.isFinite(o.height) || o.width < 280 || o.height < 360) {
      throw new Error("nathchatrestsdk: width must be >= 280 and height must be >= 360.");
    }
    if (!Number.isFinite(o.offset) || o.offset < 0 || !Number.isFinite(o.zIndex)) {
      throw new Error("nathchatrestsdk: offset must be non-negative and zIndex must be finite.");
    }
    if (typeof o.clientId !== "string" || o.clientId.length > 256) {
      throw new Error("nathchatrestsdk: clientId must be a string of at most 256 characters.");
    }
    this.#origin = resolveOrigin(o.baseUrl, o);
    if (!(o.width >= 280 && o.height >= 360)) {
      throw new Error("nathchatrestsdk: width must be >= 280 and height >= 360.");
    }
    this.#collapsed = !!o.startCollapsed;

    this.#build();
    const saved = this.#restore();
    if (saved) {
      this.#collapsed = saved.collapsed;
      this.#pos = { x: saved.x, y: saved.y };
    } else {
      const { w, h } = this.#size();
      this.#pos = { x: window.innerWidth - w - o.offset, y: window.innerHeight - h - o.offset };
    }
    this.#apply();
    if (!this.#collapsed || !o.lazy) this.#ensureFrame();

    this.#onMessage = (ev) => this.#handleMessage(ev);
    this.#onResize = () => this.#apply();
    window.addEventListener("message", this.#onMessage);
    window.addEventListener("resize", this.#onResize);
  }

  /* --- public API --- */

  get destroyed() {
    return this.#destroyed;
  }

  on(event, fn) {
    if (!EVENTS.has(event)) throw new Error(`nathchatrestsdk: unknown event "${event}".`);
    if (typeof fn !== "function") throw new Error("nathchatrestsdk: listener must be a function.");
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(fn);
    return () => this.#listeners.get(event)?.delete(fn);
  }

  expand() {
    if (this.#destroyed || !this.#collapsed) return;
    const from = { x: this.#pos.x, y: this.#pos.y, w: ICON_SIZE, h: ICON_SIZE };
    this.#collapsed = false;
    const { w, h } = this.#size();
    this.#pos = resizeKeepingCorner(from, w, h, window.innerWidth, window.innerHeight);
    this.#apply();
    this.#ensureFrame();
    this.#persist();
    this.#emit("expand");
    this.#collapseBtn.focus();
  }

  collapse() {
    if (this.#destroyed || this.#collapsed) return;
    const { w, h } = this.#size();
    const from = { x: this.#pos.x, y: this.#pos.y, w, h };
    this.#collapsed = true;
    this.#pos = resizeKeepingCorner(from, ICON_SIZE, ICON_SIZE, window.innerWidth, window.innerHeight);
    this.#apply();
    this.#persist();
    this.#emit("collapse");
    this.#icon.focus();
  }

  toggle() {
    if (this.#collapsed) this.expand();
    else this.collapse();
  }

  moveTo(x, y) {
    if (this.#destroyed || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.#pos = { x, y };
    this.#apply();
    this.#persist();
  }

  /** Ask the embed to sign the user out. The SDK never holds credentials or tokens. */
  logout() {
    this.#post("command", { name: "logout" });
  }

  getState() {
    return {
      collapsed: this.#collapsed,
      ready: this.#ready,
      loggedIn: this.#loggedIn,
      nathlink: this.#nathlink,
      unread: this.#unread,
      position: { ...this.#pos },
    };
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    window.removeEventListener("message", this.#onMessage);
    window.removeEventListener("resize", this.#onResize);
    clearTimeout(this.#timer);
    this.#host.remove();
    this.#listeners.clear();
  }

  /* --- internals --- */

  #build() {
    const o = this.#o;
    this.#host = el("div", { "data-nathchat-widget": "" });
    this.#shadow = this.#host.attachShadow({ mode: "open" });

    if (
      "adoptedStyleSheets" in this.#shadow &&
      typeof CSSStyleSheet !== "undefined" &&
      "replaceSync" in CSSStyleSheet.prototype
    ) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      this.#shadow.adoptedStyleSheets = [sheet];
      this.#styleSheet = sheet;
    } else {
      const style = el("style");
      if (o.nonce) style.setAttribute("nonce", o.nonce);
      style.textContent = CSS;
      this.#shadow.appendChild(style);
      this.#styleElement = style;
    }

    // Collapsed state: draggable icon
    this.#badge = el("span", { class: "badge", "aria-live": "polite" });
    this.#badge.hidden = true;
    this.#icon = el(
      "button",
      { class: "icon", type: "button", "aria-label": `Open ${o.title}`, "aria-expanded": "false" },
      [chatIcon(), this.#badge]
    );
    this.#icon.addEventListener("click", (e) => {
      if (e.detail === 0) this.expand(); // keyboard activation; pointer taps are handled by the drag logic
    });
    this.#bindDrag(this.#icon, () => this.expand());

    // Expanded state: draggable header + iframe body
    this.#collapseBtn = el("button", {
      class: "btn",
      type: "button",
      "aria-label": `Minimise ${o.title}`,
      text: "\u2013",
    });
    this.#collapseBtn.addEventListener("click", () => this.collapse());
    const host = new URL(this.#origin).host;
    this.#header = el(
      "div",
      { class: "header", tabindex: "0", "aria-label": `${o.title} window. Drag to move, or use arrow keys.` },
      [
        el("span", { class: "title", text: o.title }),
        el("span", { class: "origin", text: host, title: `Signing in on ${host}` }),
        this.#collapseBtn,
      ]
    );
    this.#bindDrag(this.#header, null);
    this.#header.addEventListener("keydown", (e) => this.#onHeaderKey(e));

    this.#statusText = el("div", { text: "Connecting\u2026" });
    this.#retry = el("button", { class: "retry", type: "button", text: "Try again" });
    this.#retry.hidden = true;
    this.#retry.addEventListener("click", () => this.#reloadFrame());
    this.#status = el("div", { class: "status", role: "status" }, [this.#statusText, this.#retry]);
    this.#body = el("div", { class: "body" }, [this.#status]);

    this.#panel = el("div", { class: "panel", role: "dialog", "aria-label": o.title }, [this.#header, this.#body]);
    this.#panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.collapse();
    });

    this.#shadow.append(this.#icon, this.#panel);
    o.container.appendChild(this.#host);
  }

  #size() {
    if (this.#collapsed) return { w: ICON_SIZE, h: ICON_SIZE };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw <= FULLSCREEN_MAX_WIDTH) return { w: vw, h: vh };
    return {
      w: Math.min(this.#o.width, vw - 2 * MARGIN),
      h: Math.min(this.#o.height, vh - 2 * MARGIN),
    };
  }

  #fullscreen() {
    return !this.#collapsed && window.innerWidth <= FULLSCREEN_MAX_WIDTH;
  }

  #apply() {
    const { w, h } = this.#size();
    const fs = this.#fullscreen();
    const p = fs
      ? { x: 0, y: 0 }
      : clampPosition(this.#pos.x, this.#pos.y, w, h, window.innerWidth, window.innerHeight);
    this.#pos = p;
    this.#host.classList.toggle("nc-expanded", !this.#collapsed);
    this.#panel.hidden = this.#collapsed;
    this.#icon.hidden = !this.#collapsed;
    this.#icon.setAttribute("aria-expanded", String(!this.#collapsed));
    const dynamic = `\n:host{z-index:${this.#o.zIndex};left:${p.x}px;top:${p.y}px;width:${w}px;height:${h}px;--nc-w:${w}px;--nc-h:${h}px}`;
    if (this.#styleSheet) this.#styleSheet.replaceSync(CSS + dynamic);
    else this.#styleElement.textContent = CSS + dynamic;
  }

  #persist() {
    if (!this.#o.rememberUi) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ x: this.#pos.x, y: this.#pos.y, collapsed: this.#collapsed })
      );
    } catch {
      /* storage unavailable: ignore */
    }
  }

  #restore() {
    if (!this.#o.rememberUi) return null;
    try {
      const v = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && typeof v.collapsed === "boolean") return v;
    } catch {
      /* ignore */
    }
    return null;
  }

  #bindDrag(handle, onTap) {
    let start = null;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest(".btn")) return;
      if (this.#fullscreen()) return;
      start = { px: e.clientX, py: e.clientY, x: this.#pos.x, y: this.#pos.y, moved: false, id: e.pointerId };
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    handle.addEventListener("pointermove", (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      start.moved = true;
      this.#pos = { x: start.x + dx, y: start.y + dy };
      this.#apply();
    });
    const finish = (e, cancelled) => {
      if (!start || e.pointerId !== start.id) return;
      const wasTap = !start.moved && !cancelled;
      const moved = start.moved;
      start = null;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (wasTap && onTap) onTap();
      else if (moved) this.#persist();
    };
    handle.addEventListener("pointerup", (e) => finish(e, false));
    handle.addEventListener("pointercancel", (e) => finish(e, true));
  }

  #onHeaderKey(e) {
    if (e.target !== this.#header) return;
    const step = e.shiftKey ? 50 : 10;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    this.moveTo(this.#pos.x + m[0], this.#pos.y + m[1]);
  }

  #frameUrl() {
    const u = new URL(EMBED_PATH, this.#origin);
    u.searchParams.set("v", String(PROTOCOL_VERSION));
    if (window.location.origin && window.location.origin !== "null") {
      u.searchParams.set("parent", window.location.origin);
    }
    if (this.#o.clientId) u.searchParams.set("client", this.#o.clientId);
    return u.href;
  }

  #ensureFrame() {
    if (this.#iframe) return;
    const f = document.createElement("iframe");
    f.title = `${this.#o.title} chat window`;
    // The login form and the chat live INSIDE this cross-origin frame, so the host page cannot read keystrokes.
    f.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation"
    );
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    f.setAttribute("allow", this.#o.permissions);
    this.#body.appendChild(f);
    this.#iframe = f;
    this.#src = this.#frameUrl();
    this.#startLoading();
  }

  #startLoading() {
    this.#ready = false;
    this.#status.hidden = false;
    this.#statusText.textContent = "Connecting\u2026";
    this.#retry.hidden = true;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#statusText.textContent = `Could not reach ${this.#o.title}.`;
      this.#retry.hidden = false;
      this.#emit("error", { code: "timeout" });
    }, READY_TIMEOUT_MS);
    this.#iframe.src = this.#src;
  }

  #reloadFrame() {
    if (this.#iframe) this.#startLoading();
  }

  #handleMessage(ev) {
    if (this.#destroyed || !this.#iframe) return;
    if (ev.origin !== this.#origin) return; // exact origin match
    if (ev.source !== this.#iframe.contentWindow) return; // and it must come from OUR frame
    const msg = parseMessage(ev.data);
    if (!msg) return;
    switch (msg.type) {
      case "ready":
        clearTimeout(this.#timer);
        this.#ready = true;
        this.#status.hidden = true;
        this.#post("init", { parentOrigin: window.location.origin, theme: this.#o.theme, locale: this.#o.locale });
        this.#emit("ready");
        break;
      case "login":
        this.#loggedIn = true;
        this.#nathlink = msg.nathlink;
        this.#emit("login", { nathlink: msg.nathlink });
        break;
      case "logout":
        this.#loggedIn = false;
        this.#nathlink = null;
        this.#setUnread(0);
        this.#emit("logout");
        break;
      case "unread":
        this.#setUnread(msg.count);
        this.#emit("unread", { count: msg.count });
        break;
      case "unlocked":
        this.#emit("unlocked", { count: msg.count });
        break;
      case "collapse":
        this.collapse();
        break;
      case "error":
        this.#emit("error", { code: msg.code });
        break;
    }
  }

  #setUnread(n) {
    this.#unread = n;
    this.#badge.hidden = n === 0;
    this.#badge.textContent = n > 99 ? "99+" : String(n);
  }

  #post(type, payload = {}) {
    if (!this.#ready || !this.#iframe || !this.#iframe.contentWindow) return;
    // Explicit target origin: never "*".
    this.#iframe.contentWindow.postMessage({ ns: NS, v: PROTOCOL_VERSION, type, ...payload }, this.#origin);
  }

  #emit(event, detail = {}) {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(detail);
      } catch (err) {
        // A faulty host callback must not break the widget.
        if (typeof console !== "undefined") console.error("nathchatrestsdk listener error:", err);
      }
    }
  }
}

/* ---------- singleton convenience ---------- */

let instance = null;

export function init(options) {
  if (instance && !instance.destroyed) {
    throw new Error("NathChat is already initialised. Use getInstance() or destroy() first.");
  }
  instance = new NathChatWidget(options);
  return instance;
}

export function getInstance() {
  return instance && !instance.destroyed ? instance : null;
}
