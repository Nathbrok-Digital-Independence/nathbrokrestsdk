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

Install the SDK in your Node.js backend project:

```shell
npm install nathbrokrestsdk
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

`DDEClient` provides server-side data and file encryption/decryption through
the SDK API. File responses include base64-encoded `content` and its output
`filename`. DDE uses the server's stable `DDE_MASTER_KEY` by default. To use
your own key, pass it as the second argument; the SDK sends it only inside an
authenticated encrypted request, and the server does not store it. Decryption
tries your supplied key first and then `DDE_MASTER_KEY`; if neither works, the
API returns an error.

```js
import { DDEClient } from "nathbrokrestsdk";

const dde = new DDEClient(auth);
const encrypted = await dde.encryptData(
  { account: "example" },
  process.env.DDE_KEY,
);
const decrypted = await dde.decryptData(encrypted, process.env.DDE_KEY);
```

Files are processed in memory by the server. The SDK leaves the local source
file unchanged, and the server does not keep a temporary output file.
