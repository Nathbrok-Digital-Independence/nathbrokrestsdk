import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any
from urllib.parse import urlsplit

import requests
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .exceptions import NathbrokAPIError


_DEFAULT_BASE_URL = "https://api-routes.nathbrok.com/sdk/v1"
_PAYLOAD_KEY_INFO = b"nathbrok-sdk-payload-aes256gcm-v1"
_AAD = b"nathbrok-sdk-encrypted-request-v1"
_ENVELOPE_ALGORITHM = "X25519-HKDF-SHA256+A256GCM"
_SDK_VERSION = "1.0.0"


class Auth:
    """Signs SDK requests and encrypts request bodies for a Nathbrok server."""

    def __init__(
        self,
        base_url: str = _DEFAULT_BASE_URL,
        *,
        access_key_id: str | None = None,
        access_key: str | None = None,
        secret_key: str | None = None,
        timeout: float = 15,
        session: requests.Session | None = None,
        server_key: str | None = None,
    ) -> None:
        parsed_url = urlsplit(base_url)
        if parsed_url.scheme not in {"https", "http"} or not parsed_url.netloc:
            raise ValueError("base_url must be an absolute HTTP(S) URL")
        if parsed_url.scheme != "https" and parsed_url.hostname not in {
            "localhost",
            "127.0.0.1",
            "::1",
        }:
            raise ValueError("HTTPS is required except when using localhost")
        if parsed_url.query or parsed_url.fragment:
            raise ValueError("base_url must not contain a query or fragment")

        self.base_url = base_url.rstrip("/")
        self.access_key_id = access_key_id
        self.access_key = access_key
        self.secret_key = secret_key
        self.server_key = server_key
        self.server_user: str | None = None
        self.timeout = timeout
        self.session = session or requests.Session()

    def generate_signature(
        self,
        method: str,
        path: str,
        body: bytes,
    ) -> tuple[str, str, str]:
        if not isinstance(self.secret_key, str) or not self.secret_key:
            raise ValueError("secret_key is required to sign requests")
        if not isinstance(body, bytes):
            raise TypeError("body must be bytes")

        timestamp = str(int(time.time()))
        nonce = secrets.token_urlsafe(24)
        canonical_path = urlsplit(path).path
        canonical = "\n".join(
            (
                method.upper(),
                canonical_path,
                timestamp,
                nonce,
                hashlib.sha256(body).hexdigest(),
            )
        ).encode("utf-8")
        signature = hmac.new(
            self.secret_key.encode("utf-8"),
            canonical,
            hashlib.sha256,
        ).hexdigest()
        return signature, timestamp, nonce

    def initialize(
        self,
        access_key_id: str,
        access_key: str,
        secret_key: str,
    ) -> dict[str, Any]:
        """Initialize with the public ID, one-time access secret, and HMAC key."""
        if not access_key_id or not access_key or not secret_key:
            raise ValueError(
                "access_key_id, access_key, and secret_key are required"
            )

        self.access_key_id = str(access_key_id)
        self.access_key = str(access_key)
        self.secret_key = str(secret_key)
        body = json.dumps(
            {"access_key": self.access_key},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        base_path = urlsplit(self.base_url).path.rstrip("/")
        initialize_path = (
            "/initialize/"
            if base_path.endswith("/sdk/v1")
            else "/sdk/v1/initialize/"
        )
        url = f"{self.base_url}{initialize_path}"
        signature, timestamp, nonce = self.generate_signature("POST", url, body)

        response = self.session.post(
            url,
            data=body,
            headers={
                "Authorization": f"Bearer {self.access_key_id}",
                "Content-Type": "application/json",
                "X-Nathbrok-Server-ID": self.access_key_id,
                "X-Nathbrok-Signature": signature,
                "X-Nathbrok-Timestamp": timestamp,
                "X-Nathbrok-Nonce": nonce,
            },
            timeout=self.timeout,
        )
        payload = self._decode_response(response)
        public_key = payload.get("server_key")
        if not isinstance(public_key, str) or not public_key:
            raise NathbrokAPIError(response.status_code, "Missing server_key in response")

        self.server_key = public_key
        server_user = payload.get("server_user")
        self.server_user = server_user if isinstance(server_user, str) and server_user else None
        return payload

    def authorized_request(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        """Send an HMAC-signed request, signing the exact bytes transmitted."""
        self._require_initialized(encrypted=False)
        headers = dict(kwargs.pop("headers", {}))
        prepared = self._prepare_request(method, url, headers, kwargs)
        body = self._body_bytes(prepared.body)
        signature, timestamp, nonce = self.generate_signature(
            method,
            prepared.url,
            body,
        )
        prepared.headers.update(
            self._auth_headers(signature, timestamp, nonce, encrypted=False)
        )
        response = self.session.send(prepared, timeout=self.timeout)
        return self._decode_response(response)

    def authorized_encrypted_request(
        self,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Encrypt a JSON/byte body, then sign and send the encrypted envelope."""
        self._require_initialized(encrypted=True)
        headers = dict(kwargs.pop("headers", {}))
        if kwargs.get("files"):
            raise ValueError("Encrypted multipart requests are not supported")

        if "json" in kwargs:
            plaintext = json.dumps(
                kwargs.pop("json"),
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        else:
            plaintext = self._body_bytes(kwargs.pop("data", b""))
        encrypted_body, request_private_key = self._encrypt_data(plaintext)
        headers["Content-Type"] = "application/json"
        prepared = self._prepare_request(
            method,
            url,
            headers,
            {"data": encrypted_body, **kwargs},
        )
        body = self._body_bytes(prepared.body)
        signature, timestamp, nonce = self.generate_signature(
            method,
            prepared.url,
            body,
        )
        prepared.headers.update(
            self._auth_headers(signature, timestamp, nonce, encrypted=True)
        )
        response = self.session.send(prepared, timeout=self.timeout)
        return self._decode_response(response, request_private_key)

    def create_sso_url(self, email: str) -> str:
        """Create a short-lived SSO URL for an eligible institution account."""
        if not isinstance(email, str) or not email.strip():
            raise ValueError("email must be a non-empty string")

        payload = self.authorized_encrypted_request(
            "POST",
            f"{self.base_url}/sso/authorize/",
            json={"email": email.strip()},
        )
        sso_url = payload.get("sso_url")
        if not isinstance(sso_url, str) or not sso_url:
            raise NathbrokAPIError(
                200,
                "Missing sso_url in response",
            )
        return sso_url

    def encrypt_data(self, data: bytes) -> bytes:
        """Encrypt bytes to the initialized server using X25519 and AES-GCM."""
        return self._encrypt_data(data)[0]

    def _encrypt_data(
        self,
        data: bytes,
    ) -> tuple[bytes, X25519PrivateKey]:
        if not self.server_key:
            raise ValueError("Server key is not set. Call initialize() first.")
        if not isinstance(data, bytes):
            raise TypeError("data must be bytes")

        try:
            encoded_public_key = self.server_key.encode("ascii")
            public_key_bytes = base64.urlsafe_b64decode(
                encoded_public_key + b"=" * (-len(encoded_public_key) % 4)
            )
            if len(public_key_bytes) != 32:
                raise ValueError("X25519 public keys must contain 32 bytes")
            public_key = X25519PublicKey.from_public_bytes(public_key_bytes)
        except (UnicodeEncodeError, ValueError, TypeError) as exc:
            raise ValueError(
                "server_key must be a base64url-encoded X25519 public key"
            ) from exc

        ephemeral_private_key = X25519PrivateKey.generate()
        shared_secret = ephemeral_private_key.exchange(public_key)
        salt = secrets.token_bytes(16)
        nonce = secrets.token_bytes(12)
        aes_key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            info=_PAYLOAD_KEY_INFO,
        ).derive(shared_secret)
        ciphertext = AESGCM(aes_key).encrypt(nonce, data, _AAD)
        ephemeral_public_key = ephemeral_private_key.public_key().public_bytes(
            serialization.Encoding.Raw,
            serialization.PublicFormat.Raw,
        )
        envelope = {
            "aad": _AAD.decode("ascii"),
            "algorithm": _ENVELOPE_ALGORITHM,
            "ciphertext": self._b64url_encode(ciphertext),
            "ephemeral_public_key": self._b64url_encode(ephemeral_public_key),
            "nonce": self._b64url_encode(nonce),
            "salt": self._b64url_encode(salt),
            "version": 1,
        }
        return (
            json.dumps(
                envelope,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8"),
            ephemeral_private_key,
        )

    def _require_initialized(self, *, encrypted: bool) -> None:
        if not self.access_key_id or not self.secret_key:
            raise ValueError("Auth is not initialized. Call initialize() first.")
        if encrypted and not self.server_key:
            raise ValueError("Server encryption key is missing. Call initialize() first.")

    def _auth_headers(
        self,
        signature: str,
        timestamp: str,
        nonce: str,
        *,
        encrypted: bool,
    ) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_key_id}",
            "X-Nathbrok-Server-ID": self.access_key_id,
            "X-Nathbrok-Signature": signature,
            "X-Nathbrok-Timestamp": timestamp,
            "X-Nathbrok-Nonce": nonce,
            "X-Nathbrok-Encrypted-Request": "true" if encrypted else "false",
        }

    def _prepare_request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        kwargs: dict[str, Any],
    ) -> requests.PreparedRequest:
        if "body" in kwargs:
            if "data" in kwargs or "json" in kwargs:
                raise ValueError("Provide only one of body, data, or json")
            kwargs["data"] = kwargs.pop("body")

        should_encode_json = not kwargs.get("files") and (
            "json" in kwargs or isinstance(kwargs.get("data"), (dict, list))
        )
        if should_encode_json:
            payload = kwargs.pop("json") if "json" in kwargs else kwargs.pop("data")
            json_body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode(
                "utf-8"
            )
            kwargs["data"] = json_body
            headers.setdefault("Content-Type", "application/json")
        request = requests.Request(
            method=method,
            url=url,
            headers=headers,
            **kwargs,
        )
        return self.session.prepare_request(request)

    @staticmethod
    def _body_bytes(body: bytes | str | None) -> bytes:
        if body is None:
            return b""
        if isinstance(body, str):
            return body.encode("utf-8")
        if isinstance(body, bytes):
            return body
        if isinstance(body, (dict, list)):
            return json.dumps(
                body,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        raise TypeError("Request body must be bytes, text, or None")

    @staticmethod
    def _b64url_encode(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")

    @staticmethod
    def _b64url_decode(value: str) -> bytes:
        if not isinstance(value, str):
            raise ValueError("Encrypted response fields must be strings")
        return base64.urlsafe_b64decode(
            value + "=" * (-len(value) % 4)
        )

    @staticmethod
    def _decode_response(
        response: requests.Response,
        response_private_key: X25519PrivateKey | None = None,
    ) -> dict[str, Any]:
        try:
            if response_private_key is None:
                payload = response.json()
            else:
                envelope = response.json()
                if (
                    not isinstance(envelope, dict)
                    or envelope.get("version") != 1
                    or envelope.get("algorithm") != _ENVELOPE_ALGORITHM
                    or envelope.get("aad") != "nathbrok-sdk-encrypted-response-v1"
                ):
                    raise ValueError("Invalid encrypted response envelope")

                ephemeral_public_key = X25519PublicKey.from_public_bytes(
                    Auth._b64url_decode(envelope["ephemeral_public_key"])
                )
                salt = Auth._b64url_decode(envelope["salt"])
                nonce = Auth._b64url_decode(envelope["nonce"])
                ciphertext = Auth._b64url_decode(envelope["ciphertext"])
                if len(salt) != 16 or len(nonce) != 12:
                    raise ValueError("Invalid encrypted response salt or nonce")
                shared_secret = response_private_key.exchange(ephemeral_public_key)
                aes_key = HKDF(
                    algorithm=hashes.SHA256(),
                    length=32,
                    salt=salt,
                    info=_PAYLOAD_KEY_INFO,
                ).derive(shared_secret)
                plaintext = AESGCM(aes_key).decrypt(
                    nonce,
                    ciphertext,
                    b"nathbrok-sdk-encrypted-response-v1",
                )
                payload = json.loads(plaintext)
        except (
            requests.exceptions.JSONDecodeError,
            ValueError,
            KeyError,
            TypeError,
            InvalidTag,
        ) as exc:
            raise NathbrokAPIError(
                response.status_code,
                "Response body was not valid JSON or could not be decrypted",
            ) from exc

        if not response.ok:
            raise NathbrokAPIError(response.status_code, payload)
        if not isinstance(payload, dict):
            raise NathbrokAPIError(response.status_code, "Expected a JSON object")
        return payload
