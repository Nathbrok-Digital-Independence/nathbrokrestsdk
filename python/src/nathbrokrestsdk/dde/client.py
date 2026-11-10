import base64
from ..auth import Auth
from pathlib import Path
from typing import Any

class DDEClient:
    def __init__(self, auth: Auth | None = None):
        """
        Initialize the DDEClient with an Auth instance.
        """
        self.auth = auth or Auth()

    @staticmethod
    def _validate_key(key: str | None) -> None:
        if key is not None and (
            not isinstance(key, str) or not key or len(key) > 4096
        ):
            raise ValueError("key must be a non-empty string of at most 4096 characters")

    def encrypt_file(
        self,
        file_path: str,
        *,
        key: str | None = None,
    ) -> dict[str, Any]:
        """
        Encrypt a file using the DDE service.

        Args:
            file_path (str): The path to the file to encrypt.

        Returns:
            str: The response from the DDE service.
        """
        path = Path(file_path)
        self._validate_key(key)
        if key is not None:
            response = self.auth.authorized_encrypted_request(
                method="POST",
                url=f"{self.auth.base_url}/dde/file/",
                json={
                    "filename": path.name,
                    "content": base64.b64encode(path.read_bytes()).decode("ascii"),
                    "key": key,
                },
            )
        else:
            with path.open("rb") as file_obj:
                response = self.auth.authorized_request(
                    method="POST",
                    url=f"{self.auth.base_url}/dde/file/",
                    files={"file": (path.name, file_obj)},
                )
        return response

    def encypt_file(
        self,
        file_path: str,
        *,
        key: str | None = None,
    ) -> dict[str, Any]:
        """Backward-compatible alias for :meth:`encrypt_file`."""
        return self.encrypt_file(file_path, key=key)

    def decrypt_file(
        self,
        file_path: str,
        *,
        key: str | None = None,
    ) -> dict[str, Any]:
        """
        Decrypt a file using the DDE service.
        """
        path = Path(file_path)
        self._validate_key(key)
        if key is not None:
            response = self.auth.authorized_encrypted_request(
                method="GET",
                url=f"{self.auth.base_url}/dde/file/",
                json={
                    "filename": path.name,
                    "content": base64.b64encode(path.read_bytes()).decode("ascii"),
                    "key": key,
                },
            )
        else:
            with path.open("rb") as file_obj:
                response = self.auth.authorized_request(
                    method="GET",
                    url=f"{self.auth.base_url}/dde/file/",
                    files={"file": (path.name, file_obj)},
                )
        return response

    def encrypt_data(
        self,
        data: dict[str, Any],
        *,
        key: str | None = None,
    ) -> dict[str, Any]:
        """
        Encrypt data using the DDE service.
        """
        self._validate_key(key)
        if key is not None:
            return self.auth.authorized_encrypted_request(
                method="POST",
                url=f"{self.auth.base_url}/dde/data/",
                json={"data": data, "key": key},
            )
        return self.auth.authorized_request(
            method="POST",
            url=f"{self.auth.base_url}/dde/data/",
            body=data,
        )

    def decrypt_data(
        self,
        data: dict[str, Any],
        *,
        key: str | None = None,
    ) -> dict[str, Any]:
        """
        Decrypt data using the DDE service.
        """
        self._validate_key(key)
        if key is not None:
            return self.auth.authorized_encrypted_request(
                method="GET",
                url=f"{self.auth.base_url}/dde/data/",
                json={"data": data.get("data"), "key": key},
            )
        return self.auth.authorized_request(
            method="GET",
            url=f"{self.auth.base_url}/dde/data/",
            body=data,
        )