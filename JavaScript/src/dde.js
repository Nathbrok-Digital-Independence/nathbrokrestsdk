import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Auth } from "./auth.js";

export class DDEClient {
  constructor(auth = new Auth()) {
    this.auth = auth;
  }

  async encryptFile(filePath) {
    return this.#fileRequest("POST", filePath);
  }

  async decryptFile(filePath) {
    return this.#fileRequest("GET", filePath);
  }

  async encryptData(data) {
    return this.auth.authorizedRequest(
      "POST",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/dde/data/`,
      { json: data },
    );
  }

  async decryptData(data) {
    return this.auth.authorizedRequest(
      "GET",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/dde/data/`,
      { json: data },
    );
  }

  async #fileRequest(method, filePath) {
    if (typeof filePath !== "string" || !filePath) {
      throw new TypeError("filePath must be a non-empty path string");
    }
    return this.auth.authorizedRequest(
      method,
      `${this.auth.baseUrl.replace(/\/+$/, "")}/dde/file/`,
      {
        files: {
          file: {
            filename: basename(filePath),
            content: await readFile(filePath),
          },
        },
      },
    );
  }
}
