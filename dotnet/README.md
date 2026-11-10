# Nathbrok REST SDK for .NET

The Nathbrok .NET SDK is for **server-side integrations**, such as website
backends. It is not a browser SDK. Keep Server credentials and chat passphrases
on the server; do not include them in browser code.

## Requirements

- .NET 8 or later
- An institution account with a registered Nathbrok Server and its Access key
  ID, one-time Access key, and signing secret

## Install

From the SDK repository root, build the NuGet package:

```shell
dotnet pack .\dotnet\NathbrokRestSdk.csproj -c Release
```

The package file is `dotnet\bin\Release\NathbrokRestSdk.1.0.3.nupkg`.
It is not available from nuget.org until it has been published. To install this
local package into a server project, run the following from that project's
directory, replacing the path with the location of this SDK checkout:

```shell
dotnet add package NathbrokRestSdk --version 1.0.3 --source "C:\path\to\nathbrokrestsdk\dotnet\bin\Release"
```

After the package is published to nuget.org, install it with:

```shell
dotnet add package NathbrokRestSdk --version 1.0.3
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

The DDE client mirrors the Python SDK wrapper, but DDE endpoints are not yet
registered by the current SDK API server; those methods will fail until server
support is added.
