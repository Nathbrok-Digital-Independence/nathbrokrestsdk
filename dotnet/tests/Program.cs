using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Org.BouncyCastle.Math.EC.Rfc7748;
using Org.BouncyCastle.Security;
using NathbrokRestSdk;

var checks = new (string Name, Action Run)[]
{
    ("HMAC signature follows the SDK canonical format", TestSignature),
    ("Server authentication and encrypted API calls round-trip", TestAuthRoundTrip),
    ("P-256 room-key envelope round-trips", TestRoomEnvelope),
    ("Passphrase-protected chat key unlocks", TestUnlockPrivateKey),
    ("Chat message encrypts and decrypts", TestMessageRoundTrip),
    ("Server base URLs initialize without duplicate SDK paths", TestBaseUrlValidation)
};

foreach (var (name, run) in checks)
{
    run();
    Console.WriteLine($"PASS {name}");
}

static void TestAuthRoundTrip()
{
    using var handler = new FakeNathbrokHandler();
    using var httpClient = new HttpClient(handler);
    using var auth = new Auth(
        "https://api.example.test/sdk/v1",
        timeout: TimeSpan.FromSeconds(5),
        httpClient: httpClient
    );

    var initialized = auth.InitializeAsync(
        "server-id",
        "one-time-key",
        "test-signing-secret"
    ).GetAwaiter().GetResult();
    Assert(initialized["server_user"]!.GetValue<string>() == "owner@nathlink", "Server owner was not returned");
    var payload = auth.AuthorizedEncryptedRequestAsync(
        HttpMethod.Post,
        $"{auth.BaseUrl}/test/",
        new JsonObject { ["message"] = "private" }
    ).GetAwaiter().GetResult();
    Assert(payload["ok"]!.GetValue<bool>(), "Encrypted response was not decoded");
}

static void TestSignature()
{
    const string secret = "test-signing-secret";
    var body = Encoding.UTF8.GetBytes("{\"a\":1}");
    using var auth = new Auth(
        "https://api.example.test/sdk/v1",
        accessKeyId: "server-id",
        secretKey: secret
    );
    var (signature, timestamp, nonce) = auth.GenerateSignature(
        HttpMethod.Post,
        new Uri("https://api.example.test/sdk/v1/test/"),
        body
    );
    var canonical = string.Join(
        '\n',
        "POST",
        "/sdk/v1/test/",
        timestamp,
        nonce,
        Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant()
    );
    var expected = Convert.ToHexString(
        HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(canonical))
    ).ToLowerInvariant();
    Assert(signature == expected, "The HMAC signature did not match");
}

static void TestRoomEnvelope()
{
    using var recipient = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    var roomKey = ChatCryptoClient.GenerateRoomKey();
    var envelope = ChatCryptoClient.CreateRoomEnvelope(
        roomKey,
        Convert.ToBase64String(recipient.ExportSubjectPublicKeyInfo()),
        19
    );
    using var sender = ECDiffieHellman.Create();
    sender.ImportSubjectPublicKeyInfo(
        Convert.FromBase64String(envelope["sender_public_key"]!.GetValue<string>()),
        out _
    );
    var sharedSecret = recipient.DeriveRawSecretAgreement(sender.PublicKey);
    var decrypted = DecryptAesGcm(
        sharedSecret,
        Convert.FromBase64String(envelope["iv"]!.GetValue<string>()),
        Convert.FromBase64String(envelope["room_key"]!.GetValue<string>())
    );
    Assert(roomKey.SequenceEqual(decrypted), "The decrypted room key did not match");
}

static void TestUnlockPrivateKey()
{
    const string passphrase = "local chat passphrase";
    using var originalKey = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    var salt = RandomNumberGenerator.GetBytes(32);
    var iv = RandomNumberGenerator.GetBytes(12);
    var iterations = 100_000;
    var wrappingKey = Rfc2898DeriveBytes.Pbkdf2(
        Encoding.UTF8.GetBytes(passphrase),
        salt,
        iterations,
        HashAlgorithmName.SHA256,
        32
    );
    var encryptedPrivateKey = EncryptAesGcm(wrappingKey, iv, originalKey.ExportPkcs8PrivateKey());
    var keyMaterial = new JsonObject
    {
        ["public_key"] = Convert.ToBase64String(originalKey.ExportSubjectPublicKeyInfo()),
        ["encrypted_private_key"] = Convert.ToBase64String(encryptedPrivateKey),
        ["salt"] = Convert.ToBase64String(salt),
        ["iv"] = Convert.ToBase64String(iv),
        ["pbkdf2_iterations"] = iterations
    };

    using var unlocked = ChatCryptoClient.UnlockUserKey(passphrase, keyMaterial);
    Assert(
        originalKey.ExportSubjectPublicKeyInfo().SequenceEqual(unlocked.ExportSubjectPublicKeyInfo()),
        "Unlocked private key did not match the stored public key"
    );
}

static void TestMessageRoundTrip()
{
    var key = ChatCryptoClient.GenerateRoomKey();
    var encrypted = ChatCryptoClient.EncryptMessage("hello from .NET", key);
    var plaintext = ChatCryptoClient.DecryptMessage(encrypted, key);
    Assert(plaintext == "hello from .NET", "The decrypted message did not match");
}

static void TestBaseUrlValidation()
{
    using var rootUrl = new Auth("https://api.example.test");
    using var sdkUrl = new Auth("https://api.example.test/sdk/v1");
    Assert(rootUrl.BaseUrl == "https://api.example.test", "Root base URL changed unexpectedly");
    Assert(sdkUrl.BaseUrl == "https://api.example.test/sdk/v1", "SDK base URL changed unexpectedly");
}

static byte[] EncryptAesGcm(byte[] key, byte[] iv, byte[] plaintext)
{
    var ciphertext = new byte[plaintext.Length];
    var tag = new byte[16];
    using var aes = new AesGcm(key, tag.Length);
    aes.Encrypt(iv, plaintext, ciphertext, tag);
    return [.. ciphertext, .. tag];
}

static byte[] DecryptAesGcm(byte[] key, byte[] iv, byte[] ciphertextAndTag)
{
    var plaintext = new byte[ciphertextAndTag.Length - 16];
    using var aes = new AesGcm(key, 16);
    aes.Decrypt(
        iv,
        ciphertextAndTag.AsSpan(0, plaintext.Length),
        ciphertextAndTag.AsSpan(plaintext.Length, 16),
        plaintext
    );
    return plaintext;
}

static void Assert(bool condition, string message)
{
    if (!condition)
    {
        throw new InvalidOperationException(message);
    }
}

sealed class FakeNathbrokHandler : HttpMessageHandler
{
        private const string KeyInfo = "nathbrok-sdk-payload-aes256gcm-v1";
        private const string RequestAad = "nathbrok-sdk-encrypted-request-v1";
        private const string ResponseAad = "nathbrok-sdk-encrypted-response-v1";
        private readonly byte[] _serverPrivateKey = new byte[32];
        private readonly byte[] _serverPublicKey = new byte[32];

        private static void Check(bool condition, string message)
        {
            if (!condition)
            {
                throw new InvalidOperationException(message);
            }
        }

        internal FakeNathbrokHandler()
        {
            X25519.GeneratePrivateKey(new SecureRandom(), _serverPrivateKey);
            X25519.GeneratePublicKey(_serverPrivateKey, 0, _serverPublicKey, 0);
        }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            var body = request.Content is null
                ? Array.Empty<byte>()
                : await request.Content.ReadAsByteArrayAsync(cancellationToken);
            VerifySignature(request, body);
            if (request.RequestUri!.AbsolutePath.EndsWith("/initialize/", StringComparison.Ordinal))
            {
                Check(
                    JsonNode.Parse(body)!["access_key"]!.GetValue<string>() == "one-time-key",
                    "Initialize did not send the one-time access key"
                );
                return JsonResponse(new JsonObject
                {
                    ["server_key"] = Base64Url(_serverPublicKey),
                    ["server_user"] = "owner@nathlink"
                });
            }

            Check(
                request.Headers.GetValues("X-Nathbrok-Encrypted-Request").Single() == "true",
                "Encrypted request header was not set"
            );
            var envelope = (JsonObject)JsonNode.Parse(body)!;
            var clientPublicKey = DecodeBase64Url(envelope["ephemeral_public_key"]!.GetValue<string>());
            var sharedSecret = Agreement(_serverPrivateKey, clientPublicKey);
            var salt = DecodeBase64Url(envelope["salt"]!.GetValue<string>());
            var key = HKDF.DeriveKey(
                HashAlgorithmName.SHA256,
                sharedSecret,
                32,
                salt,
                Encoding.ASCII.GetBytes(KeyInfo)
            );
            var ciphertextAndTag = DecodeBase64Url(envelope["ciphertext"]!.GetValue<string>());
            var plaintext = DecryptAesGcm(
                key,
                DecodeBase64Url(envelope["nonce"]!.GetValue<string>()),
                ciphertextAndTag,
                Encoding.ASCII.GetBytes(RequestAad)
            );
            Check(
                JsonNode.Parse(plaintext)!["message"]!.GetValue<string>() == "private",
                "Encrypted request content did not decrypt"
            );

            var responsePrivateKey = new byte[32];
            var responsePublicKey = new byte[32];
            X25519.GeneratePrivateKey(new SecureRandom(), responsePrivateKey);
            X25519.GeneratePublicKey(responsePrivateKey, 0, responsePublicKey, 0);
            var responseSalt = RandomNumberGenerator.GetBytes(16);
            var responseNonce = RandomNumberGenerator.GetBytes(12);
            var responseKey = HKDF.DeriveKey(
                HashAlgorithmName.SHA256,
                Agreement(responsePrivateKey, clientPublicKey),
                32,
                responseSalt,
                Encoding.ASCII.GetBytes(KeyInfo)
            );
            var responseCiphertext = EncryptAesGcm(
                responseKey,
                responseNonce,
                Encoding.UTF8.GetBytes("{\"ok\":true}"),
                Encoding.ASCII.GetBytes(ResponseAad)
            );
            return JsonResponse(new JsonObject
            {
                ["aad"] = ResponseAad,
                ["algorithm"] = "X25519-HKDF-SHA256+A256GCM",
                ["ciphertext"] = Base64Url(responseCiphertext),
                ["ephemeral_public_key"] = Base64Url(responsePublicKey),
                ["nonce"] = Base64Url(responseNonce),
                ["salt"] = Base64Url(responseSalt),
                ["version"] = 1
            });
        }

        private static void VerifySignature(HttpRequestMessage request, byte[] body)
        {
            const string secret = "test-signing-secret";
            var headers = request.Headers;
            var canonical = string.Join(
                '\n',
                request.Method.Method.ToUpperInvariant(),
                request.RequestUri!.AbsolutePath,
                headers.GetValues("X-Nathbrok-Timestamp").Single(),
                headers.GetValues("X-Nathbrok-Nonce").Single(),
                Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant()
            );
            var expected = Convert.ToHexString(
                HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(canonical))
            ).ToLowerInvariant();
            Check(headers.GetValues("X-Nathbrok-Signature").Single() == expected, "HMAC did not match");
            Check(headers.GetValues("X-Nathbrok-Server-ID").Single() == "server-id", "Server ID did not match");
        }

        private static HttpResponseMessage JsonResponse(JsonObject payload) => new(HttpStatusCode.OK)
        {
            Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json")
        };

        private static byte[] Agreement(byte[] privateKey, byte[] publicKey)
        {
            var sharedSecret = new byte[32];
            if (!X25519.CalculateAgreement(privateKey, 0, publicKey, 0, sharedSecret, 0))
            {
                throw new CryptographicException("X25519 agreement failed");
            }
            return sharedSecret;
        }

        private static byte[] DecodeBase64Url(string value)
        {
            var base64 = value.Replace('-', '+').Replace('_', '/');
            base64 = base64.PadRight(base64.Length + ((4 - base64.Length % 4) % 4), '=');
            return Convert.FromBase64String(base64);
        }

        private static string Base64Url(byte[] value) =>
            Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        private static byte[] EncryptAesGcm(byte[] key, byte[] iv, byte[] plaintext, byte[] aad)
        {
            var ciphertext = new byte[plaintext.Length];
            var tag = new byte[16];
            using var aes = new AesGcm(key, tag.Length);
            aes.Encrypt(iv, plaintext, ciphertext, tag, aad);
            return [.. ciphertext, .. tag];
        }

        private static byte[] DecryptAesGcm(byte[] key, byte[] iv, byte[] ciphertextAndTag, byte[] aad)
        {
            var plaintext = new byte[ciphertextAndTag.Length - 16];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(
                iv,
                ciphertextAndTag.AsSpan(0, plaintext.Length),
                ciphertextAndTag.AsSpan(plaintext.Length, 16),
                plaintext,
                aad
            );
            return plaintext;
    }
}
