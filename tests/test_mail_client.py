import json
import unittest

from ..src.nathbrokrestsdk.mail.client import MailClient


class FakeAuth:
    base_url = "https://api-routes.nathbrok.com/sdk/v1/"

    def __init__(self):
        self.calls = []

    def authorized_request(self, **kwargs):
        self.calls.append(kwargs)
        return {"id": "message-id", "status": "queued"}


class MailClientTests(unittest.TestCase):
    def setUp(self):
        self.auth = FakeAuth()
        self.client = MailClient(self.auth)

    def test_send_email_posts_supported_mail_fields(self):
        response = self.client.send_email(
            {
                "subject": "Monthly report",
                "body_text": "The report is attached.",
                "body_html": "<p>The report is attached.</p>",
            },
            mailbox="sender@example.com",
            to="recipient@example.com",
            cc=["copy@example.com"],
            bcc=["hidden@example.com"],
        )

        self.assertEqual(response, {"id": "message-id", "status": "queued"})
        request = self.auth.calls[0]
        self.assertEqual(request["method"], "POST")
        self.assertEqual(
            request["url"],
            "https://api-routes.nathbrok.com/sdk/v1/mail/send/",
        )
        self.assertEqual(
            json.loads(request["data"]),
            {
                "mailbox": "sender@example.com",
                "to": "recipient@example.com",
                "cc": ["copy@example.com"],
                "bcc": ["hidden@example.com"],
                "subject": "Monthly report",
                "body_text": "The report is attached.",
                "body_html": "<p>The report is attached.</p>",
            },
        )

    def test_legacy_data_is_sent_as_plain_text(self):
        self.client.send_email(
            {"data": "Plain-text body"},
            mailbox="sender@example.com",
            to="recipient@example.com",
        )

        payload = json.loads(self.auth.calls[0]["data"])
        self.assertEqual(payload["body_text"], "Plain-text body")
        self.assertEqual(payload["body_html"], "")
        self.assertEqual(payload["cc"], [])
        self.assertEqual(payload["bcc"], [])

    def test_invalid_inputs_are_rejected(self):
        with self.assertRaises(ValueError):
            self.client.send_email(
                {"data": "body"},
                mailbox="sender@example.com",
                to="",
            )
        with self.assertRaises(ValueError):
            self.client.send_email(
                {"subject": "bad\nsubject", "data": "body"},
                mailbox="sender@example.com",
                to="recipient@example.com",
            )
        with self.assertRaises(TypeError):
            self.client.send_email(
                {"data": "body"},
                mailbox="sender@example.com",
                to="recipient@example.com",
                cc="not-a-list",
            )


if __name__ == "__main__":
    unittest.main()
