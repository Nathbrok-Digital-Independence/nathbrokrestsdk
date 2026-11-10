# Nathbrok REST SDK for .NET

The Nathbrok .NET SDK is for **server-side integrations**, such as website
backends. It is not a browser SDK. Keep Server credentials and chat passphrases
on the server; do not include them in browser code.

## Requirements

- .NET 10 is recommended. The package also targets .NET 8 for existing
  applications that still require it; .NET 8 reached end of support on
  November 10, 2026.
- An institution account with a registered Nathbrok Server and its Access key
  ID, one-time Access key, and signing secret

## Install

Install the SDK into your .NET server project:

```shell
dotnet add package NathbrokRestSdk
```

## Authenticate and use clients

```csharp
using System.Text.Json.Nodes;
using NathbrokRestSdk;

using var auth = new Auth();
await auth.InitializeAsync(
    Environment.GetEnvironmentVariable("NATHBROK_ACCESS_KEY_ID")!,
    Environment.GetEnvironmentVariable("NATHBROK_ACCESS_KEY")!,
    Environment.GetEnvironmentVariable("NATHBROK_SECRET_KEY")!);

var mail = new MailClient(auth);
await mail.SendEmailAsync(
    new JsonObject
    {
        ["subject"] = "Hello",
        ["body_text"] = "Sent with Nathbrok."
    },
    "sender@example.com",
    "recipient@example.com");
```

`Auth` signs API requests and handles encrypted requests and responses.
`ChatClient` and `ChatCryptoClient` provide local end-to-end chat key and
message encryption. `CloudClient` handles bucket files, and `MailClient` sends
mail through an authorized mailbox. API failures throw
`NathbrokApiException`, which exposes `StatusCode` and `Detail`.

`DDEClient` provides server-side data and file encryption/decryption through
the SDK API. File responses include base64-encoded `content` and its output
`filename`. DDE uses the server's stable `DDE_MASTER_KEY` by default. To use
your own key, pass it as the `key` argument; the SDK sends it only inside an
authenticated encrypted request, and the server does not store it. Decryption
tries your supplied key first and then `DDE_MASTER_KEY`; if neither works, the
API returns an error.

```csharp
var dde = new DDEClient(auth);
var encrypted = await dde.EncryptDataAsync(
    new JsonObject { ["account"] = "example" },
    key: Environment.GetEnvironmentVariable("DDE_KEY"));
var decrypted = await dde.DecryptDataAsync(
    encrypted,
    key: Environment.GetEnvironmentVariable("DDE_KEY"));
```

Files are processed in memory by the server. The SDK leaves the local source
file unchanged, and the server does not keep a temporary output file.
