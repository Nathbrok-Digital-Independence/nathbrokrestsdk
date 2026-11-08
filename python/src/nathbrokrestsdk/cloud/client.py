from ..auth.request import Auth
from pathlib import Path
from typing import Any

class CloudClient:
    """
    A client for interacting with the Nathbrok Cloud API.
    """

    def __init__(self):
        """
        Initialize the CloudClient with an Auth instance.
        """
        self.auth = Auth()

    def upload_file(
            self,
            bucket_id: str,
            file_path: str | Path,
            *,
            folder_id: str | int | None = None,
        ) -> dict[str, Any]:
            """
            Upload one local file to a bucket owned by the access-token user.

            Args:
                bucket_id (str): The ID of the bucket to upload the file to.
                file_path (str | Path): The path to the local file to upload.
                folder_id (str | int | None): The ID of the folder to upload the file to (optional).
            """
            if not isinstance(bucket_id, str):
                raise ValueError("Bucket ID must be a string")

            if not isinstance(file_path, (str, Path)):
                raise ValueError("File path must be a string or Path object")

            if not isinstance(folder_id, (str, int, type(None))):
                raise ValueError("Folder ID must be a string, integer, or None")

            data = {
                 "folder_id": str(folder_id) if folder_id is not None else None,
                 "bucket_id": bucket_id,
                 "file": (Path(file_path).name, Path(file_path).read_bytes()),
            }

            with Path(file_path).open("rb") as file_obj:
                response = self.auth.authorized_request(
                    method="POST",
                    url=f"{self.auth.base_url}/buckets/{bucket_id}/files/",
                    data=data,
                    files={"file": (Path(file_path).name, file_obj)}
                )
            return response

    def delete_file(self, file_id: int) -> dict[str, Any]:
        """
        Delete a file from the cloud.
        Args:
            file_id (int): The ID of the file to delete.
        """
        if not isinstance(file_id, int):
            raise ValueError("File ID must be an integer")
        
        body = {"file_id": file_id}

        response = self.auth.authorized_request(
            method="DELETE",
            url=f"{self.auth.base_url}/files/",
            body=body
        )
        return response

    def generate_file_download_link(self, file_id: int) -> dict[str, Any]:
        """
        Generate a download link for a file in the cloud.
        Args:
            file_id (int): The ID of the file to generate a download link for.
        """
        if not isinstance(file_id, int):
            raise ValueError("File ID must be an integer")

        body = {"file_id": file_id}

        response = self.auth.authorized_request(
            method="GET",
            url=f"{self.auth.base_url}/files/download/",
            body=body
        )
        return response

    def create_bucket(self, qouta: int, name: str) -> dict[str, Any]:
        """
        Create a new bucket in the cloud.
        Args:
            qouta (int): The storage quota for the bucket in bytes.
            name (str): The name of the bucket.
        """
        if not isinstance(qouta, int):
            raise ValueError("Quota must be an integer")

        if not isinstance(name, str):
            raise ValueError("Name must be a string")

        body = {"qouta": qouta, "name": name}

        response = self.auth.authorized_request(
            method="POST",
            url=f"{self.auth.base_url}/buckets/",
            body=body
        )
        return response

    def delete_bucket(self, bucket_id: str) -> dict[str, Any]:
        """
        Delete a bucket from the cloud.
        Args:
            bucket_id (str): The ID of the bucket to delete.
        """
        if not isinstance(bucket_id, str):
            raise ValueError("Bucket ID must be a string")
        
        body = {"bucket_id": bucket_id}

        response = self.auth.authorized_request(
            method="DELETE",
            url=f"{self.auth.base_url}/buckets/",
            body=body
        )
        return response