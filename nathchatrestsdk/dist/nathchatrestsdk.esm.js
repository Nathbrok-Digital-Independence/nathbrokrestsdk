var __typeError = (msg) => {
  throw TypeError(msg);
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// src/index.js
var NS = "nathchat";
var PROTOCOL_VERSION = 1;
var DEFAULT_BASE_URL = "https://chat.nathbrok.com";
var EMBED_PATH = "/sdk/embed/";
var MARGIN = 8;
var ICON_SIZE = 56;
var DRAG_THRESHOLD = 5;
var READY_TIMEOUT_MS = 15e3;
var STORAGE_KEY = "nathchat-sdk:ui";
var FULLSCREEN_MAX_WIDTH = 480;
var INBOUND = /* @__PURE__ */ new Set(["ready", "login", "logout", "unread", "unlocked", "collapse", "error"]);
var EVENTS = /* @__PURE__ */ new Set(["ready", "login", "logout", "unread", "unlocked", "expand", "collapse", "error"]);
var version = "1.0.0";
function resolveOrigin(baseUrl, { allowedOrigins, allowInsecureLocalhost = false } = {}) {
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
function clampPosition(x, y, w, h, vw, vh, margin = MARGIN) {
  const maxX = Math.max(margin, vw - w - margin);
  const maxY = Math.max(margin, vh - h - margin);
  return { x: Math.min(Math.max(x, margin), maxX), y: Math.min(Math.max(y, margin), maxY) };
}
function resizeKeepingCorner(rect, newW, newH, vw, vh) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const x = cx > vw / 2 ? rect.x + rect.w - newW : rect.x;
  const y = cy > vh / 2 ? rect.y + rect.h - newH : rect.y;
  return clampPosition(x, y, newW, newH, vw, vh);
}
function parseMessage(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (data.ns !== NS || data.v !== PROTOCOL_VERSION) return null;
  if (typeof data.type !== "string" || !INBOUND.has(data.type)) return null;
  switch (data.type) {
    case "login": {
      const n = data.nathlink;
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
var CSS = `
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
var _o, _origin, _host, _shadow, _styleSheet, _styleElement, _panel, _header, _collapseBtn, _icon, _badge, _body, _status, _statusText, _retry, _iframe, _src, _listeners, _collapsed, _pos, _ready, _loggedIn, _nathlink, _unread, _timer, _destroyed, _onMessage, _onResize, _NathChatWidget_instances, build_fn, size_fn, fullscreen_fn, apply_fn, persist_fn, restore_fn, bindDrag_fn, onHeaderKey_fn, frameUrl_fn, ensureFrame_fn, startLoading_fn, reloadFrame_fn, handleMessage_fn, setUnread_fn, post_fn, emit_fn;
var NathChatWidget = class {
  constructor(options = {}) {
    __privateAdd(this, _NathChatWidget_instances);
    __privateAdd(this, _o);
    __privateAdd(this, _origin);
    __privateAdd(this, _host);
    __privateAdd(this, _shadow);
    __privateAdd(this, _styleSheet, null);
    __privateAdd(this, _styleElement, null);
    __privateAdd(this, _panel);
    __privateAdd(this, _header);
    __privateAdd(this, _collapseBtn);
    __privateAdd(this, _icon);
    __privateAdd(this, _badge);
    __privateAdd(this, _body);
    __privateAdd(this, _status);
    __privateAdd(this, _statusText);
    __privateAdd(this, _retry);
    __privateAdd(this, _iframe, null);
    __privateAdd(this, _src, "");
    __privateAdd(this, _listeners, /* @__PURE__ */ new Map());
    __privateAdd(this, _collapsed);
    __privateAdd(this, _pos, { x: 0, y: 0 });
    __privateAdd(this, _ready, false);
    __privateAdd(this, _loggedIn, false);
    __privateAdd(this, _nathlink, null);
    __privateAdd(this, _unread, 0);
    __privateAdd(this, _timer, null);
    __privateAdd(this, _destroyed, false);
    __privateAdd(this, _onMessage);
    __privateAdd(this, _onResize);
    if (typeof window === "undefined" || typeof document === "undefined") {
      throw new Error("nathchatrestsdk runs in the browser only.");
    }
    __privateSet(this, _o, {
      baseUrl: DEFAULT_BASE_URL,
      allowedOrigins: void 0,
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
      zIndex: 2147483e3,
      offset: 24,
      ...options
    });
    const o = __privateGet(this, _o);
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
    __privateSet(this, _origin, resolveOrigin(o.baseUrl, o));
    if (!(o.width >= 280 && o.height >= 360)) {
      throw new Error("nathchatrestsdk: width must be >= 280 and height >= 360.");
    }
    __privateSet(this, _collapsed, !!o.startCollapsed);
    __privateMethod(this, _NathChatWidget_instances, build_fn).call(this);
    const saved = __privateMethod(this, _NathChatWidget_instances, restore_fn).call(this);
    if (saved) {
      __privateSet(this, _collapsed, saved.collapsed);
      __privateSet(this, _pos, { x: saved.x, y: saved.y });
    } else {
      const { w, h } = __privateMethod(this, _NathChatWidget_instances, size_fn).call(this);
      __privateSet(this, _pos, { x: window.innerWidth - w - o.offset, y: window.innerHeight - h - o.offset });
    }
    __privateMethod(this, _NathChatWidget_instances, apply_fn).call(this);
    if (!__privateGet(this, _collapsed) || !o.lazy) __privateMethod(this, _NathChatWidget_instances, ensureFrame_fn).call(this);
    __privateSet(this, _onMessage, (ev) => __privateMethod(this, _NathChatWidget_instances, handleMessage_fn).call(this, ev));
    __privateSet(this, _onResize, () => __privateMethod(this, _NathChatWidget_instances, apply_fn).call(this));
    window.addEventListener("message", __privateGet(this, _onMessage));
    window.addEventListener("resize", __privateGet(this, _onResize));
  }
  /* --- public API --- */
  get destroyed() {
    return __privateGet(this, _destroyed);
  }
  on(event, fn) {
    if (!EVENTS.has(event)) throw new Error(`nathchatrestsdk: unknown event "${event}".`);
    if (typeof fn !== "function") throw new Error("nathchatrestsdk: listener must be a function.");
    if (!__privateGet(this, _listeners).has(event)) __privateGet(this, _listeners).set(event, /* @__PURE__ */ new Set());
    __privateGet(this, _listeners).get(event).add(fn);
    return () => __privateGet(this, _listeners).get(event)?.delete(fn);
  }
  expand() {
    if (__privateGet(this, _destroyed) || !__privateGet(this, _collapsed)) return;
    const from = { x: __privateGet(this, _pos).x, y: __privateGet(this, _pos).y, w: ICON_SIZE, h: ICON_SIZE };
    __privateSet(this, _collapsed, false);
    const { w, h } = __privateMethod(this, _NathChatWidget_instances, size_fn).call(this);
    __privateSet(this, _pos, resizeKeepingCorner(from, w, h, window.innerWidth, window.innerHeight));
    __privateMethod(this, _NathChatWidget_instances, apply_fn).call(this);
    __privateMethod(this, _NathChatWidget_instances, ensureFrame_fn).call(this);
    __privateMethod(this, _NathChatWidget_instances, persist_fn).call(this);
    __privateMethod(this, _NathChatWidget_instances, emit_fn).call(this, "expand");
    __privateGet(this, _collapseBtn).focus();
  }
  collapse() {
    if (__privateGet(this, _destroyed) || __privateGet(this, _collapsed)) return;
    const { w, h } = __privateMethod(this, _NathChatWidget_instances, size_fn).call(this);
    const from = { x: __privateGet(this, _pos).x, y: __privateGet(this, _pos).y, w, h };
    __privateSet(this, _collapsed, true);
    __privateSet(this, _pos, resizeKeepingCorner(from, ICON_SIZE, ICON_SIZE, window.innerWidth, window.innerHeight));
    __privateMethod(this, _NathChatWidget_instances, apply_fn).call(this);
    __privateMethod(this, _NathChatWidget_instances, persist_fn).call(this);
    __privateMethod(this, _NathChatWidget_instances, emit_fn).call(this, "collapse");
    __privateGet(this, _icon).focus();
  }
  toggle() {
    if (__privateGet(this, _collapsed)) this.expand();
    else this.collapse();
  }
  moveTo(x, y) {
    if (__privateGet(this, _destroyed) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    __privateSet(this, _pos, { x, y });
    __privateMethod(this, _NathChatWidget_instances, apply_fn).call(this);
    __privateMethod(this, _NathChatWidget_instances, persist_fn).call(this);
  }
  /** Ask the embed to sign the user out. The SDK never holds credentials or tokens. */
  logout() {
    __privateMethod(this, _NathChatWidget_instances, post_fn).call(this, "command", { name: "logout" });
  }
  getState() {
    return {
      collapsed: __privateGet(this, _collapsed),
      ready: __privateGet(this, _ready),
      loggedIn: __privateGet(this, _loggedIn),
      nathlink: __privateGet(this, _nathlink),
      unread: __privateGet(this, _unread),
      position: { ...__privateGet(this, _pos) }
    };
  }
  destroy() {
    if (__privateGet(this, _destroyed)) return;
    __privateSet(this, _destroyed, true);
    window.removeEventListener("message", __privateGet(this, _onMessage));
    window.removeEventListener("resize", __privateGet(this, _onResize));
    clearTimeout(__privateGet(this, _timer));
    __privateGet(this, _host).remove();
    __privateGet(this, _listeners).clear();
  }
};
_o = new WeakMap();
_origin = new WeakMap();
_host = new WeakMap();
_shadow = new WeakMap();
_styleSheet = new WeakMap();
_styleElement = new WeakMap();
_panel = new WeakMap();
_header = new WeakMap();
_collapseBtn = new WeakMap();
_icon = new WeakMap();
_badge = new WeakMap();
_body = new WeakMap();
_status = new WeakMap();
_statusText = new WeakMap();
_retry = new WeakMap();
_iframe = new WeakMap();
_src = new WeakMap();
_listeners = new WeakMap();
_collapsed = new WeakMap();
_pos = new WeakMap();
_ready = new WeakMap();
_loggedIn = new WeakMap();
_nathlink = new WeakMap();
_unread = new WeakMap();
_timer = new WeakMap();
_destroyed = new WeakMap();
_onMessage = new WeakMap();
_onResize = new WeakMap();
_NathChatWidget_instances = new WeakSet();
/* --- internals --- */
build_fn = function() {
  const o = __privateGet(this, _o);
  __privateSet(this, _host, el("div", { "data-nathchat-widget": "" }));
  __privateSet(this, _shadow, __privateGet(this, _host).attachShadow({ mode: "open" }));
  if ("adoptedStyleSheets" in __privateGet(this, _shadow) && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    __privateGet(this, _shadow).adoptedStyleSheets = [sheet];
    __privateSet(this, _styleSheet, sheet);
  } else {
    const style = el("style");
    if (o.nonce) style.setAttribute("nonce", o.nonce);
    style.textContent = CSS;
    __privateGet(this, _shadow).appendChild(style);
    __privateSet(this, _styleElement, style);
  }
  __privateSet(this, _badge, el("span", { class: "badge", "aria-live": "polite" }));
  __privateGet(this, _badge).hidden = true;
  __privateSet(this, _icon, el(
    "button",
    { class: "icon", type: "button", "aria-label": `Open ${o.title}`, "aria-expanded": "false" },
    [chatIcon(), __privateGet(this, _badge)]
  ));
  __privateGet(this, _icon).addEventListener("click", (e) => {
    if (e.detail === 0) this.expand();
  });
  __privateMethod(this, _NathChatWidget_instances, bindDrag_fn).call(this, __privateGet(this, _icon), () => this.expand());
  __privateSet(this, _collapseBtn, el("button", {
    class: "btn",
    type: "button",
    "aria-label": `Minimise ${o.title}`,
    text: "\u2013"
  }));
  __privateGet(this, _collapseBtn).addEventListener("click", () => this.collapse());
  const host = new URL(__privateGet(this, _origin)).host;
  __privateSet(this, _header, el(
    "div",
    { class: "header", tabindex: "0", "aria-label": `${o.title} window. Drag to move, or use arrow keys.` },
    [
      el("span", { class: "title", text: o.title }),
      el("span", { class: "origin", text: host, title: `Signing in on ${host}` }),
      __privateGet(this, _collapseBtn)
    ]
  ));
  __privateMethod(this, _NathChatWidget_instances, bindDrag_fn).call(this, __privateGet(this, _header), null);
  __privateGet(this, _header).addEventListener("keydown", (e) => __privateMethod(this, _NathChatWidget_instances, onHeaderKey_fn).call(this, e));
  __privateSet(this, _statusText, el("div", { text: "Connecting\u2026" }));
  __privateSet(this, _retry, el("button", { class: "retry", type: "button", text: "Try again" }));
  __privateGet(this, _retry).hidden = true;
  __privateGet(this, _retry).addEventListener("click", () => __privateMethod(this, _NathChatWidget_instances, reloadFrame_fn).call(this));
  __privateSet(this, _status, el("div", { class: "status", role: "status" }, [__privateGet(this, _statusText), __privateGet(this, _retry)]));
  __privateSet(this, _body, el("div", { class: "body" }, [__privateGet(this, _status)]));
  __privateSet(this, _panel, el("div", { class: "panel", role: "dialog", "aria-label": o.title }, [__privateGet(this, _header), __privateGet(this, _body)]));
  __privateGet(this, _panel).addEventListener("keydown", (e) => {
    if (e.key === "Escape") this.collapse();
  });
  __privateGet(this, _shadow).append(__privateGet(this, _icon), __privateGet(this, _panel));
  o.container.appendChild(__privateGet(this, _host));
};
size_fn = function() {
  if (__privateGet(this, _collapsed)) return { w: ICON_SIZE, h: ICON_SIZE };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw <= FULLSCREEN_MAX_WIDTH) return { w: vw, h: vh };
  return {
    w: Math.min(__privateGet(this, _o).width, vw - 2 * MARGIN),
    h: Math.min(__privateGet(this, _o).height, vh - 2 * MARGIN)
  };
};
fullscreen_fn = function() {
  return !__privateGet(this, _collapsed) && window.innerWidth <= FULLSCREEN_MAX_WIDTH;
};
apply_fn = function() {
  const { w, h } = __privateMethod(this, _NathChatWidget_instances, size_fn).call(this);
  const fs = __privateMethod(this, _NathChatWidget_instances, fullscreen_fn).call(this);
  const p = fs ? { x: 0, y: 0 } : clampPosition(__privateGet(this, _pos).x, __privateGet(this, _pos).y, w, h, window.innerWidth, window.innerHeight);
  __privateSet(this, _pos, p);
  __privateGet(this, _host).classList.toggle("nc-expanded", !__privateGet(this, _collapsed));
  __privateGet(this, _panel).hidden = __privateGet(this, _collapsed);
  __privateGet(this, _icon).hidden = !__privateGet(this, _collapsed);
  __privateGet(this, _icon).setAttribute("aria-expanded", String(!__privateGet(this, _collapsed)));
  const dynamic = `
:host{z-index:${__privateGet(this, _o).zIndex};left:${p.x}px;top:${p.y}px;width:${w}px;height:${h}px;--nc-w:${w}px;--nc-h:${h}px}`;
  if (__privateGet(this, _styleSheet)) __privateGet(this, _styleSheet).replaceSync(CSS + dynamic);
  else __privateGet(this, _styleElement).textContent = CSS + dynamic;
};
persist_fn = function() {
  if (!__privateGet(this, _o).rememberUi) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ x: __privateGet(this, _pos).x, y: __privateGet(this, _pos).y, collapsed: __privateGet(this, _collapsed) })
    );
  } catch {
  }
};
restore_fn = function() {
  if (!__privateGet(this, _o).rememberUi) return null;
  try {
    const v = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && typeof v.collapsed === "boolean") return v;
  } catch {
  }
  return null;
};
bindDrag_fn = function(handle, onTap) {
  let start = null;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== void 0 && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest(".btn")) return;
    if (__privateMethod(this, _NathChatWidget_instances, fullscreen_fn).call(this)) return;
    start = { px: e.clientX, py: e.clientY, x: __privateGet(this, _pos).x, y: __privateGet(this, _pos).y, moved: false, id: e.pointerId };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
    }
  });
  handle.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.px;
    const dy = e.clientY - start.py;
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    start.moved = true;
    __privateSet(this, _pos, { x: start.x + dx, y: start.y + dy });
    __privateMethod(this, _NathChatWidget_instances, apply_fn).call(this);
  });
  const finish = (e, cancelled) => {
    if (!start || e.pointerId !== start.id) return;
    const wasTap = !start.moved && !cancelled;
    const moved = start.moved;
    start = null;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {
    }
    if (wasTap && onTap) onTap();
    else if (moved) __privateMethod(this, _NathChatWidget_instances, persist_fn).call(this);
  };
  handle.addEventListener("pointerup", (e) => finish(e, false));
  handle.addEventListener("pointercancel", (e) => finish(e, true));
};
onHeaderKey_fn = function(e) {
  if (e.target !== __privateGet(this, _header)) return;
  const step = e.shiftKey ? 50 : 10;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const m = moves[e.key];
  if (!m) return;
  e.preventDefault();
  this.moveTo(__privateGet(this, _pos).x + m[0], __privateGet(this, _pos).y + m[1]);
};
frameUrl_fn = function() {
  const u = new URL(EMBED_PATH, __privateGet(this, _origin));
  u.searchParams.set("v", String(PROTOCOL_VERSION));
  if (window.location.origin && window.location.origin !== "null") {
    u.searchParams.set("parent", window.location.origin);
  }
  if (__privateGet(this, _o).clientId) u.searchParams.set("client", __privateGet(this, _o).clientId);
  return u.href;
};
ensureFrame_fn = function() {
  if (__privateGet(this, _iframe)) return;
  const f = document.createElement("iframe");
  f.title = `${__privateGet(this, _o).title} chat window`;
  f.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation"
  );
  f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  f.setAttribute("allow", __privateGet(this, _o).permissions);
  __privateGet(this, _body).appendChild(f);
  __privateSet(this, _iframe, f);
  __privateSet(this, _src, __privateMethod(this, _NathChatWidget_instances, frameUrl_fn).call(this));
  __privateMethod(this, _NathChatWidget_instances, startLoading_fn).call(this);
};
startLoading_fn = function() {
  __privateSet(this, _ready, false);
  __privateGet(this, _status).hidden = false;
  __privateGet(this, _statusText).textContent = "Connecting\u2026";
  __privateGet(this, _retry).hidden = true;
  clearTimeout(__privateGet(this, _timer));
  __privateSet(this, _timer, setTimeout(() => {
    __privateGet(this, _statusText).textContent = `Could not reach ${__privateGet(this, _o).title}.`;
    __privateGet(this, _retry).hidden = false;
    __privateMethod(this, _NathChatWidget_instances, emit_fn).call(this, "error", { code: "timeout" });
  }, READY_TIMEOUT_MS));
  __privateGet(this, _iframe).src = __privateGet(this, _src);
};
reloadFrame_fn = function() {
  if (__privateGet(this, _iframe)) __privateMethod(this, _NathChatWidget_instances, startLoading_fn).call(this);
};
handleMessage_fn = function(ev) {
  if (__privateGet(this, _destroyed) || !__privateGet(this, _iframe)) return;
  if (ev.origin !== __privateGet(this, _origin)) return;
  if (ev.source !== __privateGet(this, _iframe).contentWindow) return;
  const msg = parseMessage(ev.data);
  if (!msg) return;
  switch (msg.type) {
    case "ready":
      clearTimeout(__privateGet(this, _timer));
      __privateSet(this, _ready, true);
      __privateGet(this, _status).hidden = true;
      __privateMethod(this, _NathChatWidget_instances, post_fn).call(this, "init", { parentOrigin: window.location.origin, theme: __privateGet(this, _o).theme, locale: __privateGet(this, _o).locale });
      __privateMethod(this, _NathChatWidget_instances, emit_fn).call(this, "ready");
      break;
    case "login":
      __privateSet(this, _loggedIn, true);
      __privateSet(this, _nathlink, msg.nathlink);
      __privateMethod(this, _NathChatWidget_instances, emit_fn).call(this, "login", { nathlink: msg.nathlink });
      break;
    case "logout":
      __privateSet(this, _loggedIn, false);
      __privateSet(this, _nathlink, null);
      __privateMethod(this, _NathChatWidget_instances, setUnread_fn).call(this, 0);
      __privateMethod(this, _NathChatWidget_instances, emit_fn).call(this, "logout");
      break;
    case "unread":
      __privateMethod(this, _NathChatWidget_instances, setUnread_fn).call(this, msg.count);
      __privateMethod(this, _NathChatWidget_instances, emit_fn).call(this, "unread", { count: msg.count });
      break;
    case "unlocked":
      __privateMethod(this, _NathChatWidget_instances, emit_fn).call(this, "unlocked", { count: msg.count });
      break;
    case "collapse":
      this.collapse();
      break;
    case "error":
      __privateMethod(this, _NathChatWidget_instances, emit_fn).call(this, "error", { code: msg.code });
      break;
  }
};
setUnread_fn = function(n) {
  __privateSet(this, _unread, n);
  __privateGet(this, _badge).hidden = n === 0;
  __privateGet(this, _badge).textContent = n > 99 ? "99+" : String(n);
};
post_fn = function(type, payload = {}) {
  if (!__privateGet(this, _ready) || !__privateGet(this, _iframe) || !__privateGet(this, _iframe).contentWindow) return;
  __privateGet(this, _iframe).contentWindow.postMessage({ ns: NS, v: PROTOCOL_VERSION, type, ...payload }, __privateGet(this, _origin));
};
emit_fn = function(event, detail = {}) {
  const set = __privateGet(this, _listeners).get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(detail);
    } catch (err) {
      if (typeof console !== "undefined") console.error("nathchatrestsdk listener error:", err);
    }
  }
};
var instance = null;
function init(options) {
  if (instance && !instance.destroyed) {
    throw new Error("NathChat is already initialised. Use getInstance() or destroy() first.");
  }
  instance = new NathChatWidget(options);
  return instance;
}
function getInstance() {
  return instance && !instance.destroyed ? instance : null;
}
export {
  NathChatWidget,
  clampPosition,
  getInstance,
  init,
  parseMessage,
  resizeKeepingCorner,
  resolveOrigin,
  version
};
/*! nathchatrestsdk 1.0.0 | MIT | Browser-only NathChat widget */
