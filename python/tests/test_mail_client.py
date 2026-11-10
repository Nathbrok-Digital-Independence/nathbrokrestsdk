import json
import unittest

from nathbrokrestsdk.mail.client import MailClient


class FakeAuth:
    base_url = "https://api-routes.nathbrok.com/sdk/v1/"

    def __init__(self):
        self.calls = []
        self.encrypted_calls = []

    def authorized_request(self, **kwargs):
        self.calls.append(kwargs)
        return {"id": "message-id", "status": "queued"}

    def authorized_encrypted_request(self, **kwargs):
        self.encrypted_calls.append(kwargs)
        return {"id": 42, "status": "created"}


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

    def test_create_mailbox_uses_encrypted_request(self):
        result = self.client.create_mailbox(
            user=" owner@example.test ",
            email=" mailbox@nathbrok.com ",
            authorized_users=["delegate@example.test"],
            password="long-enough-password",
        )

        self.assertEqual(result, {"id": 42, "status": "created"})
        request = self.auth.encrypted_calls[0]
        self.assertEqual(request["method"], "POST")
        self.assertEqual(
            request["url"],
            "https://api-routes.nathbrok.com/sdk/v1/mail/create/",
        )
        self.assertEqual(
            request["json"],
            {
                "email": "mailbox@nathbrok.com",
                "user": "owner@example.test",
                "authorized_users": ["delegate@example.test"],
                "password": "long-enough-password",
            },
        )
        self.assertEqual(self.auth.calls, [])

    def test_invalid_inputs_are_rejected(self):
        with self.assertRaises(ValueError):
            self.client.create_mailbox(user="invalid", email="mailbox@example.test")
        with self.assertRaises(ValueError):
            self.client.create_mailbox(
                user="owner@example.test",
                email="mailbox@example.test",
                password="short",
            )
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
