using System.Net.Http.Headers;
using System.Text.Json.Nodes;

namespace NathbrokRestSdk;

/// <summary>Provides wrappers for Nathbrok's DDE API operations.</summary>
public sealed class DDEClient
{
    private readonly Auth _auth;

    /// <summary>Creates a DDE client using the provided authentication client.</summary>
    public DDEClient(Auth? auth = null)
    {
        _auth = auth ?? new Auth();
    }

    /// <summary>Requests encryption of a local file.</summary>
    public Task<JsonObject> EncryptFileAsync(
        string filePath,
        string? key = null,
        CancellationToken cancellationToken = default
    ) => SendFileAsync(HttpMethod.Post, filePath, cancellationToken, key);

    /// <summary>Requests decryption of a local file.</summary>
    public Task<JsonObject> DecryptFileAsync(
        string filePath,
        string? key = null,
        CancellationToken cancellationToken = default
    ) => SendFileAsync(HttpMethod.Get, filePath, cancellationToken, key);

    /// <summary>Requests encryption of JSON data.</summary>
    public Task<JsonObject> EncryptDataAsync(
        JsonObject data,
        string? key = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(data);
        if (key is null)
        {
            return _auth.AuthorizedRequestAsync(
                HttpMethod.Post,
                $"{_auth.BaseUrl.TrimEnd('/')}/dde/data/",
                data,
                cancellationToken: cancellationToken
            );
        }
        ValidateKey(key);
        return _auth.AuthorizedEncryptedRequestAsync(
            HttpMethod.Post,
            $"{_auth.BaseUrl.TrimEnd('/')}/dde/data/",
            new JsonObject { ["data"] = data.DeepClone(), ["key"] = key },
            cancellationToken: cancellationToken
        );
    }

    /// <summary>Requests decryption of JSON data.</summary>
    public Task<JsonObject> DecryptDataAsync(
        JsonObject data,
        string? key = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(data);
        if (key is null)
        {
            return _auth.AuthorizedRequestAsync(
                HttpMethod.Get,
                $"{_auth.BaseUrl.TrimEnd('/')}/dde/data/",
                data,
                cancellationToken: cancellationToken
            );
        }
        ValidateKey(key);
        return _auth.AuthorizedEncryptedRequestAsync(
            HttpMethod.Get,
            $"{_auth.BaseUrl.TrimEnd('/')}/dde/data/",
            new JsonObject { ["data"] = data["data"]?.DeepClone(), ["key"] = key },
            cancellationToken: cancellationToken
        );
    }

    private async Task<JsonObject> SendFileAsync(
        HttpMethod method,
        string filePath,
        CancellationToken cancellationToken,
        string? key
    )
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new ArgumentException("filePath must be a non-empty path", nameof(filePath));
        }
        var filename = Path.GetFileName(filePath);
        var bytes = await File.ReadAllBytesAsync(filePath, cancellationToken).ConfigureAwait(false);
        var url = $"{_auth.BaseUrl.TrimEnd('/')}/dde/file/";
        if (key is not null)
        {
            ValidateKey(key);
            return await _auth.AuthorizedEncryptedRequestAsync(
                method,
                url,
                new JsonObject
                {
                    ["filename"] = filename,
                    ["content"] = Convert.ToBase64String(bytes),
                    ["key"] = key
                },
                cancellationToken: cancellationToken
            ).ConfigureAwait(false);
        }

        using var multipart = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        multipart.Add(file, "file", filename);
        return await _auth.AuthorizedRequestAsync(
            method,
            url,
            content: multipart,
            cancellationToken: cancellationToken
        ).ConfigureAwait(false);
    }

    private static void ValidateKey(string key)
    {
        if (string.IsNullOrEmpty(key) || key.Length > 4096)
        {
            throw new ArgumentException(
                "key must be a non-empty string of at most 4096 characters",
                nameof(key)
            );
        }
    }
}
