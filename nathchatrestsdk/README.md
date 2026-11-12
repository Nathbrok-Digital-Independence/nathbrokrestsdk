# nathchatrestsdk (browser)

A floating NathChat window for websites: draggable, collapsible to an icon, with unread badge.
Users sign in with their **email and password**, then unlock conversation keys with their separate key passphrase.
Both steps happen **inside a frame served by NathChat**, never in your page.

The SDK receives the encrypted private-key bundle and room envelopes. Web Crypto unwraps the private key and decrypts the envelopes inside the frame; the passphrase and private key are never sent to the host page or server.

## Why the login is not in your page
If the host page rendered the login form, any script on that page (a compromised dependency, an analytics tag,
a malicious extension) could read the secret. So the SDK only creates a sandboxed, cross-origin iframe that points at
NathChat's own `/sdk/embed/` page. The widget header shows the NathChat host name so users can see where they type.
Your page never receives the secret or a session token: it only gets events (ready, login with the public
NathLink, logout, unread count).

## Install
```
npm install nathchatrestsdk
```
```js
import { init } from "nathchatrestsdk";
const chat = init({ baseUrl: "https://chat.nathbrok.com", clientId: "YOUR_CLIENT_ID" });
chat.on("login", ({ nathlink }) => console.log("signed in as", nathlink));
```
Script tag hosted by Nathbrok (place it near the end of the page body):
```html
<script src="https://nathbrok.com/nathchatrestsdk.js"></script>
<script>NathChat.init({ baseUrl: "https://chat.nathbrok.com", clientId: "YOUR_CLIENT_ID" });</script>
```

## Options
| Option | Default | Notes |
|---|---|---|
| `baseUrl` | `https://chat.nathbrok.com` | HTTPS only. Verify this is your NathChat origin. |
| `allowedOrigins` | none | If set, `baseUrl` must be listed (stops config tampering). |
| `clientId` | Required | Your registered integration id. The server checks its allowed parent origins. |
| `startCollapsed` | `true` | Starts as the icon. |
| `lazy` | `true` | The NathChat frame loads only when first opened. |
| `rememberUi` | `true` | Remembers position and collapsed state in localStorage. Never credentials. |
| `permissions` | `clipboard-write` | iframe `allow` list, e.g. `clipboard-write; microphone; camera` for calls. |
| `width` / `height` | 360 / 560 | Full screen at 480 px width or less. |
| `container`, `title`, `theme`, `locale`, `zIndex`, `offset`, `nonce` | | See `index.d.ts`; `nonce` authorizes the fallback style element on browsers without constructable stylesheets. |

Methods: `expand()`, `collapse()`, `toggle()`, `moveTo(x, y)`, `logout()`, `getState()`, `on(event, fn)` (returns an unsubscribe function), `destroy()`.
Events: `ready`, `login`, `logout`, `unread`, `unlocked` (with the decrypted envelope count), `expand`, `collapse`, `error`.
Keyboard: arrow keys move the focused header (Shift = bigger steps), Escape collapses, Enter/Space opens the icon.

## NathChat server embed route: `/sdk/embed/`
This SDK is only half of the feature. NathChat needs an embed route:
1. **Allow framing only by registered sites.** Return `Content-Security-Policy: frame-ancestors <registered origins>` (validate the origin against a registry and the format `^https://[a-z0-9.-]+(:\d+)?$` before putting it in a header; default `frame-ancestors 'none'`). Exempt this route from `X-Frame-Options: DENY`.
2. **Register each integration:** use the institution Server record's `access_key_id` as `clientId`. The server checks that the record and its institution are active and that the parent origin matches the origin in `Server.url`. Sign-in is allowed only for a NathChat contact whose administrator is the institution user that owns that Server.
3. **Cookies for a framed session:** each Server integration uses its own host-only, `Secure; HttpOnly; SameSite=None; Partitioned` session cookie, separate from Nathbrok's normal site session and other integrations. The CSRF token is stored in that SDK session.
4. **Login hardening:** CSRF, rate limiting and lockout per NathLink and IP, generic errors, passkey support if you have it, no secrets in URLs or logs.
5. **Message contract** (every message is `{ ns: "nathchat", v: 1, type, ... }`):
   - embed to host: `ready`, `login {nathlink}`, `logout`, `unread {count}`, `collapse`, `error {code}`. Send with an explicit target origin, never `"*"`.
   - host to embed: `init {parentOrigin, theme, locale}`, `command {name: "logout"}`.
   - The embed must check `event.origin` and `event.source === window.parent` on everything it receives, and take the host origin from a validated registry rather than trusting `?parent=` alone.
   - **Never send tokens, secrets or keys in a message.**
6. If the host needs to know *who* the user is, verify it on your server with `nathbrokrestsdk` (server side), not from the browser event, because a page can forge what it tells itself.

## Host page hardening
Allow the frame and SDK host in your page CSP: `frame-src https://chat.nathbrok.com; script-src 'self' https://nathbrok.com`.
The widget uses Shadow DOM and an adopted stylesheet, so it needs no inline styles under a strict CSP.

## Try it locally
```
npm install && npm run build
# terminal 1 (the mock "NathChat" at port 8081)
cd examples/mock-server && python3 -m http.server 8081
# terminal 2 (a host page at port 8080), from the project root
python3 -m http.server 8080
# open http://localhost:8080/examples/index.html
```
The mock embed is a stand-in that accepts any NathLink. It never checks a secret.

## Tests and publishing
`npm test` (12 tests: origin checks, message validation, sandbox attributes, no credential inputs in the host DOM, persistence, lifecycle).
Publish from CI with npm trusted publishing and `npm stage publish`, pinning actions to commit SHAs.

## Limits
Third-party cookies are being restricted by browsers, so test login persistence in Safari, Firefox and Chrome.
Background sign-in state in the widget depends on the embed page, not on this SDK.
