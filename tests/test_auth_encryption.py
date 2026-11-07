import base64
import hashlib
import hmac
import json
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from institution.server_crypto import encrypt_response
from ..src.nathbrokrestsdk.auth.request import Auth


_KEY_INFO = b"nathbrok-sdk-payload-aes256gcm-v1"
_AAD = b"nathbrok-sdk-encrypted-request-v1"


class FakeResponse:
    status_code = 200
    ok = True

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


class FakeSession(requests.Session):
    def __init__(self, response):
        super().__init__()
        self.response = response
        self.prepared_request = None
        self.post_call = None

    def post(self, url, **kwargs):
        self.post_call = (url, kwargs)
        return self.response

    def send(self, request, **kwargs):
        self.prepared_request = request
        return self.response


def decode_b64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class AuthEncryptionTests(unittest.TestCase):
    def setUp(self):
        private_key = X25519PrivateKey.generate()
        public_key = private_key.public_key().public_bytes(
            serialization.Encoding.Raw,
            serialization.PublicFormat.Raw,
        )
        self.private_key = private_key
        self.auth = Auth(
            "https://api-routes.nathbrok.com",
            server_key=base64.urlsafe_b64encode(public_key)
            .rstrip(b"=")
            .decode("ascii"),
        )

    def test_encrypted_payload_round_trips(self):
        plaintext = b"sample payload " * 100

        encrypted = self.auth.encrypt_data(plaintext)
        envelope = json.loads(encrypted)
        self.assertEqual(envelope["algorithm"], "X25519-HKDF-SHA256+A256GCM")

        ephemeral_public_key = X25519PublicKey.from_public_bytes(
            decode_b64url(envelope["ephemeral_public_key"])
        )
        shared_secret = self.private_key.exchange(ephemeral_public_key)
        aes_key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=decode_b64url(envelope["salt"]),
            info=_KEY_INFO,
        ).derive(shared_secret)
        decrypted = AESGCM(aes_key).decrypt(
            decode_b64url(envelope["nonce"]),
            decode_b64url(envelope["ciphertext"]),
            _AAD,
        )

        self.assertEqual(decrypted, plaintext)

    def test_encrypted_request_decrypts_the_encrypted_response(self):
        client_private_key = X25519PrivateKey.generate()
        response_envelope = json.loads(
            encrypt_response(
                b'{"ok":true}',
                client_private_key.public_key(),
            )
        )
        session = FakeSession(FakeResponse(response_envelope))
        auth = Auth(
            "https://api-routes.nathbrok.com",
            access_key_id="server-id-42",
            secret_key="server-secret",
            server_key=self.auth.server_key,
            session=session,
        )
        request_envelope = json.dumps({"request": True}).encode("utf-8")

        with patch.object(
            auth,
            "_encrypt_data",
            return_value=(request_envelope, client_private_key),
        ):
            result = auth.authorized_encrypted_request(
                "POST",
                "https://api-routes.nathbrok.com/sdk/v1/test/",
                json={"secret": "request"},
            )

        self.assertEqual(result, {"ok": True})
        self.assertEqual(
            session.prepared_request.headers["X-Nathbrok-Encrypted-Request"],
            "true",
        )

    def test_create_sso_url_uses_encrypted_authorized_request(self):
        auth = Auth(
            "https://api-routes.nathbrok.com/sdk/v1",
            access_key_id="server-id-42",
            secret_key="server-secret",
            server_key=self.auth.server_key,
        )
        with patch.object(
            auth,
            "authorized_encrypted_request",
            return_value={"sso_url": "https://auth.example.test/sso/ticket"},
        ) as send_request:
            sso_url = auth.create_sso_url(" owner@example.test ")

        self.assertEqual(sso_url, "https://auth.example.test/sso/ticket")
        send_request.assert_called_once_with(
            "POST",
            "https://api-routes.nathbrok.com/sdk/v1/sso/authorize/",
            json={"email": "owner@example.test"},
        )

    def test_create_sso_url_rejects_empty_email(self):
        with self.assertRaisesRegex(ValueError, "email must be a non-empty string"):
            self.auth.create_sso_url(" ")

    def test_encrypt_data_rejects_invalid_public_key(self):
        auth = Auth("https://api-routes.nathbrok.com", server_key="bad")
        with self.assertRaisesRegex(ValueError, "X25519 public key"):
            auth.encrypt_data(b"payload")

    def test_encrypt_data_requires_bytes(self):
        with self.assertRaisesRegex(TypeError, "data must be bytes"):
            self.auth.encrypt_data("payload")

    def test_initialize_authenticates_and_does_not_send_secret_key(self):
        public_key = self.auth.server_key
        session = FakeSession(FakeResponse({"server_key": public_key}))
        auth = Auth("https://api-routes.nathbrok.com", session=session)

        payload = auth.initialize("server-id-42", "access-secret", "server-secret")

        url, request = session.post_call
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
        expected_signature = hmac.new(
            b"server-secret",
            canonical,
            hashlib.sha256,
        ).hexdigest()

        self.assertEqual(payload["server_key"], public_key)
        self.assertEqual(headers["X-Nathbrok-Signature"], expected_signature)
        self.assertEqual(headers["Authorization"], "Bearer server-id-42")
        self.assertEqual(json.loads(body), {"access_key": "access-secret"})
        self.assertEqual(headers["X-Nathbrok-Server-ID"], "server-id-42")
        self.assertNotIn("server-secret", body.decode("utf-8"))
        self.assertNotIn("X-Nathbrok-Secret-Key", headers)
        self.assertEqual(
            url,
            "https://api-routes.nathbrok.com/sdk/v1/initialize/",
        )

    def test_initialize_does_not_duplicate_sdk_base_path(self):
        public_key = self.auth.server_key
        session = FakeSession(FakeResponse({"server_key": public_key}))
        auth = Auth(
            "https://api-routes.nathbrok.com/sdk/v1",
            session=session,
        )

        auth.initialize("server-id-42", "access-secret", "server-secret")

        self.assertEqual(
            session.post_call[0],
            "https://api-routes.nathbrok.com/sdk/v1/initialize/",
        )

    def test_authorized_request_signs_the_exact_json_body(self):
        session = FakeSession(FakeResponse({"ok": True}))
        auth = Auth(
            "https://api-routes.nathbrok.com",
            access_key_id="server-id-42",
            access_key="server-42",
            secret_key="server-secret",
            session=session,
        )

        result = auth.authorized_request(
            "POST",
            "https://api-routes.nathbrok.com/messages/",
            data={"content": "encrypted", "room_id": 7},
        )

        prepared = session.prepared_request
        body = prepared.body.encode("utf-8") if isinstance(prepared.body, str) else prepared.body
        canonical = "\n".join(
            (
                "POST",
                urlsplit(prepared.url).path,
                prepared.headers["X-Nathbrok-Timestamp"],
                prepared.headers["X-Nathbrok-Nonce"],
                hashlib.sha256(body).hexdigest(),
            )
        ).encode("utf-8")
        expected_signature = hmac.new(
            b"server-secret",
            canonical,
            hashlib.sha256,
        ).hexdigest()

        self.assertEqual(result, {"ok": True})
        self.assertEqual(prepared.headers["X-Nathbrok-Signature"], expected_signature)
        self.assertEqual(json.loads(body), {"content": "encrypted", "room_id": 7})
        self.assertEqual(prepared.headers["Content-Type"], "application/json")

    def test_authorized_request_accepts_legacy_body_keyword(self):
        session = FakeSession(FakeResponse({"ok": True}))
        auth = Auth(
            "https://api-routes.nathbrok.com",
            access_key_id="server-id-42",
            access_key="server-42",
            secret_key="server-secret",
            session=session,
        )

        auth.authorized_request(
            "POST",
            "https://api-routes.nathbrok.com/dde/data/",
            body={"value": "test"},
        )

        prepared = session.prepared_request
        self.assertEqual(json.loads(prepared.body), {"value": "test"})


if __name__ == "__main__":
    unittest.main()
