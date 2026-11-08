import json
from typing import Any

from ..auth import Auth
from .crypto import ChatCryptoClient


class ChatClient:
    def __init__(self, auth: Auth | None = None) -> None:
        """Create a chat client using an initialized SDK Auth instance."""
        self.auth = auth or Auth()
        self.crypto = ChatCryptoClient(self.auth)
        self._room_keys: dict[int, tuple[bytes, int]] = {}

    def send_message(
        self,
        message: list[str],
        room_id: int,
        sender: str,
        passphrase: str,
    ) -> dict[str, Any]:
        """Encrypt and send a text message using the room's current key."""
        if not isinstance(message, list) or not all(
            isinstance(item, str) for item in message
        ):
            raise ValueError("message must be a list of strings")
        if isinstance(room_id, bool) or not isinstance(room_id, int) or room_id < 1:
            raise ValueError("room_id must be a positive integer")
        if not isinstance(sender, str) or not sender.strip():
            raise ValueError("sender must be a non-empty user identifier")
        if not isinstance(passphrase, str) or not passphrase:
            raise ValueError("passphrase must be a non-empty string")

        if room_id not in self._room_keys:
            self.unlock_room(room_id, passphrase, sender)
        _, key_version_id = self._room_keys[room_id]
        encrypted = self.encrypt_message(room_id, json.dumps(message, ensure_ascii=False))
        return self.auth.authorized_encrypted_request(
            "POST",
            f"{self.auth.base_url.rstrip('/')}/chat/messages/",
            json={
                "room_id": room_id,
                "user": sender.strip(),
                "key_version": key_version_id,
                "content": encrypted,
            },
        )

    def delete_message(self, message_id: int) -> dict[str, Any]:
        """Delete a message through the ordinary authenticated API."""
        if isinstance(message_id, bool) or not isinstance(message_id, int) or message_id < 1:
            raise ValueError("message_id must be a positive integer")
        api_base_url = self.auth.base_url.rstrip("/")
        if api_base_url.endswith("/sdk/v1"):
            api_base_url = api_base_url[:-len("/sdk/v1")]
        return self.auth.authorized_request(
            method="DELETE",
            url=f"{api_base_url}/messages/{message_id}/",
        )

    def create_room(
        self,
        name: str,
        users: list[str],
        passphrase: str,
        admin: str | None = None,
        *,
        user: str | None = None,
    ) -> dict[str, Any]:
        """Create a room and submit a per-participant envelope for one room key.

        The creator is included as a room participant. ``user`` defaults to the
        server owner's Nathlink returned by ``Auth.initialize``.
        """
        if not isinstance(name, str) or not name.strip():
            raise ValueError("name must be a non-empty string")
        if not isinstance(users, list) or not users:
            raise ValueError("users must be a non-empty list of user identifiers")
        if not all(isinstance(participant, str) and participant.strip() for participant in users):
            raise ValueError("All users must be non-empty strings")
        if admin is not None and (
            not isinstance(admin, str) or not admin.strip()
        ):
            raise ValueError("admin must be a non-empty string or null")
        if not isinstance(passphrase, str) or not passphrase:
            raise ValueError("passphrase must be a non-empty string")

        creator = user or self.auth.server_user
        if not isinstance(creator, str) or not creator.strip():
            raise ValueError(
                "user is required unless Auth.initialize() returned server_user"
            )
        creator = creator.strip()

        participant_identifiers = [creator, *[item.strip() for item in users]]
        if admin is not None:
            participant_identifiers.append(admin.strip())

        participant_key_material = {}
        creator_key_material = None
        for identifier in participant_identifiers:
            material = self.crypto.fetch_user_key_material(identifier)
            participant_id = material["user_id"]
            participant_key_material.setdefault(participant_id, material)
            if identifier.casefold() == creator.casefold():
                creator_key_material = material

        if creator_key_material is None:
            raise ValueError("Could not retrieve the creator's public key material")
        self.crypto.unlock_user_key(passphrase, creator_key_material)

        room_key = self.crypto.generate_room_key()
        envelopes = [
            self.crypto.create_room_envelope(
                room_key=room_key,
                recipient_public_key=material["public_key"],
                recipient_id=participant_id,
            )
            for participant_id, material in participant_key_material.items()
        ]
        response = self.auth.authorized_encrypted_request(
            "POST",
            f"{self.auth.base_url.rstrip('/')}/chat/rooms/",
            json={
                "name": name.strip(),
                "users": participant_identifiers,
                "admin": admin.strip() if admin is not None else None,
                "envelopes": envelopes,
            },
        )

        room_id = response.get("room_id")
        key_version_id = response.get("key_version_id")
        if (
            isinstance(room_id, int)
            and not isinstance(room_id, bool)
            and isinstance(key_version_id, int)
            and not isinstance(key_version_id, bool)
        ):
            self._room_keys[room_id] = (room_key, key_version_id)
        return response

    def unlock_room(
        self,
        room_id: int,
        passphrase: str,
        user: str,
    ) -> bytes:
        """Fetch, unlock, and decrypt the user's latest room-key envelope."""
        room_key, key_version_id = self.crypto.unlock_room_key(
            room_id,
            user,
            passphrase,
        )
        self._room_keys[room_id] = (room_key, key_version_id)
        return room_key

    def encrypt_message(self, room_id: int, plaintext: str) -> dict[str, str]:
        """Encrypt plaintext with a room key created or unlocked by this client."""
        try:
            room_key, _ = self._room_keys[room_id]
        except KeyError as exc:
            raise ValueError("Room key is locked; call unlock_room() first") from exc
        return self.crypto.encrypt_message(plaintext, room_key)

    def decrypt_message(
        self,
        room_id: int,
        encrypted_message: dict[str, Any],
    ) -> str:
        """Decrypt an AES-GCM message with a room key loaded by this client."""
        try:
            room_key, _ = self._room_keys[room_id]
        except KeyError as exc:
            raise ValueError("Room key is locked; call unlock_room() first") from exc
        return self.crypto.decrypt_message(encrypted_message, room_key)

    def delete_room(
        self,
        name: str | None = None,
        room_id: int | None = None,
    ) -> dict[str, Any]:
        """Delete a room through the ordinary authenticated API."""
        if name is None and room_id is None:
            raise ValueError("Either name or room_id must be provided")
        if name is not None and (not isinstance(name, str) or not name.strip()):
            raise ValueError("name must be a non-empty string")
        if room_id is not None and (
            isinstance(room_id, bool) or not isinstance(room_id, int) or room_id < 1
        ):
            raise ValueError("room_id must be a positive integer")

        api_base_url = self.auth.base_url.rstrip("/")
        if api_base_url.endswith("/sdk/v1"):
            api_base_url = api_base_url[:-len("/sdk/v1")]
        if name is not None:
            return self.auth.authorized_request(
                method="DELETE",
                url=f"{api_base_url}/rooms/",
                json={"name": name.strip()},
            )
        return self.auth.authorized_request(
            method="DELETE",
            url=f"{api_base_url}/rooms/{room_id}/",
        )
