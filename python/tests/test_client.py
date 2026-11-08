import hashlib
import hmac
import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlsplit

from ..src.nathbrokrestsdk.auth import NathbrokAPIError, NathbrokClient


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code
        self.ok = status_code < 400

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


class NathbrokClientTests(unittest.TestCase):
    def test_sso_request_uses_documented_hmac_canonicalization(self):
        session = FakeSession(FakeResponse({"sso_url": "https://example.test/ticket"}))
        client = NathbrokClient(
            "https://api-routes.nathbrok.com",
            server_id=17,
            server_key="server-secret",
            session=session,
        )

        self.assertEqual(
            client.create_sso_url("user@example.test"),
            "https://example.test/ticket",
        )
        url, request = session.calls[0]
        body = request["data"]
        headers = request["headers"]
        canonical = "\n".join(
            (
                "POST",
                urlsplit(url).path,
                headers["X-Nathbrok-Timestamp"],
                headers["X-Nathbrok-Nonce"],
                hashlib.sha256(body).hexdigest(),
            )
        ).encode("utf-8")
        expected = hmac.new(
            b"server-secret",
            canonical,
            hashlib.sha256,
        ).hexdigest()

        self.assertEqual(headers["X-Nathbrok-Server-ID"], "17")
        self.assertEqual(headers["X-Nathbrok-Signature"], expected)
        self.assertEqual(json.loads(body), {"email": "user@example.test"})

    def test_upload_file_sends_bearer_token_and_file(self):
        session = FakeSession(FakeResponse({"id": "file-1", "name": "report.txt"}))
        client = NathbrokClient(
            "https://api-routes.nathbrok.com",
            access_token="access-token",
            session=session,
        )

        with tempfile.TemporaryDirectory() as directory:
            file_path = Path(directory) / "report.txt"
            file_path.write_text("test data", encoding="utf-8")
            result = client.upload_file("bucket-1", file_path, folder_id=3)

        self.assertEqual(result["id"], "file-1")
        _, request = session.calls[0]
        self.assertEqual(request["headers"]["Authorization"], "Bearer access-token")
        self.assertEqual(request["data"], {"folder_id": "3"})
        self.assertEqual(request["files"]["file"][0], "report.txt")

    def test_send_message_uses_access_token_and_key_version(self):
        session = FakeSession(FakeResponse({"id": 9}))
        client = NathbrokClient(
            "https://api-routes.nathbrok.com",
            access_token="access-token",
            session=session,
        )

        self.assertEqual(
            client.send_message(5, "encrypted-content", key_version=2),
            {"id": 9},
        )
        _, request = session.calls[0]
        self.assertEqual(request["headers"]["Authorization"], "Bearer access-token")
        self.assertEqual(
            request["json"],
            {"room_id": 5, "content": "encrypted-content", "key_version": 2},
        )

    def test_api_errors_are_raised(self):
        client = NathbrokClient(
            "https://api-routes.nathbrok.com",
            access_token="access-token",
            session=FakeSession(FakeResponse({"detail": "denied"}, status_code=403)),
        )

        with self.assertRaises(NathbrokAPIError) as error:
            client.send_message(5, "payload", key_version=1)

        self.assertEqual(error.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
