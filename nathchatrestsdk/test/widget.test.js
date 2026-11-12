import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

let dom;
let sdk;
const ORIGIN = "https://chat.example.test";

beforeEach(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://app.example.com/", pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  sdk = await import("../src/index.js?" + Math.random());
});

afterEach(() => {
  const w = sdk.getInstance();
  if (w) w.destroy();
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
});

const shadowOf = (w) => document.querySelector("[data-nathchat-widget]").shadowRoot;
const frameOf = () => document.querySelector("[data-nathchat-widget]").shadowRoot.querySelector("iframe");
const send = (data, { origin = ORIGIN, source } = {}) => {
  window.dispatchEvent(new window.MessageEvent("message", { data, origin, source: source ?? frameOf().contentWindow }));
};
const msg = (type, extra = {}) => ({ ns: "nathchat", v: 1, type, ...extra });

test("resolveOrigin enforces https, no credentials and the allowlist", () => {
  assert.equal(sdk.resolveOrigin("https://chat.example.test/x"), ORIGIN);
  assert.throws(() => sdk.resolveOrigin("http://chat.example.test"));
  assert.throws(() => sdk.resolveOrigin("https://user:pw@chat.example.test"));
  assert.throws(() => sdk.resolveOrigin("javascript:alert(1)"));
  assert.throws(() => sdk.resolveOrigin(ORIGIN, { allowedOrigins: ["https://other.test"] }));
  assert.equal(sdk.resolveOrigin("http://localhost:8000", { allowInsecureLocalhost: true }), "http://localhost:8000");
  assert.throws(() => sdk.resolveOrigin("http://localhost:8000"));
  assert.throws(() => sdk.resolveOrigin("http://evil.test", { allowInsecureLocalhost: true }));
});

test("parseMessage validates strictly and drops unknown or secret fields", () => {
  assert.deepEqual(sdk.parseMessage(msg("login", { nathlink: "ray@nathlink", secret: "hunter2", token: "t" })), {
    type: "login",
    nathlink: "ray@nathlink",
  });
  assert.equal(sdk.parseMessage({ ns: "other", v: 1, type: "ready" }), null);
  assert.equal(sdk.parseMessage({ ns: "nathchat", v: 2, type: "ready" }), null);
  assert.equal(sdk.parseMessage(msg("evil")), null);
  assert.equal(sdk.parseMessage(msg("login", { nathlink: "a".repeat(65) })), null);
  assert.equal(sdk.parseMessage(msg("login", { nathlink: "a\u0000b" })), null);
  assert.equal(sdk.parseMessage(msg("unread", { count: -1 })), null);
  assert.equal(sdk.parseMessage(msg("unread", { count: 1.5 })), null);
  assert.equal(sdk.parseMessage("string"), null);
  assert.equal(sdk.parseMessage(null), null);
  assert.equal(sdk.parseMessage([1]), null);
});

test("clampPosition keeps the box inside the viewport", () => {
  assert.deepEqual(sdk.clampPosition(-50, -50, 100, 100, 1000, 800), { x: 8, y: 8 });
  assert.deepEqual(sdk.clampPosition(2000, 2000, 100, 100, 1000, 800), { x: 892, y: 692 });
  assert.deepEqual(sdk.clampPosition(300, 300, 100, 100, 1000, 800), { x: 300, y: 300 });
});

test("resizeKeepingCorner anchors the nearest corner", () => {
  const r = sdk.resizeKeepingCorner({ x: 900, y: 700, w: 56, h: 56 }, 360, 560, 1024, 768);
  assert.equal(r.x + 360, 956 + 0); // right edge kept at 956
  assert.ok(r.y >= 8 && r.y + 560 <= 760);
});

test("starts collapsed, loads nothing until opened, and never renders credential inputs", () => {
  const w = sdk.init({ baseUrl: ORIGIN });
  assert.equal(frameOf(), null); // lazy: no third-party content yet
  assert.equal(w.getState().collapsed, true);
  w.expand();
  const f = frameOf();
  assert.ok(f.src.startsWith(ORIGIN + "/sdk/embed/?"));
  assert.match(f.getAttribute("sandbox"), /allow-forms/);
  assert.doesNotMatch(f.getAttribute("sandbox"), /allow-top-navigation/);
  assert.equal(shadowOf().querySelectorAll("input, textarea").length, 0);
  assert.equal(document.querySelectorAll("input, textarea").length, 0);
});

test("ignores messages from the wrong origin or the wrong source window", () => {
  const w = sdk.init({ baseUrl: ORIGIN });
  w.expand();
  const seen = [];
  w.on("login", (d) => seen.push(d));
  send(msg("login", { nathlink: "a@b" }), { origin: "https://evil.test" });
  send(msg("login", { nathlink: "a@b" }), { source: window });
  assert.equal(seen.length, 0);
  assert.equal(w.getState().loggedIn, false);
});

test("accepts a valid login, unread and logout from the NathChat frame", () => {
  const w = sdk.init({ baseUrl: ORIGIN });
  w.expand();
  const events = [];
  for (const e of ["ready", "login", "unread", "logout"]) w.on(e, (d) => events.push([e, d]));
  send(msg("ready"));
  send(msg("login", { nathlink: "ray@nathlink", password: "nope" }));
  send(msg("unread", { count: 120 }));
  assert.equal(w.getState().loggedIn, true);
  assert.equal(w.getState().nathlink, "ray@nathlink");
  assert.equal(shadowOf().querySelector(".badge").textContent, "99+");
  send(msg("logout"));
  assert.equal(w.getState().loggedIn, false);
  assert.equal(w.getState().unread, 0);
  assert.deepEqual(events.map((e) => e[0]), ["ready", "login", "unread", "logout"]);
  assert.deepEqual(events[1][1], { nathlink: "ray@nathlink" });
});

test("collapse and expand toggle state and fire events", () => {
  const w = sdk.init({ baseUrl: ORIGIN, startCollapsed: false });
  const seen = [];
  w.on("collapse", () => seen.push("collapse"));
  w.on("expand", () => seen.push("expand"));
  assert.equal(w.getState().collapsed, false);
  w.collapse();
  assert.equal(w.getState().collapsed, true);
  assert.equal(shadowOf().querySelector(".icon").hidden, false);
  assert.equal(shadowOf().querySelector(".panel").hidden, true);
  w.expand();
  assert.deepEqual(seen, ["collapse", "expand"]);
});

test("moveTo clamps, and position plus collapsed state persist (no secrets stored)", () => {
  const w = sdk.init({ baseUrl: ORIGIN });
  w.moveTo(-500, 99999);
  const p = w.getState().position;
  assert.ok(p.x >= 8 && p.y <= window.innerHeight);
  const saved = JSON.parse(window.localStorage.getItem("nathchat-sdk:ui"));
  assert.deepEqual(Object.keys(saved).sort(), ["collapsed", "x", "y"]);
  w.destroy();
  const w2 = sdk.init({ baseUrl: ORIGIN });
  assert.equal(w2.getState().position.x, p.x);
});

test("destroy removes the widget and stops listening", () => {
  const w = sdk.init({ baseUrl: ORIGIN });
  w.expand();
  const f = frameOf();
  w.destroy();
  assert.equal(document.querySelector("[data-nathchat-widget]"), null);
  const seen = [];
  w.on("login", (d) => seen.push(d));
  window.dispatchEvent(new window.MessageEvent("message", { data: msg("login", { nathlink: "a@b" }), origin: ORIGIN, source: f.contentWindow }));
  assert.equal(seen.length, 0);
});

test("init twice without destroy throws; unknown events are rejected", () => {
  const w = sdk.init({ baseUrl: ORIGIN });
  assert.throws(() => sdk.init({ baseUrl: ORIGIN }));
  assert.throws(() => w.on("password", () => {}));
});

test("keyboard activation of the icon expands the widget", () => {
  const w = sdk.init({ baseUrl: ORIGIN });
  shadowOf().querySelector(".icon").click(); // detail 0 = keyboard-style click
  assert.equal(w.getState().collapsed, false);
});
