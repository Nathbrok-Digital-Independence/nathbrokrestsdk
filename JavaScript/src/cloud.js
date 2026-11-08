import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Auth } from "./auth.js";

export class CloudClient {
  constructor(auth = new Auth()) {
    this.auth = auth;
  }

  async uploadFile(bucketId, filePath, { folderId } = {}) {
    if (typeof bucketId !== "string") throw new TypeError("bucketId must be a string");
    if (typeof filePath !== "string" || !filePath) {
      throw new TypeError("filePath must be a non-empty path string");
    }
    if (
      folderId !== undefined &&
      folderId !== null &&
      typeof folderId !== "string" &&
      !Number.isSafeInteger(folderId)
    ) {
      throw new TypeError("folderId must be a string, integer, or null");
    }
    const filename = basename(filePath);
    if (!filename) throw new TypeError("filePath must include a filename");
    const content = await readFile(filePath);
    const data = { bucket_id: bucketId };
    if (folderId !== undefined && folderId !== null) data.folder_id = String(folderId);
    return this.auth.authorizedRequest(
      "POST",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/buckets/${encodeURIComponent(bucketId)}/files/`,
      {
        data,
        files: { file: { filename, content } },
      },
    );
  }

  async deleteFile(fileId) {
    if (!Number.isSafeInteger(fileId) || fileId < 1) {
      throw new TypeError("fileId must be a positive integer");
    }
    return this.auth.authorizedRequest(
      "DELETE",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/files/`,
      { json: { file_id: fileId } },
    );
  }

  async generateFileDownloadLink(fileId) {
    if (!Number.isSafeInteger(fileId) || fileId < 1) {
      throw new TypeError("fileId must be a positive integer");
    }
    return this.auth.authorizedRequest(
      "GET",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/files/download/`,
      { json: { file_id: fileId } },
    );
  }

  async createBucket(quota, name) {
    if (!Number.isSafeInteger(quota)) throw new TypeError("quota must be an integer");
    if (typeof name !== "string") throw new TypeError("name must be a string");
    return this.auth.authorizedRequest(
      "POST",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/buckets/`,
      { json: { qouta: quota, name } },
    );
  }

  async deleteBucket(bucketId) {
    if (typeof bucketId !== "string") throw new TypeError("bucketId must be a string");
    return this.auth.authorizedRequest(
      "DELETE",
      `${this.auth.baseUrl.replace(/\/+$/, "")}/buckets/`,
      { json: { bucket_id: bucketId } },
    );
  }
}
