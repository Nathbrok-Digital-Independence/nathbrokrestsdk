import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomBytes,
  generateKeyPairSync,
} from "node:crypto";
import http from "node:http";
import https from "node:https";

const DEFAULT_BASE_URL = "https://api-routes.nathbrok.com/sdk/v1";
const PAYLOAD_KEY_INFO = Buffer.from("nathbrok-sdk-payload-aes256gcm-v1");
const REQUEST_AAD = Buffer.from("nathbrok-sdk-encrypted-request-v1");
const RESPONSE_AAD = Buffer.from("nathbrok-sdk-encrypted-response-v1");
const ENVELOPE_ALGORITHM = "X25519-HKDF-SHA256+A256GCM";
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

export class NathbrokAPIError extends Error {
  constructor(statusCode, detail) {
    super(`Nathbrok API returned HTTP ${statusCode}: ${formatDetail(detail)}`);
    this.name = "NathbrokAPIError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

function formatDetail(detail) {
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return Buffer.from(JSON.stringify(sortJson(value)), "utf8");
}

function toBuffer(value) {
  if (value === undefined || value === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw new TypeError("Request body must be a Buffer, string, or null");
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError(`${field} must be a base64url string`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (encodeBase64Url(decoded) !== value) {
    throw new TypeError(`${field} must be a valid base64url string`);
  }
  return decoded;
}

function decodeX25519PublicKey(value) {
  const raw = decodeBase64Url(value, "server_key");
  if (raw.length !== 32) {
    throw new TypeError("server_key must contain a 32-byte X25519 public key");
  }
  return createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

function encryptEnvelope(publicKey, plaintext, aad) {
  const { privateKey, publicKey: ephemeralPublicKey } = generateKeyPairSync("x25519");
  const sharedSecret = diffieHellman({ privateKey, publicKey });
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const aesKey = Buffer.from(
    hkdfSync("sha256", sharedSecret, salt, PAYLOAD_KEY_INFO, 32),
  );
  const cipher = createCipheriv("aes-256-gcm", aesKey, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const ephemeralBytes = ephemeralPublicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    envelope: {
      aad: aad.toString("ascii"),
      algorithm: ENVELOPE_ALGORITHM,
      ciphertext: encodeBase64Url(ciphertext),
      ephemeral_public_key: encodeBase64Url(ephemeralBytes),
      nonce: encodeBase64Url(nonce),
      salt: encodeBase64Url(salt),
      version: 1,
    },
    privateKey,
  };
}

function decryptEnvelope(envelope, privateKey, expectedAad) {
  if (
    !envelope ||
    envelope.version !== 1 ||
    envelope.algorithm !== ENVELOPE_ALGORITHM ||
    envelope.aad !== expectedAad.toString("ascii")
  ) {
    throw new TypeError("Invalid encrypted response envelope");
  }
  const ephemeralBytes = decodeBase64Url(envelope.ephemeral_public_key, "ephemeral_public_key");
  if (ephemeralBytes.length !== 32) {
    throw new TypeError("ephemeral_public_key must contain 32 bytes");
  }
  const ephemeralPublicKey = createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, ephemeralBytes]),
    format: "der",
    type: "spki",
  });
  const salt = decodeBase64Url(envelope.salt, "salt");
  const nonce = decodeBase64Url(envelope.nonce, "nonce");
  const encrypted = decodeBase64Url(envelope.ciphertext, "ciphertext");
  if (salt.length !== 16 || nonce.length !== 12 || encrypted.length < 16) {
    throw new TypeError("Invalid encrypted response salt, nonce, or ciphertext");
  }
  const sharedSecret = diffieHellman({ privateKey, publicKey: ephemeralPublicKey });
  const aesKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, PAYLOAD_KEY_INFO, 32));
  const decipher = createDecipheriv("aes-256-gcm", aesKey, nonce);
  decipher.setAAD(expectedAad);
  decipher.setAuthTag(encrypted.subarray(-16));
  return Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
}

function buildMultipart(fields, files) {
  const boundary = `----NathbrokSDK${randomBytes(18).toString("hex")}`;
  const chunks = [];
  const quoted = (value) => String(value).replace(/[\r\n"]/g, "_");
  for (const [name, value] of Object.entries(fields ?? {})) {
    if (value === undefined || value === null) continue;
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(name)}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  for (const [name, file] of Object.entries(files ?? {})) {
    if (!file || typeof file.filename !== "string" || !Buffer.isBuffer(file.content)) {
      throw new TypeError(`files.${name} must include a filename and Buffer content`);
    }
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(name)}"; filename="${quoted(file.filename)}"\r\nContent-Type: ${file.contentType ?? "application/octet-stream"}\r\n\r\n`,
      ),
      file.content,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function sendHttpRequest(url, method, headers, body, timeout) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      url,
      { method, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 400,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.setTimeout(timeout, () => {
      request.destroy(new Error(`Request timed out after ${timeout} ms`));
    });
    request.on("error", reject);
    if (body.length > 0) request.write(body);
    request.end();
  });
}

export class Auth {
  constructor({
    baseUrl = DEFAULT_BASE_URL,
    accessKeyId,
    accessKey,
    secretKey,
    timeout = 15000,
    serverKey,
  } = {}) {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new TypeError("baseUrl must be an absolute HTTP(S) URL");
    }
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
      throw new TypeError("baseUrl must be an absolute HTTP(S) URL");
    }
    if (
      parsed.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    ) {
      throw new TypeError("HTTPS is required except when using localhost");
    }
    if (parsed.search || parsed.hash) {
      throw new TypeError("baseUrl must not contain a query or fragment");
    }
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new TypeError("timeout must be a positive number of milliseconds");
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.accessKeyId = accessKeyId;
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.serverKey = serverKey;
    this.serverUser = undefined;
    this.timeout = timeout;
  }

  generateSignature(method, path, body = Buffer.alloc(0)) {
    if (typeof this.secretKey !== "string" || !this.secretKey) {
      throw new TypeError("secretKey is required to sign requests");
    }
    const bytes = toBuffer(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(24).toString("base64url");
    const url = new URL(path, this.baseUrl);
    const canonical = [
      String(method).toUpperCase(),
      url.pathname,
      timestamp,
      nonce,
      createHash("sha256").update(bytes).digest("hex"),
    ].join("\n");
    const signature = createHmac("sha256", this.secretKey).update(canonical, "utf8").digest("hex");
    return { signature, timestamp, nonce };
  }

  async initialize(accessKeyId, accessKey, secretKey) {
    if (![accessKeyId, accessKey, secretKey].every((value) => typeof value === "string" && value)) {
      throw new TypeError("accessKeyId, accessKey, and secretKey are required");
    }
    this.accessKeyId = accessKeyId;
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    const body = canonicalJson({ access_key: accessKey });
    const basePath = new URL(this.baseUrl).pathname.replace(/\/+$/, "");
    const initializePath = basePath.endsWith("/sdk/v1")
      ? "/initialize/"
      : "/sdk/v1/initialize/";
    const response = await this.#sendSignedRequest(
      "POST",
      `${this.baseUrl}${initializePath}`,
      body,
      { "Content-Type": "application/json" },
      false,
    );
    const publicKey = response.payload.server_key;
    if (typeof publicKey !== "string" || !publicKey) {
      throw new NathbrokAPIError(response.statusCode, "Missing server_key in response");
    }
    decodeX25519PublicKey(publicKey);
    this.serverKey = publicKey;
    this.serverUser =
      typeof response.payload.server_user === "string" && response.payload.server_user
        ? response.payload.server_user
        : undefined;
    return response.payload;
  }

  async authorizedRequest(method, url, options = {}) {
    this.#requireInitialized(false);
    const bodyOptions = ["json", "data", "body"].filter((key) =>
      Object.hasOwn(options, key),
    );
    if (bodyOptions.length > 1) {
      throw new TypeError("Provide only one of json, data, or body");
    }
    const headers = { ...(options.headers ?? {}) };
    let body;
    if (options.files) {
      const multipart = buildMultipart(options.data, options.files);
      body = multipart.body;
      headers["Content-Type"] = multipart.contentType;
    } else if (Object.hasOwn(options, "json")) {
      body = canonicalJson(options.json);
      headers["Content-Type"] ??= "application/json";
    } else if (Object.hasOwn(options, "data") && options.data !== undefined) {
      if (Array.isArray(options.data) || (options.data && typeof options.data === "object" && !Buffer.isBuffer(options.data))) {
        body = canonicalJson(options.data);
        headers["Content-Type"] ??= "application/json";
      } else {
        body = toBuffer(options.data);
      }
    } else {
      body = toBuffer(options.body);
    }
    const response = await this.#sendSignedRequest(method, url, body, headers, false);
    return response.payload;
  }

  async authorizedEncryptedRequest(method, url, options = {}) {
    this.#requireInitialized(true);
    if (options.files) {
      throw new TypeError("Encrypted multipart requests are not supported");
    }
    const bodyOptions = ["json", "data", "body"].filter((key) =>
      Object.hasOwn(options, key),
    );
    if (bodyOptions.length > 1) {
      throw new TypeError("Provide only one of json, data, or body");
    }
    let plaintext;
    if (Object.hasOwn(options, "json")) {
      plaintext = canonicalJson(options.json);
    } else {
      const value = Object.hasOwn(options, "data") ? options.data : options.body;
      plaintext =
        value && typeof value === "object" && !Buffer.isBuffer(value)
          ? canonicalJson(value)
          : toBuffer(value);
    }
    const requestEnvelope = encryptEnvelope(
      decodeX25519PublicKey(this.serverKey),
      plaintext,
      REQUEST_AAD,
    );
    const encryptedBody = canonicalJson(requestEnvelope.envelope);
    const headers = { ...(options.headers ?? {}), "Content-Type": "application/json" };
    const response = await this.#sendSignedRequest(
      method,
      url,
      encryptedBody,
      headers,
      true,
      requestEnvelope.privateKey,
    );
    return response.payload;
  }

  async createSsoUrl(email) {
    if (typeof email !== "string" || !email.trim()) {
      throw new TypeError("email must be a non-empty string");
    }
    const payload = await this.authorizedEncryptedRequest(
      "POST",
      `${this.baseUrl}/sso/authorize/`,
      { json: { email: email.trim() } },
    );
    if (typeof payload.sso_url !== "string" || !payload.sso_url) {
      throw new NathbrokAPIError(200, "Missing sso_url in response");
    }
    return payload.sso_url;
  }

  encryptData(data) {
    if (!Buffer.isBuffer(data)) throw new TypeError("data must be a Buffer");
    if (!this.serverKey) {
      throw new TypeError("Server key is not set. Call initialize() first.");
    }
    return canonicalJson(
      encryptEnvelope(decodeX25519PublicKey(this.serverKey), data, REQUEST_AAD).envelope,
    );
  }

  #requireInitialized(encrypted) {
    if (!this.accessKeyId || !this.secretKey) {
      throw new TypeError("Auth is not initialized. Call initialize() first.");
    }
    if (encrypted && !this.serverKey) {
      throw new TypeError("Server encryption key is missing. Call initialize() first.");
    }
  }

  async #sendSignedRequest(method, requestUrl, body, headers, encrypted, responsePrivateKey) {
    const url = new URL(requestUrl, this.baseUrl);
    const { signature, timestamp, nonce } = this.generateSignature(method, url, body);
    const requestHeaders = {
      ...headers,
      Authorization: "******",
      "X-Nathbrok-Server-ID": String(this.accessKeyId),
      "X-Nathbrok-Signature": signature,
      "X-Nathbrok-Timestamp": timestamp,
      "X-Nathbrok-Nonce": nonce,
      "X-Nathbrok-Encrypted-Request": encrypted ? "true" : "false",
    };
    if (body.length > 0) requestHeaders["Content-Length"] = String(body.length);
    const rawResponse = await sendHttpRequest(
      url,
      method,
      requestHeaders,
      body,
      this.timeout,
    );
    let payload;
    try {
      payload = JSON.parse(rawResponse.body.toString("utf8"));
    } catch {
      throw new NathbrokAPIError(
        rawResponse.statusCode,
        "Response body was not valid JSON or could not be decrypted",
      );
    }
    if (encrypted) {
      try {
        const plaintext = decryptEnvelope(
          payload,
          responsePrivateKey,
          RESPONSE_AAD,
        );
        payload = JSON.parse(plaintext.toString("utf8"));
      } catch {
        throw new NathbrokAPIError(
          rawResponse.statusCode,
          "Response body was not valid JSON or could not be decrypted",
        );
      }
    }
    if (!rawResponse.ok) throw new NathbrokAPIError(rawResponse.statusCode, payload);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new NathbrokAPIError(rawResponse.statusCode, "Expected a JSON object");
    }
    return { statusCode: rawResponse.statusCode, payload };
  }
}
