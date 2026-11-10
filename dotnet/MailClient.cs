using System.Net.Mail;
using System.Text.Json.Nodes;

namespace NathbrokRestSdk;

/// <summary>Sends email through an authorized Nathbrok mailbox.</summary>
public sealed class MailClient
{
    private readonly Auth _auth;

    /// <summary>Creates a mail client using the provided authentication client.</summary>
    public MailClient(Auth auth)
    {
        _auth = auth ?? throw new ArgumentNullException(nameof(auth));
    }

    /// <summary>Creates a mailbox for a linked user using an encrypted request.</summary>
    public Task<JsonObject> CreateMailboxAsync(
        string user,
        string email,
        IReadOnlyList<string>? authorizedUsers = null,
        string? password = null,
        CancellationToken cancellationToken = default
    )
    {
        var mailboxUser = ValidateEmail(user, nameof(user));
        var mailboxEmail = ValidateEmail(email, nameof(email));
        var authorizedAddresses = new JsonArray();
        if (authorizedUsers is not null)
        {
            foreach (var address in authorizedUsers)
            {
                authorizedAddresses.Add(ValidateEmail(address, "authorizedUsers entry"));
            }
        }
        if (
            password is not null
            && (string.IsNullOrWhiteSpace(password) || password.Length < 12 || password.Length > 1024)
        )
        {
            throw new ArgumentException(
                "password must be between 12 and 1024 characters",
                nameof(password)
            );
        }

        return _auth.AuthorizedEncryptedRequestAsync(
            HttpMethod.Post,
            $"{_auth.BaseUrl.TrimEnd('/')}/mail/create/",
            new JsonObject
            {
                ["email"] = mailboxEmail,
                ["user"] = mailboxUser,
                ["authorized_users"] = authorizedAddresses,
                ["password"] = password
            },
            cancellationToken: cancellationToken
        );
    }

    /// <summary>Sends an email through an authorized Nathbrok mailbox.</summary>
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

    private static string ValidateEmail(string value, string field)
    {
        var normalized = value?.Trim();
        if (
            string.IsNullOrEmpty(normalized)
            || !MailAddress.TryCreate(normalized, out var address)
            || !string.Equals(address.Address, normalized, StringComparison.OrdinalIgnoreCase)
        )
        {
            throw new ArgumentException($"{field} must be a valid email address", field);
        }
        return normalized;
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
