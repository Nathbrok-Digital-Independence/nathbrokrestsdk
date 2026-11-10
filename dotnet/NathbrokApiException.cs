using System.Text.Json.Nodes;

namespace NathbrokRestSdk;

public sealed class NathbrokApiException : Exception
{
    public NathbrokApiException(int statusCode, JsonNode? detail)
        : base($"Nathbrok API returned HTTP {statusCode}: {detail?.ToJsonString() ?? "null"}")
    {
        StatusCode = statusCode;
        Detail = detail?.DeepClone();
    }

    public int StatusCode { get; }
    public JsonNode? Detail { get; }
}
