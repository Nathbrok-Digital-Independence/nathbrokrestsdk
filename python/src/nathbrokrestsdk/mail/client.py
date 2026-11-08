import json
from typing import Any
from ..auth import Auth


class MailClient:
    """Send email through the authenticated Nathbrok SDK mail endpoint."""

    def __init__(self, auth: Auth) -> None:
        if not callable(getattr(auth, "authorized_request", None)):
            raise TypeError("auth must provide an authorized_request method")
        self.auth = auth

    def send_email(
        self,
        email_data: dict[str, Any],
        mailbox: str,
        to: str,
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
    ) -> dict[str, Any]:
        """Queue an email from an authorized mailbox to the specified recipients.

        ``email_data`` accepts ``subject`` and either ``body_text``,
        ``body_html``, or both. The legacy ``data`` field is accepted as
        plain-text body content.
        """
        if not isinstance(email_data, dict):
            raise TypeError("email_data must be a dictionary")
        if not isinstance(mailbox, str) or not mailbox.strip():
            raise ValueError("mailbox must be a non-empty email address")
        if not isinstance(to, str) or not to.strip():
            raise ValueError("to must be a non-empty email address")

        cc = [] if cc is None else cc
        bcc = [] if bcc is None else bcc
        self._validate_recipient_list(cc, "cc")
        self._validate_recipient_list(bcc, "bcc")

        subject = email_data.get("subject", "")
        body_text = email_data.get("body_text", email_data.get("data", ""))
        body_html = email_data.get("body_html", "")
        if not isinstance(subject, str):
            raise TypeError("email_data.subject must be a string")
        if "\r" in subject or "\n" in subject:
            raise ValueError("email_data.subject must not contain line breaks")
        if not isinstance(body_text, str) or not isinstance(body_html, str):
            raise TypeError("email_data body fields must be strings")
        if not body_text and not body_html:
            raise ValueError("email_data must contain body_text or body_html")

        payload = {
            "mailbox": mailbox.strip(),
            "to": to.strip(),
            "cc": cc,
            "bcc": bcc,
            "subject": subject,
            "body_text": body_text,
            "body_html": body_html,
        }
        response = self.auth.authorized_request(
            method="POST",
            url=f"{self.auth.base_url.rstrip('/')}/mail/send/",
            data=json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            ),
        )
        return response

    @staticmethod
    def _validate_recipient_list(recipients: list[str], field: str) -> None:
        if not isinstance(recipients, list):
            raise TypeError(f"{field} must be a list of email addresses")
        if not all(isinstance(address, str) and address.strip() for address in recipients):
            raise ValueError(f"{field} entries must be non-empty email addresses")
