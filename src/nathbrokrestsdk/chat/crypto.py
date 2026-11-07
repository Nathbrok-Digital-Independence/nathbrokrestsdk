import base64
import binascii
import secrets
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


class ChatCryptoClient:
    """Fetch encrypted chat keys and perform local E2E key operations."""

    def __init__(self, auth) -> None:
        if not isinstance(getattr(auth, "base_url", None), str) or not callable(
            getattr(auth, "authorized_encrypted_request", None)
        ):
            raise TypeError("auth must provide base_url and authorized_encrypted_request")
        self.auth = auth

    def fetch_user_key_material(self, user: str) -> dict[str, Any]:
        """Fetch the user's passphrase-encrypted private-key bundle."""
        self._validate_user(user)
        response = self._fetch_keys({"user": user.strip()})
        key_material = response.get("key_material")
        if not isinstance(key_material, dict):
            raise ValueError("The SDK response did not contain user key material")
        user_id = response.get("user_id")
        if isinstance(user_id, bool) or not isinstance(user_id, int):
            raise ValueError("The SDK response did not contain a valid user_id")
        return {**key_material, "user_id": user_id}

    @staticmethod
    def generate_room_key() -> bytes:
        """Create a fresh, random AES-256 room key."""
        return secrets.token_bytes(32)

    def unlock_key(
        self,
        passphrase: str,
        iv: str,
        encrypted_private_key: str,
        salt: str,
        pbkdf2_iterations: int,
        public_key: str,
    ) -> ec.EllipticCurvePrivateKey:
        """Unlock and validate a P-256 private key locally with its passphrase."""
        if not isinstance(passphrase, str) or not passphrase:
            raise ValueError("passphrase must be a non-empty string")
        if (
            isinstance(pbkdf2_iterations, bool)
            or not isinstance(pbkdf2_iterations, int)
            or pbkdf2_iterations < 100_000
        ):
            raise ValueError("pbkdf2_iterations must be an integer of at least 100000")

        salt_bytes = self._decode_base64(salt, "salt")
        iv_bytes = self._decode_base64(iv, "iv")
        encrypted_key_bytes = self._decode_base64(
            encrypted_private_key,
            "encrypted_private_key",
        )
        if len(iv_bytes) != 12:
            raise ValueError("iv must contain exactly 12 bytes")

        wrapping_key = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt_bytes,
            iterations=pbkdf2_iterations,
        ).derive(passphrase.encode("utf-8"))
        try:
            private_key_der = AESGCM(wrapping_key).decrypt(
                iv_bytes,
                encrypted_key_bytes,
                None,
            )
        except InvalidTag as exc:
            raise ValueError(
                "Unable to unlock the private key; check the passphrase and key material"
            ) from exc

        private_key = serialization.load_der_private_key(
            private_key_der,
            password=None,
        )
        if (
            not isinstance(private_key, ec.EllipticCurvePrivateKey)
            or not isinstance(private_key.curve, ec.SECP256R1)
        ):
            raise ValueError("The unlocked private key must use the P-256 curve")

        supplied_public_key = serialization.load_der_public_key(
            self._decode_base64(public_key, "public_key")
        )
        if not isinstance(supplied_public_key, ec.EllipticCurvePublicKey):
            raise ValueError("public_key must be a P-256 ECDH public key")
        if not isinstance(supplied_public_key.curve, ec.SECP256R1):
            raise ValueError("public_key must use the P-256 curve")

        derived_public_key = private_key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        supplied_public_key_der = supplied_public_key.public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        if not secrets.compare_digest(derived_public_key, supplied_public_key_der):
            raise ValueError("The unlocked private key does not match public_key")
        return private_key

    def unlock_user_key(
        self,
        passphrase: str,
        key_material: dict[str, Any],
    ) -> ec.EllipticCurvePrivateKey:
        """Unlock a key bundle returned by :meth:`fetch_user_key_material`."""
        if not isinstance(key_material, dict):
            raise TypeError("key_material must be a dictionary")
        required_fields = (
            "iv",
            "encrypted_private_key",
            "salt",
            "pbkdf2_iterations",
            "public_key",
        )
        missing_fields = [field for field in required_fields if field not in key_material]
        if missing_fields:
            raise ValueError(
                f"key_material is missing fields: {', '.join(missing_fields)}"
            )
        return self.unlock_key(
            passphrase=passphrase,
            iv=key_material["iv"],
            encrypted_private_key=key_material["encrypted_private_key"],
            salt=key_material["salt"],
            pbkdf2_iterations=key_material["pbkdf2_iterations"],
            public_key=key_material["public_key"],
        )

    def fetch_room_envelope(self, room_id: int, user: str) -> dict[str, Any]:
        """Fetch the latest room-key envelope addressed to ``user``."""
        if isinstance(room_id, bool) or not isinstance(room_id, int) or room_id < 1:
            raise ValueError("room_id must be a positive integer")
        self._validate_user(user)
        response = self._fetch_keys({"user": user.strip(), "room_id": room_id})
        envelope = response.get("envelope")
        if not isinstance(envelope, dict):
            raise ValueError("The SDK response did not contain a room-key envelope")
        return envelope

    @classmethod
    def create_room_envelope(
        cls,
        room_key: bytes,
        recipient_public_key: str,
        recipient_id: int,
    ) -> dict[str, Any]:
        """Encrypt a room key to a participant using ephemeral P-256 ECDH."""
        if not isinstance(room_key, bytes) or len(room_key) != 32:
            raise ValueError("room_key must contain exactly 32 bytes")
        if isinstance(recipient_id, bool) or not isinstance(recipient_id, int) or recipient_id < 1:
            raise ValueError("recipient_id must be a positive integer")
        public_key = serialization.load_der_public_key(
            cls._decode_base64(recipient_public_key, "recipient_public_key")
        )
        if (
            not isinstance(public_key, ec.EllipticCurvePublicKey)
            or not isinstance(public_key.curve, ec.SECP256R1)
        ):
            raise ValueError("recipient_public_key must be a P-256 ECDH public key")

        ephemeral_key = ec.generate_private_key(ec.SECP256R1())
        shared_secret = ephemeral_key.exchange(ec.ECDH(), public_key)
        iv = secrets.token_bytes(12)
        encrypted_room_key = AESGCM(shared_secret).encrypt(iv, room_key, None)
        sender_public_key = ephemeral_key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        return {
            "recipient_id": recipient_id,
            "room_key": base64.b64encode(encrypted_room_key).decode("ascii"),
            "iv": base64.b64encode(iv).decode("ascii"),
            "sender_public_key": base64.b64encode(sender_public_key).decode("ascii"),
        }

    def unlock_room_key(
        self,
        room_id: int,
        user: str,
        passphrase: str,
    ) -> tuple[bytes, int]:
        """Fetch, locally unlock, and decrypt a user's latest room key."""
        key_material = self.fetch_user_key_material(user)
        private_key = self.unlock_user_key(passphrase, key_material)
        envelope = self.fetch_room_envelope(room_id, user)
        room_key = self.decrypt_room_envelope(envelope, private_key)
        key_version_id = envelope.get("key_version_id")
        if isinstance(key_version_id, bool) or not isinstance(key_version_id, int):
            raise ValueError("The room-key envelope did not include a valid key_version_id")
        return room_key, key_version_id

    @classmethod
    def decrypt_room_envelope(
        cls,
        envelope: dict[str, Any],
        private_key: ec.EllipticCurvePrivateKey,
    ) -> bytes:
        """Decrypt an ECDH P-256/AES-GCM room-key envelope."""
        if not isinstance(envelope, dict):
            raise TypeError("envelope must be a dictionary")
        if (
            not isinstance(private_key, ec.EllipticCurvePrivateKey)
            or not isinstance(private_key.curve, ec.SECP256R1)
        ):
            raise TypeError("private_key must be a P-256 elliptic-curve private key")

        sender_public_key = serialization.load_der_public_key(
            cls._decode_base64(envelope.get("sender_public_key"), "sender_public_key")
        )
        if (
            not isinstance(sender_public_key, ec.EllipticCurvePublicKey)
            or not isinstance(sender_public_key.curve, ec.SECP256R1)
        ):
            raise ValueError("sender_public_key must be a P-256 ECDH public key")

        shared_secret = private_key.exchange(ec.ECDH(), sender_public_key)
        iv = cls._decode_base64(envelope.get("iv"), "iv")
        ciphertext = cls._decode_base64(envelope.get("room_key"), "room_key")
        if len(iv) != 12:
            raise ValueError("Envelope iv must contain exactly 12 bytes")
        try:
            room_key = AESGCM(shared_secret).decrypt(iv, ciphertext, None)
        except InvalidTag as exc:
            raise ValueError("Room-key envelope could not be decrypted") from exc
        if len(room_key) != 32:
            raise ValueError("Decrypted room key must contain exactly 32 bytes")
        return room_key

    @staticmethod
    def encrypt_message(plaintext: str, room_key: bytes) -> dict[str, str]:
        """Encrypt a message with the decrypted room key using AES-GCM."""
        if not isinstance(plaintext, str):
            raise TypeError("plaintext must be a string")
        if not isinstance(room_key, bytes) or len(room_key) != 32:
            raise ValueError("room_key must contain exactly 32 bytes")
        iv = secrets.token_bytes(12)
        ciphertext = AESGCM(room_key).encrypt(
            iv,
            plaintext.encode("utf-8"),
            None,
        )
        return {
            "iv": base64.b64encode(iv).decode("ascii"),
            "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
        }

    @classmethod
    def decrypt_message(
        cls,
        encrypted_message: dict[str, Any],
        room_key: bytes,
    ) -> str:
        """Decrypt an AES-GCM message created by :meth:`encrypt_message`."""
        if not isinstance(encrypted_message, dict):
            raise TypeError("encrypted_message must be a dictionary")
        if not isinstance(room_key, bytes) or len(room_key) != 32:
            raise ValueError("room_key must contain exactly 32 bytes")
        iv = cls._decode_base64(encrypted_message.get("iv"), "iv")
        ciphertext = cls._decode_base64(
            encrypted_message.get("ciphertext"),
            "ciphertext",
        )
        if len(iv) != 12:
            raise ValueError("Message iv must contain exactly 12 bytes")
        try:
            plaintext = AESGCM(room_key).decrypt(iv, ciphertext, None)
        except InvalidTag as exc:
            raise ValueError("Encrypted message could not be decrypted") from exc
        return plaintext.decode("utf-8")

    def _fetch_keys(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.auth.base_url.rstrip('/')}/chat/keys/"
        return self.auth.authorized_encrypted_request(
            "POST",
            url,
            json=payload,
        )

    @staticmethod
    def _validate_user(user: str) -> None:
        if not isinstance(user, str) or not user.strip():
            raise ValueError("user must be a non-empty email, username, or nathlink")

    @staticmethod
    def _decode_base64(value: Any, field: str) -> bytes:
        if not isinstance(value, str) or not value:
            raise ValueError(f"{field} must be a non-empty base64 string")
        try:
            return base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError(f"{field} must be valid base64") from exc
