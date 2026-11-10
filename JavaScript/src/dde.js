import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Auth } from "./auth.js";

export class DDEClient {
  constructor(auth = new Auth()) {
    this.auth = auth;
  }

  async encryptFile(filePath, key = undefined) {
    return this.#fileRequest("POST", filePath, key);
  }

  async decryptFile(filePath, key = undefined) {
    return this.#fileRequest("GET", filePath, key);
  }

  async encryptData(data, key = undefined) {
    if (key !== undefined) {
      this.#validateKey(key);
      return this.auth.authorizedEncryptedRequest(
        "POST",
        `${this.auth.baseUrl.replace(/\/+$/, "")}/dde/data/`,
        { json: { data, key } },
      );
    }
    return this.auth.authorizedRequest(
      "POST",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/dde/data/`,
      { json: data },
    );
  }

  async decryptData(data, key = undefined) {
    if (key !== undefined) {
      this.#validateKey(key);
      return this.auth.authorizedEncryptedRequest(
        "GET",
        `${this.auth.baseUrl.replace(/\/+$/, "")}/dde/data/`,
        { json: { data: data?.data, key } },
      );
    }
    return this.auth.authorizedRequest(
      "GET",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/dde/data/`,
      { json: data },
    );
  }

  async #fileRequest(method, filePath, key) {
    if (typeof filePath !== "string" || !filePath) {
      throw new TypeError("filePath must be a non-empty path string");
    }
    const url = `${this.auth.baseUrl.replace(/\/+$/, "")}/dde/file/`;
    const content = await readFile(filePath);
    if (key !== undefined) {
      this.#validateKey(key);
      return this.auth.authorizedEncryptedRequest(method, url, {
        json: {
          filename: basename(filePath),
          content: content.toString("base64"),
          key,
        },
      });
    }
    return this.auth.authorizedRequest(method, url, {
      files: {
        file: {
          filename: basename(filePath),
          content,
        },
      },
    });
  }

  #validateKey(key) {
    if (typeof key !== "string" || !key || key.length > 4096) {
      throw new TypeError("key must be a non-empty string of at most 4096 characters");
    }
  }
}
