import base64
import json
import secrets
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from ..src.nathbrokrestsdk.chat.crypto import ChatCryptoClient
from ..src.nathbrokrestsdk.chat.client import ChatClient


class FakeAuth:
    base_url = "https://api-routes.example.test/sdk/v1"
    server_user = "creator@nathlink"

    def __init__(self):
        self.calls = []
        self.response = {}
        self.user_keys = {}

    def authorized_encrypted_request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        payload = kwargs.get("json", {})
        if url.endswith("/chat/keys/"):
            return {
                "user_id": self.user_keys[payload["user"]]["user_id"],
                "key_material": self.user_keys[payload["user"]],
            }
        if url.endswith("/chat/rooms/"):
            return {
                "room_id": 25,
                "key_version_id": 4,
                "participant_ids": [
                    envelope["recipient_id"]
                    for envelope in payload["envelopes"]
                ],
            }
        if url.endswith("/chat/messages/"):
            return {"id": 91, **payload}
        return self.response


class ChatCryptoClientTests(unittest.TestCase):
    def setUp(self):
        self.auth = FakeAuth()
        self.client = ChatCryptoClient(self.auth)

    @staticmethod
    def _create_key_material(passphrase):
        private_key = ec.generate_private_key(ec.SECP256R1())
        private_key_der = private_key.private_bytes(
            serialization.Encoding.DER,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        salt = secrets.token_bytes(32)
        iv = secrets.token_bytes(12)
        iterations = 100_000
        wrapping_key = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=iterations,
        ).derive(passphrase.encode("utf-8"))
        encrypted_private_key = AESGCM(wrapping_key).encrypt(
            iv,
            private_key_der,
            None,
        )
        public_key = private_key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        material = {
            "public_key": base64.b64encode(public_key).decode("ascii"),
            "encrypted_private_key": base64.b64encode(
                encrypted_private_key
            ).decode("ascii"),
            "salt": base64.b64encode(salt).decode("ascii"),
            "iv": base64.b64encode(iv).decode("ascii"),
            "pbkdf2_iterations": iterations,
            "version": "v1",
        }
        return private_key, material

    def test_fetch_methods_use_encrypted_sdk_endpoint(self):
        self.auth.response = {
            "user_id": 7,
            "key_material": {"version": "v1"},
        }
        key_material = self.client.fetch_user_key_material("person@example.test")
        self.assertEqual(key_material, {"version": "v1", "user_id": 7})

        self.auth.response = {"envelope": {"version": 3}}
        envelope = self.client.fetch_room_envelope(42, "person@nathlink")
        self.assertEqual(envelope, {"version": 3})

        self.assertEqual(
            self.auth.calls[0],
            (
                "POST",
                "https://api-routes.example.test/sdk/v1/chat/keys/",
                {"json": {"user": "person@example.test"}},
            ),
        )
        self.assertEqual(
            self.auth.calls[1][2]["json"],
            {"user": "person@nathlink", "room_id": 42},
        )

    def test_unlock_decrypt_envelope_and_encrypt_messages(self):
        passphrase = "test passphrase"
        private_key, key_material = self._create_key_material(passphrase)
        unlocked_key = self.client.unlock_user_key(passphrase, key_material)
        self.assertEqual(
            unlocked_key.private_numbers(),
            private_key.private_numbers(),
        )

        room_key = secrets.token_bytes(32)
        ephemeral_key = ec.generate_private_key(ec.SECP256R1())
        shared_secret = ephemeral_key.exchange(
            ec.ECDH(),
            unlocked_key.public_key(),
        )
        envelope_iv = secrets.token_bytes(12)
        encrypted_room_key = AESGCM(shared_secret).encrypt(
            envelope_iv,
            room_key,
            None,
        )
        sender_public_key = ephemeral_key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        envelope = {
            "room_key": base64.b64encode(encrypted_room_key).decode("ascii"),
            "iv": base64.b64encode(envelope_iv).decode("ascii"),
            "sender_public_key": base64.b64encode(sender_public_key).decode("ascii"),
        }

        decrypted_room_key = self.client.decrypt_room_envelope(
            envelope,
            unlocked_key,
        )
        encrypted_message = self.client.encrypt_message(
            "message text",
            decrypted_room_key,
        )
        self.assertEqual(
            self.client.decrypt_message(encrypted_message, decrypted_room_key),
            "message text",
        )

    def test_unlock_rejects_wrong_passphrase(self):
        _, key_material = self._create_key_material("correct passphrase")

        with self.assertRaisesRegex(ValueError, "Unable to unlock"):
            self.client.unlock_user_key("wrong passphrase", key_material)

    def test_create_room_envelope_round_trips_with_recipient_key(self):
        recipient_private_key = ec.generate_private_key(ec.SECP256R1())
        recipient_public_key = recipient_private_key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        room_key = self.client.generate_room_key()
        envelope = self.client.create_room_envelope(
            room_key,
            base64.b64encode(recipient_public_key).decode("ascii"),
            15,
        )
        self.assertEqual(envelope["recipient_id"], 15)
        self.assertEqual(
            self.client.decrypt_room_envelope(envelope, recipient_private_key),
            room_key,
        )

    def test_create_room_submits_envelopes_and_reuses_room_key_for_messages(self):
        creator_private_key = ec.generate_private_key(ec.SECP256R1())
        member_private_key = ec.generate_private_key(ec.SECP256R1())

        def public_key_b64(private_key):
            public_key = private_key.public_key().public_bytes(
                serialization.Encoding.DER,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            return base64.b64encode(public_key).decode("ascii")

        self.auth.user_keys = {
            "creator@nathlink": {
                "user_id": 5,
                "public_key": public_key_b64(creator_private_key),
            },
            "member@nathlink": {
                "user_id": 8,
                "public_key": public_key_b64(member_private_key),
            },
        }
        chat = ChatClient(self.auth)
        with patch.object(ChatCryptoClient, "unlock_user_key"):
            result = chat.create_room(
                "Room",
                ["member@nathlink"],
                "passphrase",
            )

        self.assertEqual(result["room_id"], 25)
        room_request = next(
            call for call in self.auth.calls if call[1].endswith("/chat/rooms/")
        )
        envelopes = room_request[2]["json"]["envelopes"]
        self.assertEqual(
            {envelope["recipient_id"] for envelope in envelopes},
            {5, 8},
        )
        creator_envelope = next(
            envelope for envelope in envelopes if envelope["recipient_id"] == 5
        )
        member_envelope = next(
            envelope for envelope in envelopes if envelope["recipient_id"] == 8
        )
        creator_room_key = chat.crypto.decrypt_room_envelope(
            creator_envelope,
            creator_private_key,
        )
        member_room_key = chat.crypto.decrypt_room_envelope(
            member_envelope,
            member_private_key,
        )
        self.assertEqual(creator_room_key, member_room_key)

        sent = chat.send_message(
            ["hello"],
            room_id=25,
            sender="creator@nathlink",
            passphrase="passphrase",
        )
        self.assertEqual(sent["id"], 91)
        self.assertEqual(
            json.loads(
                chat.decrypt_message(25, sent["content"])
            ),
            ["hello"],
        )


if __name__ == "__main__":
    unittest.main()
