using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.Json;

namespace NathbrokRestSdk;

public sealed class ChatCryptoClient
{
    private readonly Auth _auth;

    public ChatCryptoClient(Auth auth)
    {
        _auth = auth ?? throw new ArgumentNullException(nameof(auth));
    }

    public async Task<JsonObject> FetchUserKeyMaterialAsync(
        string user,
        CancellationToken cancellationToken = default
    )
    {
        ValidateUser(user);
        var response = await FetchKeysAsync(
            new JsonObject { ["user"] = user.Trim() },
            cancellationToken
        ).ConfigureAwait(false);
        if (response["key_material"] is not JsonObject material)
        {
            throw new InvalidDataException("The SDK response did not contain user key material");
        }
        if (!TryPositiveInt(response["user_id"], out var userId))
        {
            throw new InvalidDataException("The SDK response did not contain a valid user_id");
        }
        var result = (JsonObject)material.DeepClone();
        result["user_id"] = userId;
        return result;
    }

    public static byte[] GenerateRoomKey() => RandomNumberGenerator.GetBytes(32);

    public static ECDiffieHellman UnlockKey(
        string passphrase,
        string iv,
        string encryptedPrivateKey,
        string salt,
        int pbkdf2Iterations,
        string publicKey
    )
    {
        if (string.IsNullOrEmpty(passphrase))
        {
            throw new ArgumentException("passphrase must be a non-empty string", nameof(passphrase));
        }
        if (pbkdf2Iterations < 100_000)
        {
            throw new ArgumentOutOfRangeException(nameof(pbkdf2Iterations), "Must be at least 100000");
        }

        var saltBytes = ProtocolCrypto.DecodeBase64(salt, "salt");
        var ivBytes = ProtocolCrypto.DecodeBase64(iv, "iv");
        var encryptedBytes = ProtocolCrypto.DecodeBase64(encryptedPrivateKey, "encrypted_private_key");
        if (ivBytes.Length != 12)
        {
            throw new ArgumentException("iv must contain exactly 12 bytes", nameof(iv));
        }

        var wrappingKey = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(passphrase),
            saltBytes,
            pbkdf2Iterations,
            HashAlgorithmName.SHA256,
            32
        );
        byte[] privateKeyDer;
        try
        {
            privateKeyDer = ProtocolCrypto.DecryptAesGcm(wrappingKey, ivBytes, encryptedBytes);
        }
        catch (CryptographicException exception)
        {
            throw new CryptographicException(
                "Unable to unlock the private key; check the passphrase and key material",
                exception
            );
        }

        var privateKey = ECDiffieHellman.Create();
        privateKey.ImportPkcs8PrivateKey(privateKeyDer, out var privateBytesRead);
        if (privateBytesRead != privateKeyDer.Length
            || privateKey.KeySize != 256
            || privateKey.ExportParameters(false).Curve.Oid.Value != "1.2.840.10045.3.1.7")
        {
            privateKey.Dispose();
            throw new CryptographicException("The unlocked private key must use the P-256 curve");
        }

        var suppliedPublicDer = ProtocolCrypto.DecodeBase64(publicKey, "public_key");
        using var suppliedPublicKey = ECDiffieHellman.Create();
        suppliedPublicKey.ImportSubjectPublicKeyInfo(suppliedPublicDer, out var publicBytesRead);
        if (publicBytesRead != suppliedPublicDer.Length
            || suppliedPublicKey.KeySize != 256
            || suppliedPublicKey.ExportParameters(false).Curve.Oid.Value != "1.2.840.10045.3.1.7")
        {
            privateKey.Dispose();
            throw new CryptographicException("public_key must be a P-256 ECDH public key");
        }

        var derivedPublicDer = privateKey.ExportSubjectPublicKeyInfo();
        if (!CryptographicOperations.FixedTimeEquals(derivedPublicDer, suppliedPublicDer))
        {
            privateKey.Dispose();
            throw new CryptographicException("The unlocked private key does not match public_key");
        }
        return privateKey;
    }

    public static ECDiffieHellman UnlockUserKey(string passphrase, JsonObject keyMaterial)
    {
        ArgumentNullException.ThrowIfNull(keyMaterial);
        var requiredFields = new[]
        {
            "iv",
            "encrypted_private_key",
            "salt",
            "pbkdf2_iterations",
            "public_key"
        };
        var missing = requiredFields.Where(field => !keyMaterial.ContainsKey(field)).ToArray();
        if (missing.Length > 0)
        {
            throw new ArgumentException($"keyMaterial is missing fields: {string.Join(", ", missing)}");
        }
        return UnlockKey(
            passphrase,
            keyMaterial["iv"]!.GetValue<string>(),
            keyMaterial["encrypted_private_key"]!.GetValue<string>(),
            keyMaterial["salt"]!.GetValue<string>(),
            keyMaterial["pbkdf2_iterations"]!.GetValue<int>(),
            keyMaterial["public_key"]!.GetValue<string>()
        );
    }

    public async Task<JsonObject> FetchRoomEnvelopeAsync(
        int roomId,
        string user,
        CancellationToken cancellationToken = default
    )
    {
        ValidateRoomId(roomId);
        ValidateUser(user);
        var response = await FetchKeysAsync(
            new JsonObject { ["user"] = user.Trim(), ["room_id"] = roomId },
            cancellationToken
        ).ConfigureAwait(false);
        return response["envelope"] is JsonObject envelope
            ? (JsonObject)envelope.DeepClone()
            : throw new InvalidDataException("The SDK response did not contain a room-key envelope");
    }

    public static JsonObject CreateRoomEnvelope(byte[] roomKey, string recipientPublicKey, int recipientId)
    {
        if (roomKey.Length != 32)
        {
            throw new ArgumentException("roomKey must contain exactly 32 bytes", nameof(roomKey));
        }
        ValidateRoomId(recipientId, "recipientId");
        var publicDer = ProtocolCrypto.DecodeBase64(recipientPublicKey, "recipient_public_key");
        using var recipient = ECDiffieHellman.Create();
        recipient.ImportSubjectPublicKeyInfo(publicDer, out var bytesRead);
        if (bytesRead != publicDer.Length
            || recipient.KeySize != 256
            || recipient.ExportParameters(false).Curve.Oid.Value != "1.2.840.10045.3.1.7")
        {
            throw new CryptographicException("recipientPublicKey must be a P-256 ECDH public key");
        }

        using var ephemeral = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var sharedSecret = ephemeral.DeriveRawSecretAgreement(recipient.PublicKey);
        var iv = RandomNumberGenerator.GetBytes(12);
        var encryptedKey = ProtocolCrypto.EncryptAesGcm(sharedSecret, iv, roomKey);
        return new JsonObject
        {
            ["recipient_id"] = recipientId,
            ["room_key"] = Convert.ToBase64String(encryptedKey),
            ["iv"] = Convert.ToBase64String(iv),
            ["sender_public_key"] = Convert.ToBase64String(ephemeral.ExportSubjectPublicKeyInfo())
        };
    }

    public async Task<(byte[] RoomKey, int KeyVersionId)> UnlockRoomKeyAsync(
        int roomId,
        string user,
        string passphrase,
        CancellationToken cancellationToken = default
    )
    {
        var keyMaterial = await FetchUserKeyMaterialAsync(user, cancellationToken).ConfigureAwait(false);
        using var privateKey = UnlockUserKey(passphrase, keyMaterial);
        var envelope = await FetchRoomEnvelopeAsync(roomId, user, cancellationToken).ConfigureAwait(false);
        var roomKey = DecryptRoomEnvelope(envelope, privateKey);
        if (!TryPositiveInt(envelope["key_version_id"], out var keyVersionId))
        {
            throw new InvalidDataException("The room-key envelope did not include a valid key_version_id");
        }
        return (roomKey, keyVersionId);
    }

    public static byte[] DecryptRoomEnvelope(JsonObject envelope, ECDiffieHellman privateKey)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        ArgumentNullException.ThrowIfNull(privateKey);
        var senderPublicDer = ProtocolCrypto.DecodeBase64(
            envelope["sender_public_key"]?.GetValue<string>(),
            "sender_public_key"
        );
        using var sender = ECDiffieHellman.Create();
        sender.ImportSubjectPublicKeyInfo(senderPublicDer, out var bytesRead);
        if (bytesRead != senderPublicDer.Length
            || sender.KeySize != 256
            || sender.ExportParameters(false).Curve.Oid.Value != "1.2.840.10045.3.1.7")
        {
            throw new CryptographicException("sender_public_key must be a P-256 ECDH public key");
        }
        var iv = ProtocolCrypto.DecodeBase64(envelope["iv"]?.GetValue<string>(), "iv");
        if (iv.Length != 12)
        {
            throw new CryptographicException("Envelope iv must contain exactly 12 bytes");
        }
        var encryptedRoomKey = ProtocolCrypto.DecodeBase64(
            envelope["room_key"]?.GetValue<string>(),
            "room_key"
        );
        var roomKey = ProtocolCrypto.DecryptAesGcm(
            privateKey.DeriveRawSecretAgreement(sender.PublicKey),
            iv,
            encryptedRoomKey
        );
        return roomKey.Length == 32
            ? roomKey
            : throw new CryptographicException("Decrypted room key must contain exactly 32 bytes");
    }

    public static JsonObject EncryptMessage(string plaintext, byte[] roomKey)
    {
        if (roomKey.Length != 32)
        {
            throw new ArgumentException("roomKey must contain exactly 32 bytes", nameof(roomKey));
        }
        var iv = RandomNumberGenerator.GetBytes(12);
        var ciphertext = ProtocolCrypto.EncryptAesGcm(roomKey, iv, Encoding.UTF8.GetBytes(plaintext));
        return new JsonObject
        {
            ["iv"] = Convert.ToBase64String(iv),
            ["ciphertext"] = Convert.ToBase64String(ciphertext)
        };
    }

    public static string DecryptMessage(JsonObject encryptedMessage, byte[] roomKey)
    {
        if (roomKey.Length != 32)
        {
            throw new ArgumentException("roomKey must contain exactly 32 bytes", nameof(roomKey));
        }
        var iv = ProtocolCrypto.DecodeBase64(encryptedMessage["iv"]?.GetValue<string>(), "iv");
        var ciphertext = ProtocolCrypto.DecodeBase64(
            encryptedMessage["ciphertext"]?.GetValue<string>(),
            "ciphertext"
        );
        return Encoding.UTF8.GetString(ProtocolCrypto.DecryptAesGcm(roomKey, iv, ciphertext));
    }

    private Task<JsonObject> FetchKeysAsync(JsonObject payload, CancellationToken cancellationToken) =>
        _auth.AuthorizedEncryptedRequestAsync(
            HttpMethod.Post,
            $"{_auth.BaseUrl.TrimEnd('/')}/chat/keys/",
            payload,
            cancellationToken: cancellationToken
        );

    internal static void ValidateUser(string user)
    {
        if (string.IsNullOrWhiteSpace(user))
        {
            throw new ArgumentException("user must be a non-empty email, username, or nathlink", nameof(user));
        }
    }

    internal static void ValidateRoomId(int roomId, string name = "roomId")
    {
        if (roomId < 1)
        {
            throw new ArgumentOutOfRangeException(name, "Must be a positive integer");
        }
    }

    private static bool TryPositiveInt(JsonNode? value, out int result)
    {
        result = 0;
        return value is not null && int.TryParse(value.ToJsonString(), out result) && result > 0;
    }
}
