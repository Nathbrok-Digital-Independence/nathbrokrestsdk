using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Org.BouncyCastle.Math.EC.Rfc7748;
using Org.BouncyCastle.Security;

namespace NathbrokRestSdk;

internal static class ProtocolCrypto
{
    internal const string Algorithm = "X25519-HKDF-SHA256+A256GCM";
    private static readonly byte[] PayloadKeyInfo = Encoding.ASCII.GetBytes("nathbrok-sdk-payload-aes256gcm-v1");
    private static readonly byte[] RequestAad = Encoding.ASCII.GetBytes("nathbrok-sdk-encrypted-request-v1");
    private static readonly byte[] ResponseAad = Encoding.ASCII.GetBytes("nathbrok-sdk-encrypted-response-v1");
    private static readonly SecureRandom Random = new();

    internal sealed record EncryptedRequest(byte[] Body, byte[] EphemeralPrivateKey);

    internal static EncryptedRequest EncryptRequest(string serverKey, byte[] plaintext)
    {
        var recipient = DecodeBase64Url(serverKey, "server_key");
        if (recipient.Length != X25519.PointSize)
        {
            throw new ArgumentException("server_key must contain 32 bytes", nameof(serverKey));
        }

        var privateKey = new byte[32];
        var publicKey = new byte[X25519.PointSize];
        X25519.GeneratePrivateKey(Random, privateKey);
        X25519.GeneratePublicKey(privateKey, 0, publicKey, 0);

        var sharedSecret = new byte[X25519.PointSize];
        if (!X25519.CalculateAgreement(privateKey, 0, recipient, 0, sharedSecret, 0))
        {
            throw new CryptographicException("Unable to derive the server encryption key");
        }

        var salt = RandomNumberGenerator.GetBytes(16);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var aesKey = HKDF.DeriveKey(HashAlgorithmName.SHA256, sharedSecret, 32, salt, PayloadKeyInfo);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(aesKey, tag.Length))
        {
            aes.Encrypt(nonce, plaintext, ciphertext, tag, RequestAad);
        }

        var combinedCiphertext = new byte[ciphertext.Length + tag.Length];
        ciphertext.CopyTo(combinedCiphertext, 0);
        tag.CopyTo(combinedCiphertext, ciphertext.Length);

        var envelope = new JsonObject
        {
            ["aad"] = Encoding.ASCII.GetString(RequestAad),
            ["algorithm"] = Algorithm,
            ["ciphertext"] = EncodeBase64Url(combinedCiphertext),
            ["ephemeral_public_key"] = EncodeBase64Url(publicKey),
            ["nonce"] = EncodeBase64Url(nonce),
            ["salt"] = EncodeBase64Url(salt),
            ["version"] = 1
        };
        return new EncryptedRequest(Auth.SerializeCanonicalJson(envelope), privateKey);
    }

    internal static byte[] DecryptResponse(JsonObject envelope, byte[] ephemeralPrivateKey)
    {
        if (
            envelope["version"]?.GetValue<int>() != 1
            || envelope["algorithm"]?.GetValue<string>() != Algorithm
            || envelope["aad"]?.GetValue<string>() != Encoding.ASCII.GetString(ResponseAad)
        )
        {
            throw new CryptographicException("Invalid encrypted response envelope");
        }

        var ephemeralPublicKey = DecodeBase64Url(
            envelope["ephemeral_public_key"]?.GetValue<string>(),
            "ephemeral_public_key"
        );
        var salt = DecodeBase64Url(envelope["salt"]?.GetValue<string>(), "salt");
        var nonce = DecodeBase64Url(envelope["nonce"]?.GetValue<string>(), "nonce");
        var combinedCiphertext = DecodeBase64Url(envelope["ciphertext"]?.GetValue<string>(), "ciphertext");
        if (
            ephemeralPublicKey.Length != X25519.PointSize
            || salt.Length != 16
            || nonce.Length != 12
            || combinedCiphertext.Length < 16
        )
        {
            throw new CryptographicException("Invalid encrypted response fields");
        }

        var sharedSecret = new byte[X25519.PointSize];
        if (!X25519.CalculateAgreement(ephemeralPrivateKey, 0, ephemeralPublicKey, 0, sharedSecret, 0))
        {
            throw new CryptographicException("Unable to derive the response decryption key");
        }

        var aesKey = HKDF.DeriveKey(HashAlgorithmName.SHA256, sharedSecret, 32, salt, PayloadKeyInfo);
        var plaintext = new byte[combinedCiphertext.Length - 16];
        using (var aes = new AesGcm(aesKey, 16))
        {
            aes.Decrypt(
                nonce,
                combinedCiphertext.AsSpan(0, plaintext.Length),
                combinedCiphertext.AsSpan(plaintext.Length, 16),
                plaintext,
                ResponseAad
            );
        }
        return plaintext;
    }

    internal static byte[] EncryptAesGcm(byte[] key, byte[] nonce, byte[] plaintext, byte[]? aad = null)
    {
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(key, tag.Length))
        {
            aes.Encrypt(nonce, plaintext, ciphertext, tag, aad);
        }
        var combined = new byte[ciphertext.Length + tag.Length];
        ciphertext.CopyTo(combined, 0);
        tag.CopyTo(combined, ciphertext.Length);
        return combined;
    }

    internal static byte[] DecryptAesGcm(byte[] key, byte[] nonce, byte[] ciphertextAndTag, byte[]? aad = null)
    {
        if (nonce.Length != 12 || ciphertextAndTag.Length < 16)
        {
            throw new CryptographicException("Invalid AES-GCM nonce or ciphertext");
        }
        var plaintext = new byte[ciphertextAndTag.Length - 16];
        using (var aes = new AesGcm(key, 16))
        {
            aes.Decrypt(
                nonce,
                ciphertextAndTag.AsSpan(0, plaintext.Length),
                ciphertextAndTag.AsSpan(plaintext.Length, 16),
                plaintext,
                aad
            );
        }
        return plaintext;
    }

    internal static byte[] DecodeBase64(string? value, string field)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException($"{field} must be a non-empty base64 string", field);
        }
        try
        {
            return Convert.FromBase64String(value);
        }
        catch (FormatException exception)
        {
            throw new ArgumentException($"{field} must be valid base64", field, exception);
        }
    }

    internal static byte[] DecodeBase64Url(string? value, string field)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Any(character =>
            !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_')))
        {
            throw new ArgumentException($"{field} must be a base64url string", field);
        }
        var base64 = value.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + ((4 - base64.Length % 4) % 4), '=');
        try
        {
            var decoded = Convert.FromBase64String(base64);
            if (!string.Equals(EncodeBase64Url(decoded), value, StringComparison.Ordinal))
            {
                throw new ArgumentException($"{field} must be a valid base64url string", field);
            }
            return decoded;
        }
        catch (FormatException exception)
        {
            throw new ArgumentException($"{field} must be a valid base64url string", field, exception);
        }
    }

    internal static string EncodeBase64Url(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
