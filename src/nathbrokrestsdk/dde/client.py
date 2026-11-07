from ..auth import Auth
from pathlib import Path
from typing import Any

class DDEClient:
    def __init__(self):
        """
        Initialize the DDEClient with an Auth instance.
        """
        self.auth = Auth()

    def encypt_file(self, file_path: str) -> dict[str, Any]:
        """
        Encrypt a file using the DDE service.

        Args:
            file_path (str): The path to the file to encrypt.

        Returns:
            str: The response from the DDE service.
        """
        with Path(file_path).open("rb") as file_obj:
            response = self.auth.authorized_request(
                method="POST",
                url=f"{self.auth.base_url}/dde/file/",
                files={"file": (Path(file_path).name, file_obj)}
                        )
        return response
    
    def decrypt_file(self, file_path: str) -> dict[str, Any]:
        """
        Decrypt a file using the DDE service.
        Args:
            file_path (str): The path to the file to decrypt.
        """
        with Path(file_path).open("rb") as file_obj:
            response = self.auth.authorized_request(
                method="GET",
                url=f"{self.auth.base_url}/dde/file/",
                files={"file": (Path(file_path).name, file_obj)}
                        )
        return response

    def encrypt_data(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Encrypt data using the DDE service.

        Args:
            data (dict): The data to encrypt.

        Returns:
            dict: The response from the DDE service.
        """
        response = self.auth.authorized_request(
            method="POST",
            url=f"{self.auth.base_url}/dde/data/",
            body=data
        )
        return response

    def decrypt_data(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Decrypt data using the DDE service.

        Args:
            data (dict): The data to decrypt.

        Returns:
            dict: The response from the DDE service.
        """
        response = self.auth.authorized_request(
            method="GET",
            url=f"{self.auth.base_url}/dde/data/",
            body=data
        )
        return response