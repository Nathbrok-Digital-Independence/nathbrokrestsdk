import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  createHash,
  createHmac,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import test from "node:test";
import { Auth, ChatCryptoClient, NathbrokAPIError } from "../src/index.js";
import { MailClient } from "../src/mail.js";

const PAYLOAD_KEY_INFO = Buffer.from("nathbrok-sdk-payload-aes256gcm-v1");
const REQUEST_AAD = Buffer.from("nathbrok-sdk-encrypted-request-v1");
const RESPONSE_AAD = Buffer.from("nathbrok-sdk-encrypted-response-v1");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeB64url(value) {
  return Buffer.from(value, "base64url");
}

function decryptRequest(envelope, privateKey) {
  const ephemeralPublicKey = createPublicKey({
    key: Buffer.concat([
      X25519_SPKI_PREFIX,
      decodeB64url(envelope.ephemeral_public_key),
    ]),
    format: "der",
    type: "spki",
  });
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      diffieHellman({ privateKey, publicKey: ephemeralPublicKey }),
      decodeB64url(envelope.salt),
      PAYLOAD_KEY_INFO,
      32,
    ),
  );
  const ciphertext = decodeB64url(envelope.ciphertext);
  const decipher = createDecipheriv("aes-256-gcm", key, decodeB64url(envelope.nonce));
  decipher.setAAD(REQUEST_AAD);
  decipher.setAuthTag(ciphertext.subarray(-16));
  return Buffer.concat([
    decipher.update(ciphertext.subarray(0, -16)),
    decipher.final(),
  ]);
}

function encryptResponse(plaintext, recipientPublicKey) {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      diffieHellman({ privateKey, publicKey: recipientPublicKey }),
      salt,
      PAYLOAD_KEY_INFO,
      32,
    ),
  );
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(RESPONSE_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    aad: RESPONSE_AAD.toString("ascii"),
    algorithm: "X25519-HKDF-SHA256+A256GCM",
    ciphertext: b64url(ciphertext),
    ephemeral_public_key: b64url(
      publicKey.export({ format: "der", type: "spki" }).subarray(-32),
    ),
    nonce: b64url(nonce),
    salt: b64url(salt),
    version: 1,
  };
}

function verifySignature(request, body, secret) {
  const canonical = [
    request.method,
    new URL(request.url, "http://localhost").pathname,
    request.headers["x-nathbrok-timestamp"],
    request.headers["x-nathbrok-nonce"],
    createHash("sha256").update(body).digest("hex"),
  ].join("\n");
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  assert.equal(request.headers["x-nathbrok-signature"], expected);
}

test("Auth signs initialization and encrypts requests with decryptable responses", async (t) => {
  const { privateKey: serverPrivateKey, publicKey: serverPublicKey } =
    generateKeyPairSync("x25519");
  const serverKey = b64url(serverPublicKey.export({ format: "der", type: "spki" }).subarray(-32));
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    try {
      verifySignature(request, body, "signing-secret");
      assert.equal(request.headers.authorization, "******");
      assert.equal(request.headers["x-nathbrok-server-id"], "server-id");
      if (request.url === "/sdk/v1/initialize/") {
        assert.deepEqual(JSON.parse(body), { access_key: "one-time-key" });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ server_key: serverKey, server_user: "owner@nathlink" }));
        return;
      }
      assert.equal(request.headers["x-nathbrok-encrypted-request"], "true");
      const requestEnvelope = JSON.parse(body);
      assert.deepEqual(JSON.parse(decryptRequest(requestEnvelope, serverPrivateKey)), {
        message: "private",
      });
      const clientPublicKey = createPublicKey({
        key: Buffer.concat([
          X25519_SPKI_PREFIX,
          decodeB64url(requestEnvelope.ephemeral_public_key),
        ]),
        format: "der",
        type: "spki",
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify(
          encryptResponse(Buffer.from('{"ok":true}'), clientPublicKey),
        ),
      );
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ detail: error.message }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  const auth = new Auth({ baseUrl: `http://127.0.0.1:${address.port}/sdk/v1` });

  const initialized = await auth.initialize("server-id", "one-time-key", "signing-secret");
  assert.equal(initialized.server_user, "owner@nathlink");
  assert.equal(auth.serverUser, "owner@nathlink");
  const result = await auth.authorizedEncryptedRequest(
    "POST",
    `${auth.baseUrl}/secure/`,
    { json: { message: "private" } },
  );
  assert.deepEqual(result, { ok: true });
});

test("Auth exposes unsuccessful API responses as NathbrokAPIError", async (t) => {
  const server = createServer((request, response) => {
    response.writeHead(403, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ detail: "denied" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  const auth = new Auth({
    baseUrl: `http://127.0.0.1:${address.port}`,
    accessKeyId: "server-id",
    secretKey: "secret",
  });

  await assert.rejects(
    auth.authorizedRequest("GET", `${auth.baseUrl}/denied/`),
    (error) => {
      assert.ok(error instanceof NathbrokAPIError);
      assert.equal(error.statusCode, 403);
      assert.deepEqual(error.detail, { detail: "denied" });
      return true;
    },
  );
});

test("MailClient sends validated JSON through the signed API client", async (t) => {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    assert.equal(request.url, "/sdk/v1/mail/send/");
    assert.deepEqual(JSON.parse(Buffer.concat(chunks)), {
      bcc: [],
      body_html: "",
      body_text: "Message body",
      cc: ["copy@example.test"],
      mailbox: "sender@example.test",
      subject: "Hello",
      to: "recipient@example.test",
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"queued":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  const auth = new Auth({
    baseUrl: `http://127.0.0.1:${address.port}/sdk/v1`,
    accessKeyId: "server-id",
    secretKey: "secret",
  });
  const mail = new MailClient(auth);
  assert.deepEqual(
    await mail.sendEmail(
      { subject: "Hello", body_text: "Message body" },
      " sender@example.test ",
      "recipient@example.test",
      { cc: ["copy@example.test"] },
    ),
    { queued: true },
  );
  await assert.rejects(
    mail.sendEmail({ subject: "bad\r\nheader", body_text: "x" }, "a@b.test", "c@d.test"),
    /must not contain line breaks/,
  );
});

test("Chat cryptography unlocks private keys and round-trips room keys and messages", () => {
  const passphrase = "a local passphrase";
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const wrappingKey = pbkdf2Sync(passphrase, salt, 100000, 32, "sha256");
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
  const encryptedPrivateKey = Buffer.concat([
    cipher.update(privateDer),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const keyMaterial = {
    public_key: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    encrypted_private_key: encryptedPrivateKey.toString("base64"),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    pbkdf2_iterations: 100000,
  };
  const chatCrypto = new ChatCryptoClient({
    baseUrl: "https://api-routes.nathbrok.com/sdk/v1",
    authorizedEncryptedRequest() {},
  });
  const unlocked = chatCrypto.unlockUserKey(passphrase, keyMaterial);
  assert.equal(
    unlocked.export({ format: "der", type: "pkcs8" }).toString("hex"),
    privateDer.toString("hex"),
  );

  const roomKey = ChatCryptoClient.generateRoomKey();
  const envelope = ChatCryptoClient.createRoomEnvelope(
    roomKey,
    keyMaterial.public_key,
    7,
  );
  assert.deepEqual(ChatCryptoClient.decryptRoomEnvelope(envelope, unlocked), roomKey);
  const message = ChatCryptoClient.encryptMessage("chat text", roomKey);
  assert.equal(ChatCryptoClient.decryptMessage(message, roomKey), "chat text");
});
