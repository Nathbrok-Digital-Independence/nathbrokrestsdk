import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
  generateKeyPairSync,
} from "node:crypto";
import { Auth } from "./auth.js";

function decodeBase64(value, field) {
  if (
    typeof value !== "string" ||
    !value ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new TypeError(`${field} must be a non-empty base64 string`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new TypeError(`${field} must be valid base64`);
  }
  return decoded;
}

function decryptGcm(key, iv, encrypted, aad) {
  if (encrypted.length < 16) throw new TypeError("Encrypted value is incomplete");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(encrypted.subarray(-16));
  return Buffer.concat([
    decipher.update(encrypted.subarray(0, -16)),
    decipher.final(),
  ]);
}

function encryptGcm(key, iv, plaintext, aad) {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function validateRoomId(roomId) {
  if (!Number.isSafeInteger(roomId) || roomId < 1) {
    throw new TypeError("roomId must be a positive integer");
  }
}

export class ChatCryptoClient {
  constructor(auth) {
    if (
      typeof auth?.baseUrl !== "string" ||
      typeof auth.authorizedEncryptedRequest !== "function"
    ) {
      throw new TypeError("auth must provide baseUrl and authorizedEncryptedRequest");
    }
    this.auth = auth;
  }

  async fetchUserKeyMaterial(user) {
    this.#validateUser(user);
    const response = await this.#fetchKeys({ user: user.trim() });
    if (!response.key_material || typeof response.key_material !== "object") {
      throw new TypeError("The SDK response did not contain user key material");
    }
    if (!Number.isSafeInteger(response.user_id) || response.user_id < 1) {
      throw new TypeError("The SDK response did not contain a valid user_id");
    }
    return { ...response.key_material, user_id: response.user_id };
  }

  static generateRoomKey() {
    return randomBytes(32);
  }

  unlockKey({
    passphrase,
    iv,
    encrypted_private_key: encryptedPrivateKey,
    salt,
    pbkdf2_iterations: iterations,
    public_key: publicKey,
  }) {
    if (typeof passphrase !== "string" || !passphrase) {
      throw new TypeError("passphrase must be a non-empty string");
    }
    if (!Number.isSafeInteger(iterations) || iterations < 100000) {
      throw new TypeError("pbkdf2Iterations must be an integer of at least 100000");
    }
    const saltBytes = decodeBase64(salt, "salt");
    const ivBytes = decodeBase64(iv, "iv");
    const encryptedBytes = decodeBase64(encryptedPrivateKey, "encrypted_private_key");
    if (ivBytes.length !== 12) throw new TypeError("iv must contain exactly 12 bytes");
    const wrappingKey = pbkdf2Sync(
      Buffer.from(passphrase, "utf8"),
      saltBytes,
      iterations,
      32,
      "sha256",
    );
    let privateKey;
    try {
      privateKey = createPrivateKey({
        key: decryptGcm(wrappingKey, ivBytes, encryptedBytes),
        format: "der",
        type: "pkcs8",
      });
    } catch {
      throw new Error("Unable to unlock the private key; check the passphrase and key material");
    }
    if (
      privateKey.asymmetricKeyType !== "ec" ||
      privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new TypeError("The unlocked private key must use the P-256 curve");
    }
    const suppliedPublicKey = createPublicKey({
      key: decodeBase64(publicKey, "public_key"),
      format: "der",
      type: "spki",
    });
    if (
      suppliedPublicKey.asymmetricKeyType !== "ec" ||
      suppliedPublicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new TypeError("public_key must be a P-256 ECDH public key");
    }
    const derivedDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    const suppliedDer = suppliedPublicKey.export({ format: "der", type: "spki" });
    if (derivedDer.length !== suppliedDer.length || !timingSafeEqual(derivedDer, suppliedDer)) {
      throw new TypeError("The unlocked private key does not match public_key");
    }
    return privateKey;
  }

  unlockUserKey(passphrase, keyMaterial) {
    if (!keyMaterial || typeof keyMaterial !== "object" || Array.isArray(keyMaterial)) {
      throw new TypeError("keyMaterial must be an object");
    }
    const requiredFields = [
      "iv",
      "encrypted_private_key",
      "salt",
      "pbkdf2_iterations",
      "public_key",
    ];
    const missing = requiredFields.filter((field) => !(field in keyMaterial));
    if (missing.length) {
      throw new TypeError(`keyMaterial is missing fields: ${missing.join(", ")}`);
    }
    return this.unlockKey({ ...keyMaterial, passphrase });
  }

  async fetchRoomEnvelope(roomId, user) {
    validateRoomId(roomId);
    this.#validateUser(user);
    const response = await this.#fetchKeys({ user: user.trim(), room_id: roomId });
    if (!response.envelope || typeof response.envelope !== "object") {
      throw new TypeError("The SDK response did not contain a room-key envelope");
    }
    return response.envelope;
  }

  static createRoomEnvelope(roomKey, recipientPublicKey, recipientId) {
    if (!Buffer.isBuffer(roomKey) || roomKey.length !== 32) {
      throw new TypeError("roomKey must contain exactly 32 bytes");
    }
    if (!Number.isSafeInteger(recipientId) || recipientId < 1) {
      throw new TypeError("recipientId must be a positive integer");
    }
    const publicKey = createPublicKey({
      key: decodeBase64(recipientPublicKey, "recipient_public_key"),
      format: "der",
      type: "spki",
    });
    if (
      publicKey.asymmetricKeyType !== "ec" ||
      publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new TypeError("recipientPublicKey must be a P-256 ECDH public key");
    }
    const { privateKey, publicKey: senderPublicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const sharedSecret = diffieHellman({ privateKey, publicKey });
    const iv = randomBytes(12);
    const ciphertext = encryptGcm(sharedSecret, iv, roomKey);
    return {
      recipient_id: recipientId,
      room_key: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      sender_public_key: senderPublicKey.export({ format: "der", type: "spki" }).toString("base64"),
    };
  }

  async unlockRoomKey(roomId, user, passphrase) {
    const keyMaterial = await this.fetchUserKeyMaterial(user);
    const privateKey = this.unlockUserKey(passphrase, keyMaterial);
    const envelope = await this.fetchRoomEnvelope(roomId, user);
    const roomKey = ChatCryptoClient.decryptRoomEnvelope(envelope, privateKey);
    if (!Number.isSafeInteger(envelope.key_version_id) || envelope.key_version_id < 1) {
      throw new TypeError("The room-key envelope did not include a valid key_version_id");
    }
    return { roomKey, keyVersionId: envelope.key_version_id };
  }

  static decryptRoomEnvelope(envelope, privateKey) {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw new TypeError("envelope must be an object");
    }
    if (
      privateKey?.asymmetricKeyType !== "ec" ||
      privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new TypeError("privateKey must be a P-256 elliptic-curve private key");
    }
    const senderPublicKey = createPublicKey({
      key: decodeBase64(envelope.sender_public_key, "sender_public_key"),
      format: "der",
      type: "spki",
    });
    if (
      senderPublicKey.asymmetricKeyType !== "ec" ||
      senderPublicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new TypeError("sender_public_key must be a P-256 ECDH public key");
    }
    const iv = decodeBase64(envelope.iv, "iv");
    const encryptedRoomKey = decodeBase64(envelope.room_key, "room_key");
    if (iv.length !== 12) throw new TypeError("Envelope iv must contain exactly 12 bytes");
    const roomKey = decryptGcm(
      diffieHellman({ privateKey, publicKey: senderPublicKey }),
      iv,
      encryptedRoomKey,
    );
    if (roomKey.length !== 32) {
      throw new TypeError("Decrypted room key must contain exactly 32 bytes");
    }
    return roomKey;
  }

  static encryptMessage(plaintext, roomKey) {
    if (typeof plaintext !== "string") throw new TypeError("plaintext must be a string");
    if (!Buffer.isBuffer(roomKey) || roomKey.length !== 32) {
      throw new TypeError("roomKey must contain exactly 32 bytes");
    }
    const iv = randomBytes(12);
    return {
      iv: iv.toString("base64"),
      ciphertext: encryptGcm(roomKey, iv, Buffer.from(plaintext, "utf8")).toString("base64"),
    };
  }

  static decryptMessage(encryptedMessage, roomKey) {
    if (!encryptedMessage || typeof encryptedMessage !== "object") {
      throw new TypeError("encryptedMessage must be an object");
    }
    if (!Buffer.isBuffer(roomKey) || roomKey.length !== 32) {
      throw new TypeError("roomKey must contain exactly 32 bytes");
    }
    const iv = decodeBase64(encryptedMessage.iv, "iv");
    if (iv.length !== 12) throw new TypeError("Message iv must contain exactly 12 bytes");
    return decryptGcm(
      roomKey,
      iv,
      decodeBase64(encryptedMessage.ciphertext, "ciphertext"),
    ).toString("utf8");
  }

  async #fetchKeys(payload) {
    return this.auth.authorizedEncryptedRequest(
      "POST",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/chat/keys/`,
      { json: payload },
    );
  }

  #validateUser(user) {
    if (typeof user !== "string" || !user.trim()) {
      throw new TypeError("user must be a non-empty email, username, or nathlink");
    }
  }
}

export class ChatClient {
  constructor(auth = new Auth()) {
    this.auth = auth;
    this.crypto = new ChatCryptoClient(auth);
    this.roomKeys = new Map();
  }

  async sendMessage(message, roomId, sender, passphrase) {
    if (!Array.isArray(message) || !message.every((item) => typeof item === "string")) {
      throw new TypeError("message must be an array of strings");
    }
    validateRoomId(roomId);
    if (typeof sender !== "string" || !sender.trim()) {
      throw new TypeError("sender must be a non-empty user identifier");
    }
    if (typeof passphrase !== "string" || !passphrase) {
      throw new TypeError("passphrase must be a non-empty string");
    }
    if (!this.roomKeys.has(roomId)) await this.unlockRoom(roomId, passphrase, sender);
    const { keyVersionId } = this.roomKeys.get(roomId);
    const content = this.encryptMessage(roomId, JSON.stringify(message));
    return this.auth.authorizedEncryptedRequest(
      "POST",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/chat/messages/`,
      { json: { room_id: roomId, user: sender.trim(), key_version: keyVersionId, content } },
    );
  }

  async createRoom(name, users, passphrase, { admin, user } = {}) {
    if (typeof name !== "string" || !name.trim()) {
      throw new TypeError("name must be a non-empty string");
    }
    if (!Array.isArray(users) || users.length === 0) {
      throw new TypeError("users must be a non-empty array of user identifiers");
    }
    if (!users.every((item) => typeof item === "string" && item.trim())) {
      throw new TypeError("All users must be non-empty strings");
    }
    if (admin !== undefined && (typeof admin !== "string" || !admin.trim())) {
      throw new TypeError("admin must be a non-empty string when provided");
    }
    if (typeof passphrase !== "string" || !passphrase) {
      throw new TypeError("passphrase must be a non-empty string");
    }
    const creator = user ?? this.auth.serverUser;
    if (typeof creator !== "string" || !creator.trim()) {
      throw new TypeError("user is required unless Auth.initialize() returned serverUser");
    }
    const participantIdentifiers = [
      creator.trim(),
      ...users.map((item) => item.trim()),
      ...(admin === undefined ? [] : [admin.trim()]),
    ];
    const participantKeyMaterial = new Map();
    let creatorKeyMaterial;
    for (const identifier of participantIdentifiers) {
      const material = await this.crypto.fetchUserKeyMaterial(identifier);
      participantKeyMaterial.set(
        material.user_id,
        participantKeyMaterial.get(material.user_id) ?? material,
      );
      if (identifier.toLowerCase() === creator.trim().toLowerCase()) {
        creatorKeyMaterial = material;
      }
    }
    if (!creatorKeyMaterial) {
      throw new TypeError("Could not retrieve the creator's public key material");
    }
    this.crypto.unlockUserKey(passphrase, creatorKeyMaterial);
    const roomKey = ChatCryptoClient.generateRoomKey();
    const envelopes = [...participantKeyMaterial.entries()].map(([participantId, material]) =>
      ChatCryptoClient.createRoomEnvelope(roomKey, material.public_key, participantId),
    );
    const response = await this.auth.authorizedEncryptedRequest(
      "POST",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/chat/rooms/`,
      {
        json: {
          name: name.trim(),
          users: participantIdentifiers,
          admin: admin?.trim() ?? null,
          envelopes,
        },
      },
    );
    if (Number.isSafeInteger(response.room_id) && Number.isSafeInteger(response.key_version_id)) {
      this.roomKeys.set(response.room_id, {
        roomKey,
        keyVersionId: response.key_version_id,
      });
    }
    return response;
  }

  async unlockRoom(roomId, passphrase, user) {
    validateRoomId(roomId);
    const unlocked = await this.crypto.unlockRoomKey(roomId, user, passphrase);
    this.roomKeys.set(roomId, unlocked);
    return unlocked.roomKey;
  }

  encryptMessage(roomId, plaintext) {
    const room = this.roomKeys.get(roomId);
    if (!room) throw new TypeError("Room key is locked; call unlockRoom() first");
    return ChatCryptoClient.encryptMessage(plaintext, room.roomKey);
  }

  decryptMessage(roomId, encryptedMessage) {
    const room = this.roomKeys.get(roomId);
    if (!room) throw new TypeError("Room key is locked; call unlockRoom() first");
    return ChatCryptoClient.decryptMessage(encryptedMessage, room.roomKey);
  }

  async deleteMessage(messageId) {
    validateRoomId(messageId);
    return this.auth.authorizedRequest(
      "DELETE",
      `${this.#apiBaseUrl()}/messages/${messageId}/`,
    );
  }

  async deleteRoom({ name, roomId } = {}) {
    if (name === undefined && roomId === undefined) {
      throw new TypeError("Either name or roomId must be provided");
    }
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      throw new TypeError("name must be a non-empty string");
    }
    if (roomId !== undefined) validateRoomId(roomId);
    const apiBase = this.#apiBaseUrl();
    if (name !== undefined) {
      return this.auth.authorizedRequest("DELETE", `${apiBase}/rooms/`, {
        json: { name: name.trim() },
      });
    }
    return this.auth.authorizedRequest("DELETE", `${apiBase}/rooms/${roomId}/`);
  }

  #apiBaseUrl() {
    return this.auth.baseUrl.replace(/\/+$/, "").replace(/\/sdk\/v1$/, "");
  }
}
