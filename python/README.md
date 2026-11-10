# Nathbrok REST SDK

`nathbrokrestsdk` is a Python client library for the Nathbrok REST APIs. It
provides HMAC request signing, optional encrypted server requests, and clients
for chat, cloud storage, mail, and data encryption.

The SDK is primarily intended for institutional users. An institution's users
can get access to the SDK through their institution. To use it, the institution
must have a registered **Server** in its Nathbrok account. That Server provides
the access key ID, one-time access key, and secret required to initialize the
SDK. Without a registered Server and its credentials, SDK authentication
cannot be initialized.

### Register a Server and get credentials

1. Sign in with an institutional account and open the Institution Dashboard.
2. In the **Servers** panel, select **Add Server**.
3. Enter the Server name and network details, then choose **View on Browser** or
   **Email** for credential delivery.
4. Save the **Access key ID**, **one-time access key**, and **signing secret**
   in a secure secret manager. The one-time access key is only provided when
   the Server is created; it cannot be retrieved later.
5. Set the values as environment variables for the application that will use
   the SDK. Never put credentials directly in source code or commit them to
   version control.

The access key ID identifies the Server. The one-time access key is used to
initialize the SDK and obtain its server encryption key. The signing secret is
then used by the SDK to authenticate requests.

## Requirements

- Python 3.10 or later
- Access to an institution with a registered Server and its server credentials

## Install

From this directory, install the package with:

```shell
python -m pip install nathbrokrestsdk
```

The package installs its runtime dependencies (`requests` and `cryptography`).

## Initialize authentication

Keep credentials outside source control. The initialization call validates the
access key and retrieves the server's public encryption key.

```python
import os

from nathbrokrestsdk.auth import Auth

auth = Auth()
auth.initialize(
    access_key_id=os.environ["NATHBROK_ACCESS_KEY_ID"],
    access_key=os.environ["NATHBROK_ACCESS_KEY"],
    secret_key=os.environ["NATHBROK_SECRET_KEY"],
)
```

Use the values from the registered Server:

| Environment variable | Server credential |
| --- | --- |
| `NATHBROK_ACCESS_KEY_ID` | Access key ID |
| `NATHBROK_ACCESS_KEY` | One-time access key |
| `NATHBROK_SECRET_KEY` | Signing secret |

`Auth` signs requests with the configured secret. Calls that send encrypted
requests use the server key fetched during initialization. API failures are
raised as `NathbrokAPIError`:

```python
from nathbrokrestsdk.auth import NathbrokAPIError

try:
    sso_url = auth.create_sso_url("user@example.com")
except NathbrokAPIError as exc:
    print(exc.status_code, exc)
```

`Auth` also accepts a custom `base_url` and `timeout` when constructing it.
Use HTTPS outside local development.

## Chat

Chat operations use local end-to-end encryption for room keys and message
content. Each participant must have usable public-key material registered;
the creator unlocks their private key locally with their passphrase.

```python
from nathbrokrestsdk.chat import ChatClient

chat = ChatClient(auth)
room = chat.create_room(
    name="Project discussion",
    users=["colleague@example.com"],
    passphrase=os.environ["NATHBROK_CHAT_PASSPHRASE"],
    user="owner@nathlink",
)

chat.send_message(
    message=["Hello from the SDK"],
    room_id=room["room_id"],
    sender="owner@nathlink",
    passphrase=os.environ["NATHBROK_CHAT_PASSPHRASE"],
)
```

`ChatClient` also provides methods to unlock rooms, encrypt/decrypt messages,
and delete rooms or messages. Keep passphrases secure; they are used locally to
unlock key material and should not be sent to the API.

## Other clients

- `nathbrokrestsdk.cloud.CloudClient` uploads and manages bucket files.
- `nathbrokrestsdk.mail.MailClient` sends email through an authorized mailbox.
- `nathbrokrestsdk.dde.DDEClient` requests file and data encryption/decryption.

The DDE data methods encrypt/decrypt JSON objects. File methods return the
output filename and file content encoded as base64.

By default, DDE uses the server's stable `DDE_MASTER_KEY`. To use your own
key, pass it as the `key` keyword argument; custom keys are sent only inside
the SDK's authenticated encrypted request and are never stored by the server.
During decryption, Nathbrok tries the supplied key first, then the configured
`DDE_MASTER_KEY`. If neither decrypts the value, the API returns an error.

```python
from nathbrokrestsdk.dde import DDEClient

dde = DDEClient(auth)
encrypted = dde.encrypt_data({"account": "example"}, key=os.environ["DDE_KEY"])
decrypted = dde.decrypt_data(encrypted, key=os.environ["DDE_KEY"])
```

File contents are processed in memory by the server. The SDK leaves the local
source file unchanged, and the server does not keep a temporary output file.

`MailClient` accepts an initialized `Auth` instance:

```python
from nathbrokrestsdk.mail import MailClient

mail = MailClient(auth)
mailbox = mail.create_mailbox(
    user="owner@example.com",
    email="team@nathbrok.com",
    authorized_users=["delegate@example.com"],
    password=os.environ["NATHBROK_MAILBOX_PASSWORD"],
)
result = mail.send_email(
    {"subject": "Hello", "body_text": "Sent with Nathbrok."},
    mailbox="sender@example.com",
    to="recipient@example.com",
)
```

Mailbox creation requires an email domain verified for the institution (or the
Nathbrok domain), and the selected user and authorized users must be linked to
the server owner. The optional mailbox password must be at least 12 characters
and is sent only in an authenticated encrypted request.

All clients return decoded JSON response data. Consult the Nathbrok SDK
documentation for endpoint permissions and account setup:
<https://docs.nathbrok.com/sdk/v1/>.

## License

This project is distributed under the [MIT License](https://opensource.org/license/mit/).
See the local [LICENSE](LICENSE) file.
