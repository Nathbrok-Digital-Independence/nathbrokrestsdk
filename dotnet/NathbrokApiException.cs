using System.Text.Json.Nodes;

namespace NathbrokRestSdk;

/// <summary>Represents an unsuccessful response from the Nathbrok API.</summary>
public sealed class NathbrokApiException : Exception
{
    /// <summary>Creates an exception for an unsuccessful Nathbrok API response.</summary>
    public NathbrokApiException(int statusCode, JsonNode? detail)
        : base($"Nathbrok API returned HTTP {statusCode}: {detail?.ToJsonString() ?? "null"}")
    {
        StatusCode = statusCode;
        Detail = detail?.DeepClone();
    }

    /// <summary>Gets the HTTP status code returned by the API.</summary>
    public int StatusCode { get; }
    /// <summary>Gets the response detail returned by the API, if available.</summary>
    public JsonNode? Detail { get; }
}
