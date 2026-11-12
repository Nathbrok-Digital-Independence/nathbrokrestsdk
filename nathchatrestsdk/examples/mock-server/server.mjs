import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_USER, fakeDatabase } from "./fake-database.mjs";

const serverDir = fileURLToPath(new URL(".", import.meta.url));
const packageDir = resolve(serverDir, "../..");
const hostPagePath = resolve(packageDir, "examples", "index.html");
const embedPagePath = resolve(serverDir, "sdk", "embed", "index.html");
const bundlePath = resolve(packageDir, "dist", "nathchatrestsdk.min.js");
const hostPort = Number(process.env.HOST_PORT || 8080);
const mockPort = Number(process.env.MOCK_PORT || 8081);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function reply(response, status, body, contentType = "text/plain; charset=utf-8", headers = {}) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(body);
}

async function serveFile(response, path) {
  try {
    const body = await readFile(path);
    reply(response, 200, body, MIME_TYPES[extname(path)] || "application/octet-stream");
  } catch {
    reply(response, 404, "Not found");
  }
}

function localParentOrigin(value) {
  try {
    const url = new URL(value);
    if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname)) return null;
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const hostServer = createServer(async (request, response) => {
  const path = new URL(request.url || "/", `http://localhost:${hostPort}`).pathname;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return reply(response, 405, "Method not allowed");
  }
  if (path === "/healthz") {
    return reply(response, 200, JSON.stringify({ ok: true, service: "nathchat-sdk-demo-host" }), MIME_TYPES[".json"]);
  }
  if (path === "/demo-config.js") {
    return reply(response, 200, `window.NathChatDemoConfig = Object.freeze({ mockOrigin: "http://127.0.0.1:${mockPort}" });`, MIME_TYPES[".js"]);
  }
  if (path === "/" || path === "/examples/" || path === "/examples/index.html") {
    return serveFile(response, hostPagePath);
  }
  if (path === "/dist/nathchatrestsdk.min.js") {
    return serveFile(response, bundlePath);
  }
  return reply(response, 404, "Not found");
});

const mockServer = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://localhost:${mockPort}`);
  if (url.pathname.startsWith("/api/")) return handleMockApi(request, response, url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return reply(response, 405, "Method not allowed");
  }
  if (url.pathname === "/healthz") {
    return reply(response, 200, JSON.stringify({ ok: true, service: "nathchat-sdk-mock" }), MIME_TYPES[".json"]);
  }
  if (url.pathname !== "/sdk/embed" && url.pathname !== "/sdk/embed/") {
    return reply(response, 404, "Mock NathChat route not found. Open /sdk/embed/.");
  }

  const parent = localParentOrigin(url.searchParams.get("parent") || "");
  const frameAncestors = parent || "'none'";
  const client = url.searchParams.get("client") || "demo-success";
  if (client === "demo-server-error") {
    return reply(response, 503, "Mock scenario: simulated NathChat server outage.", "text/plain; charset=utf-8", {
      "Content-Security-Policy": `frame-ancestors ${frameAncestors}`,
    });
  }
  return serveFileWithHeaders(response, embedPagePath, {
    "Content-Security-Policy": `default-src 'self' 'unsafe-inline'; frame-ancestors ${frameAncestors}; base-uri 'none'; form-action 'none'`,
  });
});

async function serveFileWithHeaders(response, path, headers) {
  try {
    const body = await readFile(path);
    reply(response, 200, body, MIME_TYPES[extname(path)] || "application/octet-stream", headers);
  } catch {
    reply(response, 404, "Mock embed page is missing.", "text/plain; charset=utf-8", headers);
  }
}

function jsonReply(response, status, value, headers = {}) {
  reply(response, status, JSON.stringify(value), MIME_TYPES[".json"], headers);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error("Request body is too large.");
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error("Invalid JSON request body.");
  }
}

function requestSessionId(request) {
  const cookie = request.headers.cookie || "";
  const entry = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("nathchat_mock_session="));
  return entry ? entry.slice("nathchat_mock_session=".length) : "";
}

function sessionCookie(sessionId, expired = false) {
  return `nathchat_mock_session=${expired ? "" : sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expired ? 0 : 3600}`;
}

async function handleMockApi(request, response, url) {
  try {
    const sessionId = requestSessionId(request);
    const session = fakeDatabase.getSession(sessionId);
    if (url.pathname === "/api/login" && request.method === "POST") {
      fakeDatabase.logout(sessionId);
      const body = await readJson(request);
      const scenarios = new Set([
        "demo-success", "demo-2fa", "demo-access-denied", "demo-bad-unlock", "demo-bad-login",
      ]);
      const result = fakeDatabase.authenticate({
        email: body.email,
        password: body.password,
        scenario: scenarios.has(body.scenario) ? body.scenario : "demo-success",
      });
      if (result.error) return jsonReply(response, result.status, { error: result.error }, { "Set-Cookie": sessionCookie("", true) });
      if (result.requiresTwoFactor) {
        return jsonReply(response, 200, { requiresTwoFactor: true, challengeId: result.challengeId }, { "Set-Cookie": sessionCookie("", true) });
      }
      return jsonReply(response, 200, {
        user: { id: DEMO_USER.id, displayName: DEMO_USER.displayName, nathlink: DEMO_USER.nathlink },
      }, { "Set-Cookie": sessionCookie(result.sessionId) });
    }
    if (url.pathname === "/api/verify-2fa" && request.method === "POST") {
      const body = await readJson(request);
      const result = fakeDatabase.verifyTwoFactor(body.challengeId, body.code);
      if (result.error) return jsonReply(response, result.status, { error: result.error });
      return jsonReply(response, 200, {
        user: { id: DEMO_USER.id, displayName: DEMO_USER.displayName, nathlink: DEMO_USER.nathlink },
      }, { "Set-Cookie": sessionCookie(result.sessionId) });
    }
    if (url.pathname === "/api/unlock" && request.method === "POST") {
      const body = await readJson(request);
      const result = fakeDatabase.unlock(sessionId, body.passphrase);
      if (result.error) return jsonReply(response, result.status, { error: result.error });
      return jsonReply(response, 200, result);
    }
    if (url.pathname === "/api/rooms" && request.method === "GET") {
      const rooms = fakeDatabase.listRooms(session);
      if (!rooms) return jsonReply(response, 401, { error: "Sign in and unlock conversations first." });
      return jsonReply(response, 200, { rooms });
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(messages|read))?$/);
    if (roomMatch) {
      const roomId = decodeURIComponent(roomMatch[1]);
      const action = roomMatch[2];
      if (action === "messages" && request.method === "GET") {
        const messages = fakeDatabase.getMessages(session, roomId);
        if (messages === null) return jsonReply(response, 401, { error: "Sign in and unlock conversations first." });
        if (!messages) return jsonReply(response, 404, { error: "Room not found." });
        return jsonReply(response, 200, { messages });
      }
      if (action === "messages" && request.method === "POST") {
        const body = await readJson(request);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text || text.length > 4000) return jsonReply(response, 400, { error: "Message must contain 1 to 4000 characters." });
        const message = fakeDatabase.addMessage(session, roomId, text);
        if (message === null) return jsonReply(response, 401, { error: "Sign in and unlock conversations first." });
        if (!message) return jsonReply(response, 404, { error: "Room not found." });
        return jsonReply(response, 201, { message });
      }
      if (action === "read" && request.method === "POST") {
        const room = fakeDatabase.markRead(session, roomId);
        if (room === null) return jsonReply(response, 401, { error: "Sign in and unlock conversations first." });
        if (!room) return jsonReply(response, 404, { error: "Room not found." });
        return jsonReply(response, 200, { room });
      }
    }
    if (url.pathname === "/api/logout" && request.method === "POST") {
      fakeDatabase.logout(sessionId);
      return jsonReply(response, 200, { ok: true }, { "Set-Cookie": sessionCookie("", true) });
    }
    return jsonReply(response, 405, { error: "Unsupported mock API request." });
  } catch (error) {
    const status = error.message === "Invalid JSON request body." ? 400 : 413;
    return jsonReply(response, status, { error: error.message });
  }
}

function closeServer(server) {
  return new Promise((resolveClose) => {
    if (!server.listening) return resolveClose();
    server.close(() => resolveClose());
  });
}

function listen(server, port, label) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", rejectListen);
      console.log(`${label}: http://127.0.0.1:${port}`);
      resolveListen();
    });
  });
}

try {
  await Promise.all([
    listen(hostServer, hostPort, "Demo host"),
    listen(mockServer, mockPort, "Mock NathChat"),
  ]);
  console.log("Open the demo host above. Demo credentials are shown on that page; never enter real credentials.");
  console.log("Health checks: /healthz on either port. Press Ctrl+C to stop both servers.");
} catch (error) {
  console.error(`Could not start the SDK demo: ${error.message}`);
  await Promise.all([closeServer(hostServer), closeServer(mockServer)]);
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    Promise.all([closeServer(hostServer), closeServer(mockServer)]).then(() => process.exit(0));
  });
}
