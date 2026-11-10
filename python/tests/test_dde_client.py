import base64
import tempfile
import unittest
from pathlib import Path

from nathbrokrestsdk.dde import DDEClient


class FakeAuth:
    base_url = "https://api-routes.example.test/sdk/v1"

    def __init__(self):
        self.calls = []

    def authorized_request(self, method, url, **kwargs):
        self.calls.append(("signed", method, url, kwargs))
        return {"ok": True}

    def authorized_encrypted_request(self, method, url, **kwargs):
        self.calls.append(("encrypted", method, url, kwargs))
        return {"ok": True}


class DDEClientTests(unittest.TestCase):
    def test_custom_key_uses_encrypted_requests_for_data_and_files(self):
        auth = FakeAuth()
        client = DDEClient(auth)
        key = "user-only-secret"

        client.encrypt_data({"message": "secret"}, key=key)
        mode, method, url, kwargs = auth.calls[-1]
        self.assertEqual(mode, "encrypted")
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/dde/data/"))
        self.assertEqual(
            kwargs["json"],
            {"data": {"message": "secret"}, "key": key},
        )

        client.decrypt_data({"data": "ciphertext"}, key=key)
        mode, method, _, kwargs = auth.calls[-1]
        self.assertEqual((mode, method), ("encrypted", "GET"))
        self.assertEqual(kwargs["json"], {"data": "ciphertext", "key": key})

        content = b"\x00DDE file\xff"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.bin"
            path.write_bytes(content)
            client.encrypt_file(str(path), key=key)
            mode, method, url, kwargs = auth.calls[-1]
            self.assertEqual((mode, method), ("encrypted", "POST"))
            self.assertTrue(url.endswith("/dde/file/"))
            self.assertEqual(
                kwargs["json"],
                {
                    "filename": "sample.bin",
                    "content": base64.b64encode(content).decode("ascii"),
                    "key": key,
                },
            )
            self.assertEqual(path.read_bytes(), content)

            client.decrypt_file(str(path), key=key)
            mode, method, _, kwargs = auth.calls[-1]
            self.assertEqual((mode, method), ("encrypted", "GET"))
            self.assertEqual(kwargs["json"]["key"], key)

    def test_default_key_operations_use_signed_requests(self):
        auth = FakeAuth()
        client = DDEClient(auth)

        client.encrypt_data({"message": "default"})

        self.assertEqual(auth.calls[0][0], "signed")
        self.assertEqual(auth.calls[0][1], "POST")


if __name__ == "__main__":
    unittest.main()
