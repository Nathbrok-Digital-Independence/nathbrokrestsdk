using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NathbrokRestSdk;

public sealed class ChatClient
{
    private readonly Auth _auth;
    private readonly Dictionary<int, (byte[] RoomKey, int KeyVersionId)> _roomKeys = [];

    public ChatClient(Auth? auth = null)
    {
        _auth = auth ?? new Auth();
        Crypto = new ChatCryptoClient(_auth);
    }

    public ChatCryptoClient Crypto { get; }

    public async Task<JsonObject> SendMessageAsync(
        IReadOnlyList<string> message,
        int roomId,
        string sender,
        string passphrase,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentNullException.ThrowIfNull(message);
        if (message.Any(item => item is null))
        {
            throw new ArgumentException("message must contain only strings", nameof(message));
        }
        ChatCryptoClient.ValidateRoomId(roomId);
        ChatCryptoClient.ValidateUser(sender);
        if (string.IsNullOrEmpty(passphrase))
        {
            throw new ArgumentException("passphrase must be a non-empty string", nameof(passphrase));
        }
        if (!_roomKeys.ContainsKey(roomId))
        {
            await UnlockRoomAsync(roomId, passphrase, sender, cancellationToken).ConfigureAwait(false);
        }
        var (roomKey, keyVersionId) = _roomKeys[roomId];
        var messageJson = JsonSerializer.Serialize(message);
        return await _auth.AuthorizedEncryptedRequestAsync(
            HttpMethod.Post,
            $"{_auth.BaseUrl.TrimEnd('/')}/chat/messages/",
            new JsonObject
            {
                ["room_id"] = roomId,
                ["user"] = sender.Trim(),
                ["key_version"] = keyVersionId,
                ["content"] = ChatCryptoClient.EncryptMessage(messageJson, roomKey)
            },
            cancellationToken: cancellationToken
        ).ConfigureAwait(false);
    }

    public async Task<JsonObject> CreateRoomAsync(
        string name,
        IReadOnlyList<string> users,
        string passphrase,
        string? admin = null,
        string? user = null,
        CancellationToken cancellationToken = default
    )
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("name must be a non-empty string", nameof(name));
        }
        ArgumentNullException.ThrowIfNull(users);
        if (users.Count == 0 || users.Any(string.IsNullOrWhiteSpace))
        {
            throw new ArgumentException("users must be a non-empty list of user identifiers", nameof(users));
        }
        if (admin is not null && string.IsNullOrWhiteSpace(admin))
        {
            throw new ArgumentException("admin must be a non-empty string or null", nameof(admin));
        }
        if (string.IsNullOrEmpty(passphrase))
        {
            throw new ArgumentException("passphrase must be a non-empty string", nameof(passphrase));
        }
        var creator = user ?? _auth.ServerUser;
        if (string.IsNullOrWhiteSpace(creator))
        {
            throw new ArgumentException("user is required unless InitializeAsync returned ServerUser");
        }
        creator = creator.Trim();

        var participantIdentifiers = new List<string> { creator };
        participantIdentifiers.AddRange(users.Select(item => item.Trim()));
        if (admin is not null)
        {
            participantIdentifiers.Add(admin.Trim());
        }

        var participantKeyMaterial = new Dictionary<int, JsonObject>();
        JsonObject? creatorKeyMaterial = null;
        foreach (var identifier in participantIdentifiers)
        {
            var material = await Crypto.FetchUserKeyMaterialAsync(identifier, cancellationToken)
                .ConfigureAwait(false);
            if (!TryPositiveInt(material["user_id"], out var participantId))
            {
                throw new InvalidDataException("The SDK response did not contain a valid user_id");
            }
            participantKeyMaterial.TryAdd(participantId, material);
            if (string.Equals(identifier, creator, StringComparison.OrdinalIgnoreCase))
            {
                creatorKeyMaterial = material;
            }
        }
        if (creatorKeyMaterial is null)
        {
            throw new InvalidDataException("Could not retrieve the creator's public key material");
        }
        using (ChatCryptoClient.UnlockUserKey(passphrase, creatorKeyMaterial)) { }

        var roomKey = ChatCryptoClient.GenerateRoomKey();
        var envelopes = new JsonArray();
        foreach (var (participantId, material) in participantKeyMaterial)
        {
            envelopes.Add(ChatCryptoClient.CreateRoomEnvelope(
                roomKey,
                material["public_key"]!.GetValue<string>(),
                participantId
            ));
        }

        var request = new JsonObject
        {
            ["name"] = name.Trim(),
            ["users"] = new JsonArray(participantIdentifiers.Select(item => (JsonNode?)JsonValue.Create(item)).ToArray()),
            ["admin"] = admin?.Trim(),
            ["envelopes"] = envelopes
        };
        var response = await _auth.AuthorizedEncryptedRequestAsync(
            HttpMethod.Post,
            $"{_auth.BaseUrl.TrimEnd('/')}/chat/rooms/",
            request,
            cancellationToken: cancellationToken
        ).ConfigureAwait(false);
        if (TryPositiveInt(response["room_id"], out var roomId)
            && TryPositiveInt(response["key_version_id"], out var keyVersionId))
        {
            _roomKeys[roomId] = (roomKey, keyVersionId);
        }
        return response;
    }

    public async Task<byte[]> UnlockRoomAsync(
        int roomId,
        string passphrase,
        string user,
        CancellationToken cancellationToken = default
    )
    {
        ChatCryptoClient.ValidateRoomId(roomId);
        var (roomKey, keyVersionId) = await Crypto.UnlockRoomKeyAsync(
            roomId,
            user,
            passphrase,
            cancellationToken
        ).ConfigureAwait(false);
        _roomKeys[roomId] = (roomKey, keyVersionId);
        return roomKey;
    }

    public JsonObject EncryptMessage(int roomId, string plaintext)
    {
        var room = GetRoom(roomId);
        return ChatCryptoClient.EncryptMessage(plaintext, room.RoomKey);
    }

    public string DecryptMessage(int roomId, JsonObject encryptedMessage)
    {
        var room = GetRoom(roomId);
        return ChatCryptoClient.DecryptMessage(encryptedMessage, room.RoomKey);
    }

    public Task<JsonObject> DeleteMessageAsync(int messageId, CancellationToken cancellationToken = default)
    {
        ChatCryptoClient.ValidateRoomId(messageId, nameof(messageId));
        return _auth.AuthorizedRequestAsync(
            HttpMethod.Delete,
            $"{ApiBaseUrl()}/messages/{messageId}/",
            cancellationToken: cancellationToken
        );
    }

    public Task<JsonObject> DeleteRoomAsync(
        string? name = null,
        int? roomId = null,
        CancellationToken cancellationToken = default
    )
    {
        if (name is null && roomId is null)
        {
            throw new ArgumentException("Either name or roomId must be provided");
        }
        if (name is not null && string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("name must be a non-empty string", nameof(name));
        }
        if (roomId is not null)
        {
            ChatCryptoClient.ValidateRoomId(roomId.Value);
        }
        return name is not null
            ? _auth.AuthorizedRequestAsync(
                HttpMethod.Delete,
                $"{ApiBaseUrl()}/rooms/",
                new JsonObject { ["name"] = name.Trim() },
                cancellationToken: cancellationToken
            )
            : _auth.AuthorizedRequestAsync(
                HttpMethod.Delete,
                $"{ApiBaseUrl()}/rooms/{roomId}/",
                cancellationToken: cancellationToken
            );
    }

    private (byte[] RoomKey, int KeyVersionId) GetRoom(int roomId) =>
        _roomKeys.TryGetValue(roomId, out var room)
            ? room
            : throw new InvalidOperationException("Room key is locked; call UnlockRoomAsync() first");

    private string ApiBaseUrl() => _auth.BaseUrl.TrimEnd('/').EndsWith(
        "/sdk/v1",
        StringComparison.Ordinal
    )
        ? _auth.BaseUrl.TrimEnd('/')[..^"/sdk/v1".Length]
        : _auth.BaseUrl.TrimEnd('/');

    private static bool TryPositiveInt(JsonNode? value, out int result)
    {
        result = 0;
        return value is not null && int.TryParse(value.ToJsonString(), out result) && result > 0;
    }
}
