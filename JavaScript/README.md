# Nathbrok REST SDK for JavaScript

The JavaScript SDK is for **server-side Node.js integrations**. It is not a
browser SDK. Keep Server credentials, chat passphrases, and all SDK calls on
your backend; never bundle them into client-side code.

## Requirements

- Node.js 20 or later
- An institution account with a registered Server and its Access key ID,
  one-time Access key, and signing secret

This package uses Node.js built-ins and has no runtime dependencies.

## Install

From this directory:

```shell
npm install
```

Or install the package from a local checkout:

```shell
npm install .\path\to\nathbrokrestsdk\javascript
```

## Authenticate

Put the registered Server credentials in environment variables or a secret
manager. `initialize` makes a signed request and obtains the server's public
encryption key. SDK network methods are asynchronous and return promises.

```js
import { Auth } from "nathbrokrestsdk";

const auth = new Auth();
await auth.initialize(
  process.env.NATHBROK_ACCESS_KEY_ID,
  process.env.NATHBROK_ACCESS_KEY,
  process.env.NATHBROK_SECRET_KEY,
);
```

`Auth` accepts optional `baseUrl` and `timeout` (milliseconds) settings. HTTPS
is required except for localhost. API failures throw `NathbrokAPIError`, with
`statusCode` and `detail` properties.

## Service clients

Pass the initialized `Auth` instance to the clients:

```js
import { ChatClient, CloudClient, MailClient } from "nathbrokrestsdk";

const chat = new ChatClient(auth);
const cloud = new CloudClient(auth);
const mail = new MailClient(auth);

await mail.sendEmail(
  { subject: "Hello", body_text: "Sent with Nathbrok." },
  "sender@example.com",
  "recipient@example.com",
);

await cloud.uploadFile("your-bucket-id", "reports/summary.pdf", {
  folderId: 42, // optional
});

const room = await chat.createRoom(
  "Project discussion",
  ["colleague@nathlink"],
  process.env.NATHBROK_CHAT_PASSPHRASE,
  { user: auth.serverUser },
);
await chat.sendMessage(
  ["Hello from the SDK"],
  room.room_id,
  auth.serverUser,
  process.env.NATHBROK_CHAT_PASSPHRASE,
);
```

Chat room keys and message content are encrypted locally. The chat passphrase
is used only to unlock the sender's private key; it is not sent to Nathbrok.
`ChatClient` also provides `unlockRoom`, `encryptMessage`, `decryptMessage`,
`deleteMessage`, and `deleteRoom`. `CloudClient` supports bucket/file
operations, and `MailClient` supports plain-text and HTML messages.

`DDEClient` mirrors the Python SDK's DDE request methods. The current SDK API
does not register the DDE endpoints, so those calls will fail until server-side
DDE API support is available.

## Development

Run the built-in Node.js tests:

```shell
npm test
```
