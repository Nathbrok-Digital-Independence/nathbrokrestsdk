using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace NathbrokRestSdk;

public sealed class CloudClient
{
    private readonly Auth _auth;

    public CloudClient(Auth? auth = null)
    {
        _auth = auth ?? new Auth();
    }

    public async Task<JsonObject> UploadFileAsync(
        string bucketId,
        string filePath,
        int? folderId = null,
        CancellationToken cancellationToken = default
    )
    {
        if (string.IsNullOrWhiteSpace(bucketId))
        {
            throw new ArgumentException("bucketId must be a non-empty string", nameof(bucketId));
        }
        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new ArgumentException("filePath must be a non-empty path", nameof(filePath));
        }
        var filename = Path.GetFileName(filePath);
        if (string.IsNullOrEmpty(filename))
        {
            throw new ArgumentException("filePath must include a filename", nameof(filePath));
        }
        var content = await File.ReadAllBytesAsync(filePath, cancellationToken).ConfigureAwait(false);
        using var multipart = new MultipartFormDataContent();
        multipart.Add(new StringContent(bucketId), "bucket_id");
        if (folderId is not null)
        {
            multipart.Add(new StringContent(folderId.Value.ToString()), "folder_id");
        }
        var fileContent = new ByteArrayContent(content);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        multipart.Add(fileContent, "file", filename);
        return await _auth.AuthorizedRequestAsync(
            HttpMethod.Post,
            $"{_auth.BaseUrl.TrimEnd('/')}/buckets/{Uri.EscapeDataString(bucketId)}/files/",
            content: multipart,
            cancellationToken: cancellationToken
        ).ConfigureAwait(false);
    }

    public Task<JsonObject> DeleteFileAsync(int fileId, CancellationToken cancellationToken = default)
    {
        ChatCryptoClient.ValidateRoomId(fileId, nameof(fileId));
        return _auth.AuthorizedRequestAsync(
            HttpMethod.Delete,
            $"{_auth.BaseUrl.TrimEnd('/')}/files/",
            new JsonObject { ["file_id"] = fileId },
            cancellationToken: cancellationToken
        );
    }

    public Task<JsonObject> GenerateFileDownloadLinkAsync(
        int fileId,
        CancellationToken cancellationToken = default
    )
    {
        ChatCryptoClient.ValidateRoomId(fileId, nameof(fileId));
        return _auth.AuthorizedRequestAsync(
            HttpMethod.Get,
            $"{_auth.BaseUrl.TrimEnd('/')}/files/download/",
            new JsonObject { ["file_id"] = fileId },
            cancellationToken: cancellationToken
        );
    }

    public Task<JsonObject> CreateBucketAsync(
        long quota,
        string name,
        CancellationToken cancellationToken = default
    )
    {
        if (quota < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(quota), "quota must not be negative");
        }
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("name must be a non-empty string", nameof(name));
        }
        return _auth.AuthorizedRequestAsync(
            HttpMethod.Post,
            $"{_auth.BaseUrl.TrimEnd('/')}/buckets/",
            new JsonObject { ["qouta"] = quota, ["name"] = name },
            cancellationToken: cancellationToken
        );
    }

    public Task<JsonObject> DeleteBucketAsync(
        string bucketId,
        CancellationToken cancellationToken = default
    )
    {
        if (string.IsNullOrWhiteSpace(bucketId))
        {
            throw new ArgumentException("bucketId must be a non-empty string", nameof(bucketId));
        }
        return _auth.AuthorizedRequestAsync(
            HttpMethod.Delete,
            $"{_auth.BaseUrl.TrimEnd('/')}/buckets/",
            new JsonObject { ["bucket_id"] = bucketId },
            cancellationToken: cancellationToken
        );
    }
}
