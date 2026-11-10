using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NathbrokRestSdk;

public sealed class Auth : IDisposable
{
    public const string DefaultBaseUrl = "https://api-routes.nathbrok.com/sdk/v1";
    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;

    public Auth(
        string baseUrl = DefaultBaseUrl,
        string? accessKeyId = null,
        string? accessKey = null,
        string? secretKey = null,
        TimeSpan? timeout = null,
        HttpClient? httpClient = null,
        string? serverKey = null
    )
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https")
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment))
        {
            throw new ArgumentException("baseUrl must be an absolute HTTP(S) URL without a query or fragment", nameof(baseUrl));
        }
        if (uri.Scheme != Uri.UriSchemeHttps && uri.Host is not ("localhost" or "127.0.0.1" or "::1"))
        {
            throw new ArgumentException("HTTPS is required except when using localhost", nameof(baseUrl));
        }

        BaseUrl = baseUrl.TrimEnd('/');
        AccessKeyId = accessKeyId;
        AccessKey = accessKey;
        SecretKey = secretKey;
        ServerKey = serverKey;
        Timeout = timeout ?? TimeSpan.FromSeconds(15);
        if (Timeout <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(timeout), "timeout must be positive");
        }

        _httpClient = httpClient ?? new HttpClient { Timeout = Timeout };
        _ownsHttpClient = httpClient is null;
    }

    public string BaseUrl { get; }
    public string? AccessKeyId { get; private set; }
    public string? AccessKey { get; private set; }
    public string? SecretKey { get; private set; }
    public string? ServerKey { get; private set; }
    public string? ServerUser { get; private set; }
    public TimeSpan Timeout { get; }

    public (string Signature, string Timestamp, string Nonce) GenerateSignature(
        HttpMethod method,
        Uri url,
        byte[] body
    )
    {
        if (string.IsNullOrEmpty(SecretKey))
        {
            throw new InvalidOperationException("secretKey is required to sign requests");
        }
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
        var bodyHash = Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant();
        var canonical = string.Join(
            '\n',
            method.Method.ToUpperInvariant(),
            url.AbsolutePath,
            timestamp,
            nonce,
            bodyHash
        );
        var signature = Convert.ToHexString(
            HMACSHA256.HashData(Encoding.UTF8.GetBytes(SecretKey), Encoding.UTF8.GetBytes(canonical))
        ).ToLowerInvariant();
        return (signature, timestamp, nonce);
    }

    public async Task<JsonObject> InitializeAsync(
        string accessKeyId,
        string accessKey,
        string secretKey,
        CancellationToken cancellationToken = default
    )
    {
        if (string.IsNullOrWhiteSpace(accessKeyId)
            || string.IsNullOrWhiteSpace(accessKey)
            || string.IsNullOrWhiteSpace(secretKey))
        {
            throw new ArgumentException("accessKeyId, accessKey, and secretKey are required");
        }
        AccessKeyId = accessKeyId;
        AccessKey = accessKey;
        SecretKey = secretKey;

        var basePath = new Uri(BaseUrl).AbsolutePath.TrimEnd('/');
        var path = basePath.EndsWith("/sdk/v1", StringComparison.Ordinal)
            ? $"{BaseUrl}/initialize/"
            : $"{BaseUrl}/sdk/v1/initialize/";
        var body = SerializeCanonicalJson(new JsonObject { ["access_key"] = accessKey });
        var payload = await SendSignedAsync(
            HttpMethod.Post,
            new Uri(path),
            body,
            "application/json",
            encrypted: false,
            responsePrivateKey: null,
            cancellationToken
        ).ConfigureAwait(false);

        var publicKey = payload["server_key"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(publicKey))
        {
            throw new NathbrokApiException(200, JsonValue.Create("Missing server_key in response"));
        }
        var keyBytes = ProtocolCrypto.DecodeBase64Url(publicKey, "server_key");
        if (keyBytes.Length != 32)
        {
            throw new ArgumentException("server_key must contain a 32-byte X25519 public key");
        }
        ServerKey = publicKey;
        ServerUser = payload["server_user"]?.GetValue<string>();
        return payload;
    }

    public async Task<JsonObject> AuthorizedRequestAsync(
        HttpMethod method,
        string url,
        JsonNode? json = null,
        HttpContent? content = null,
        IReadOnlyDictionary<string, string>? headers = null,
        CancellationToken cancellationToken = default
    )
    {
        RequireInitialized(encrypted: false);
        if (json is not null && content is not null)
        {
            throw new ArgumentException("Provide either json or content, not both");
        }
        var body = json is not null
            ? SerializeCanonicalJson(json)
            : content is null
                ? Array.Empty<byte>()
                : await content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
        var contentType = json is not null
            ? "application/json"
            : content?.Headers.ContentType?.ToString();
        return await SendSignedAsync(
            method,
            new Uri(url, UriKind.Absolute),
            body,
            contentType,
            encrypted: false,
            responsePrivateKey: null,
            cancellationToken,
            headers
        ).ConfigureAwait(false);
    }

    public Task<JsonObject> AuthorizedEncryptedRequestAsync(
        HttpMethod method,
        string url,
        JsonNode? json = null,
        byte[]? body = null,
        CancellationToken cancellationToken = default
    )
    {
        RequireInitialized(encrypted: true);
        if (json is not null && body is not null)
        {
            throw new ArgumentException("Provide either json or body, not both");
        }
        var plaintext = json is not null
            ? SerializeCanonicalJson(json)
            : body ?? Array.Empty<byte>();
        var encryptedRequest = ProtocolCrypto.EncryptRequest(ServerKey!, plaintext);
        return SendSignedAsync(
            method,
            new Uri(url, UriKind.Absolute),
            encryptedRequest.Body,
            "application/json",
            encrypted: true,
            encryptedRequest.EphemeralPrivateKey,
            cancellationToken
        );
    }

    public async Task<string> CreateSsoUrlAsync(string email, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            throw new ArgumentException("email must be a non-empty string", nameof(email));
        }
        var payload = await AuthorizedEncryptedRequestAsync(
            HttpMethod.Post,
            $"{BaseUrl}/sso/authorize/",
            new JsonObject { ["email"] = email.Trim() },
            cancellationToken: cancellationToken
        ).ConfigureAwait(false);
        var ssoUrl = payload["sso_url"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(ssoUrl))
        {
            throw new NathbrokApiException(200, JsonValue.Create("Missing sso_url in response"));
        }
        return ssoUrl;
    }

    public byte[] EncryptData(byte[] data)
    {
        if (string.IsNullOrWhiteSpace(ServerKey))
        {
            throw new InvalidOperationException("Server key is not set. Call InitializeAsync() first.");
        }
        return ProtocolCrypto.EncryptRequest(ServerKey!, data).Body;
    }

    internal static byte[] SerializeCanonicalJson(JsonNode node)
    {
        var canonical = SortJson(node);
        return JsonSerializer.SerializeToUtf8Bytes(canonical);
    }

    private static JsonNode? SortJson(JsonNode? node)
    {
        if (node is JsonObject objectNode)
        {
            var sorted = new JsonObject();
            foreach (var item in objectNode.OrderBy(item => item.Key, StringComparer.Ordinal))
            {
                sorted[item.Key] = SortJson(item.Value);
            }
            return sorted;
        }
        if (node is JsonArray arrayNode)
        {
            var sorted = new JsonArray();
            foreach (var item in arrayNode)
            {
                sorted.Add(SortJson(item));
            }
            return sorted;
        }
        return node?.DeepClone();
    }

    private void RequireInitialized(bool encrypted)
    {
        if (string.IsNullOrWhiteSpace(AccessKeyId) || string.IsNullOrWhiteSpace(SecretKey))
        {
            throw new InvalidOperationException("Auth is not initialized. Call InitializeAsync() first.");
        }
        if (encrypted && string.IsNullOrWhiteSpace(ServerKey))
        {
            throw new InvalidOperationException("Server encryption key is missing. Call InitializeAsync() first.");
        }
    }

    private async Task<JsonObject> SendSignedAsync(
        HttpMethod method,
        Uri url,
        byte[] body,
        string? contentType,
        bool encrypted,
        byte[]? responsePrivateKey,
        CancellationToken cancellationToken,
        IReadOnlyDictionary<string, string>? extraHeaders = null
    )
    {
        var (signature, timestamp, nonce) = GenerateSignature(method, url, body);
        using var request = new HttpRequestMessage(method, url);
        request.Headers.TryAddWithoutValidation("Authorization", "******");
        request.Headers.TryAddWithoutValidation("X-Nathbrok-Server-ID", AccessKeyId);
        request.Headers.TryAddWithoutValidation("X-Nathbrok-Signature", signature);
        request.Headers.TryAddWithoutValidation("X-Nathbrok-Timestamp", timestamp);
        request.Headers.TryAddWithoutValidation("X-Nathbrok-Nonce", nonce);
        request.Headers.TryAddWithoutValidation("X-Nathbrok-Encrypted-Request", encrypted ? "true" : "false");
        if (extraHeaders is not null)
        {
            foreach (var header in extraHeaders)
            {
                request.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }
        }
        if (body.Length > 0 || method != HttpMethod.Get)
        {
            request.Content = new ByteArrayContent(body);
            if (!string.IsNullOrWhiteSpace(contentType))
            {
                request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
            }
        }

        using var response = await _httpClient.SendAsync(
            request,
            HttpCompletionOption.ResponseContentRead,
            cancellationToken
        ).ConfigureAwait(false);
        var responseBody = await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
        JsonNode? decoded;
        try
        {
            decoded = JsonNode.Parse(responseBody);
            if (responsePrivateKey is not null)
            {
                if (decoded is not JsonObject envelope)
                {
                    throw new JsonException("Encrypted response must be an object");
                }
                decoded = JsonNode.Parse(ProtocolCrypto.DecryptResponse(envelope, responsePrivateKey));
            }
        }
        catch (Exception exception) when (
            exception is JsonException
            or CryptographicException
            or ArgumentException
            or InvalidOperationException
        )
        {
            throw new NathbrokApiException(
                (int)response.StatusCode,
                JsonValue.Create("Response body was not valid JSON or could not be decrypted")
            );
        }

        if (!response.IsSuccessStatusCode)
        {
            throw new NathbrokApiException((int)response.StatusCode, decoded);
        }
        if (decoded is not JsonObject payload)
        {
            throw new NathbrokApiException((int)response.StatusCode, JsonValue.Create("Expected a JSON object"));
        }
        return payload;
    }

    public void Dispose()
    {
        if (_ownsHttpClient)
        {
            _httpClient.Dispose();
        }
    }
}
