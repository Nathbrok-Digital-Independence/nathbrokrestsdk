using System.Net.Http.Headers;
using System.Text.Json.Nodes;

namespace NathbrokRestSdk;

public sealed class DDEClient
{
    private readonly Auth _auth;

    public DDEClient(Auth? auth = null)
    {
        _auth = auth ?? new Auth();
    }

    public Task<JsonObject> EncryptFileAsync(
        string filePath,
        CancellationToken cancellationToken = default
    ) => SendFileAsync(HttpMethod.Post, filePath, cancellationToken);

    public Task<JsonObject> DecryptFileAsync(
        string filePath,
        CancellationToken cancellationToken = default
    ) => SendFileAsync(HttpMethod.Get, filePath, cancellationToken);

    public Task<JsonObject> EncryptDataAsync(
        JsonObject data,
        CancellationToken cancellationToken = default
    ) => _auth.AuthorizedRequestAsync(
        HttpMethod.Post,
        $"{_auth.BaseUrl.TrimEnd('/')}/dde/data/",
        data,
        cancellationToken: cancellationToken
    );

    public Task<JsonObject> DecryptDataAsync(
        JsonObject data,
        CancellationToken cancellationToken = default
    ) => _auth.AuthorizedRequestAsync(
        HttpMethod.Get,
        $"{_auth.BaseUrl.TrimEnd('/')}/dde/data/",
        data,
        cancellationToken: cancellationToken
    );

    private async Task<JsonObject> SendFileAsync(
        HttpMethod method,
        string filePath,
        CancellationToken cancellationToken
    )
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new ArgumentException("filePath must be a non-empty path", nameof(filePath));
        }
        var filename = Path.GetFileName(filePath);
        var bytes = await File.ReadAllBytesAsync(filePath, cancellationToken).ConfigureAwait(false);
        using var multipart = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        multipart.Add(file, "file", filename);
        return await _auth.AuthorizedRequestAsync(
            method,
            $"{_auth.BaseUrl.TrimEnd('/')}/dde/file/",
            content: multipart,
            cancellationToken: cancellationToken
        ).ConfigureAwait(false);
    }
}
