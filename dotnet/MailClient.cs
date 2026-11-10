using System.Text.Json.Nodes;

namespace NathbrokRestSdk;

public sealed class MailClient
{
    private readonly Auth _auth;

    public MailClient(Auth auth)
    {
        _auth = auth ?? throw new ArgumentNullException(nameof(auth));
    }

    public Task<JsonObject> SendEmailAsync(
        JsonObject emailData,
        string mailbox,
        string to,
        IReadOnlyList<string>? cc = null,
        IReadOnlyList<string>? bcc = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(emailData);
        if (string.IsNullOrWhiteSpace(mailbox))
        {
            throw new ArgumentException("mailbox must be a non-empty email address", nameof(mailbox));
        }
        if (string.IsNullOrWhiteSpace(to))
        {
            throw new ArgumentException("to must be a non-empty email address", nameof(to));
        }
        ValidateRecipients(cc, "cc");
        ValidateRecipients(bcc, "bcc");

        var subject = emailData["subject"]?.GetValue<string>() ?? "";
        var bodyText = emailData["body_text"]?.GetValue<string>()
            ?? emailData["data"]?.GetValue<string>()
            ?? "";
        var bodyHtml = emailData["body_html"]?.GetValue<string>() ?? "";
        if (subject.Contains('\r') || subject.Contains('\n'))
        {
            throw new ArgumentException("emailData.subject must not contain line breaks");
        }
        if (bodyText.Length == 0 && bodyHtml.Length == 0)
        {
            throw new ArgumentException("emailData must contain body_text or body_html");
        }

        return _auth.AuthorizedRequestAsync(
            HttpMethod.Post,
            $"{_auth.BaseUrl.TrimEnd('/')}/mail/send/",
            new JsonObject
            {
                ["mailbox"] = mailbox.Trim(),
                ["to"] = to.Trim(),
                ["cc"] = ToJsonArray(cc),
                ["bcc"] = ToJsonArray(bcc),
                ["subject"] = subject,
                ["body_text"] = bodyText,
                ["body_html"] = bodyHtml
            },
            cancellationToken: cancellationToken
        );
    }

    private static void ValidateRecipients(IReadOnlyList<string>? recipients, string field)
    {
        if (recipients is not null && recipients.Any(string.IsNullOrWhiteSpace))
        {
            throw new ArgumentException($"{field} entries must be non-empty email addresses", field);
        }
    }

    private static JsonArray ToJsonArray(IReadOnlyList<string>? values)
    {
        var result = new JsonArray();
        if (values is not null)
        {
            foreach (var value in values)
            {
                result.Add(value);
            }
        }
        return result;
    }
}
