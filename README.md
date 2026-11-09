# Nathbrok REST SDKs

Nathbrok is a digital workspace with services including NathMail for email,
NathChat for messaging, and NathCloud for file storage. These services are
available through Nathbrok's APIs.

## Purpose

The Nathbrok SDKs make it easier for server-side website backends to integrate
with those APIs. They provide client libraries for authentication and common
service operations, so developers can use Nathbrok from their backend without
implementing the API protocol themselves.

SDK access is based on a **Server** registered through an institution's
Nathbrok account. Server credentials must be kept secure on the backend. These
SDKs are not browser-side libraries and are not intended for native mobile or
desktop applications.

## Available languages

- **Python** — available in [`python/`](./python/).
- **JavaScript for Node.js** — available in [`JavaScript/`](./JavaScript/).
  This is a server-side SDK, not a browser SDK.

## Possible future languages

PHP, Java, C#, and Go are candidates for future server-side SDKs, depending on
developer and customer demand. They are not available yet, and no release
schedule is committed.

## SDK features

The SDKs cover authenticated access to Nathbrok APIs, including chat, cloud
storage, and mail. See each language's README for installation, supported
operations, requirements, and current API limitations.