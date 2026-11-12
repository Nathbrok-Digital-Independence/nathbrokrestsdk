import { randomUUID } from "node:crypto";

export const DEMO_USER = Object.freeze({
  id: "contact-demo-01",
  displayName: "Taylor Morgan",
  email: "contact@example.test",
  password: "demo-password",
  keyPassphrase: "demo-key",
  nathlink: "demo-contact@nathlink",
});

const initialRooms = [
  {
    id: "room-website-launch",
    title: "Website launch",
    participant: "Mia Chen",
    unreadCount: 1,
    messages: [
      { id: "msg-web-1", senderId: "contact-demo-01", text: "I sent over the updated landing page copy.", createdAt: "2026-11-11T13:14:00.000Z" },
      { id: "msg-web-2", senderId: "agent-mia", text: "Thanks! I’ll add it to the staging build this afternoon.", createdAt: "2026-11-11T13:22:00.000Z" },
      { id: "msg-web-3", senderId: "agent-mia", text: "Could you check the mobile preview when you have a moment?", createdAt: "2026-11-12T08:35:00.000Z" },
    ],
  },
  {
    id: "room-order-4821",
    title: "Order #4821",
    participant: "Jordan Lee",
    unreadCount: 2,
    messages: [
      { id: "msg-order-1", senderId: "agent-jordan", text: "Your order is packed and ready to ship.", createdAt: "2026-11-10T09:05:00.000Z" },
      { id: "msg-order-2", senderId: "contact-demo-01", text: "Great, please use the delivery address on file.", createdAt: "2026-11-10T09:17:00.000Z" },
      { id: "msg-order-3", senderId: "agent-jordan", text: "Done. I’ll send the tracking link as soon as the courier collects it.", createdAt: "2026-11-12T07:48:00.000Z" },
    ],
  },
  {
    id: "room-studio-booking",
    title: "Studio booking",
    participant: "Sam Rivera",
    unreadCount: 0,
    messages: [
      { id: "msg-studio-1", senderId: "contact-demo-01", text: "Is the small studio available on Friday morning?", createdAt: "2026-11-09T15:02:00.000Z" },
      { id: "msg-studio-2", senderId: "agent-sam", text: "Yes, I’ve reserved it for you from 9 to 12.", createdAt: "2026-11-09T15:19:00.000Z" },
    ],
  },
];

const rooms = new Map(initialRooms.map((room) => [room.id, room]));
const sessions = new Map();
const pendingChallenges = new Map();

function createSession(scenario) {
  const id = randomUUID();
  sessions.set(id, { userId: DEMO_USER.id, scenario, unlocked: false });
  return id;
}

function roomSummary(room) {
  const latest = room.messages.at(-1);
  return {
    id: room.id,
    title: room.title,
    participant: room.participant,
    unreadCount: room.unreadCount,
    preview: latest?.text || "No messages yet",
    updatedAt: latest?.createdAt || null,
  };
}

export const fakeDatabase = {
  authenticate({ email, password, scenario = "demo-success" }) {
    if (scenario === "demo-bad-login" || email?.trim().toLowerCase() !== DEMO_USER.email || password !== DEMO_USER.password) {
      return { error: "The email or password is incorrect.", status: 401 };
    }
    if (scenario === "demo-access-denied") {
      return { error: "NathChat access is not enabled for this contact.", status: 403 };
    }
    if (scenario === "demo-2fa") {
      const challengeId = randomUUID();
      pendingChallenges.set(challengeId, { scenario });
      return { requiresTwoFactor: true, challengeId };
    }
    return { sessionId: createSession(scenario) };
  },

  verifyTwoFactor(challengeId, code) {
    const challenge = pendingChallenges.get(challengeId);
    if (!challenge || code !== "246810") return { error: "The authentication code is incorrect.", status: 401 };
    pendingChallenges.delete(challengeId);
    return { sessionId: createSession(challenge.scenario) };
  },

  getSession(sessionId) {
    return sessions.get(sessionId) || null;
  },

  unlock(sessionId, passphrase) {
    const session = sessions.get(sessionId);
    if (!session) return { error: "Please sign in again.", status: 401 };
    if (passphrase !== DEMO_USER.keyPassphrase || session.scenario === "demo-bad-unlock") {
      return { error: "Could not unlock the demo conversations. Check the key passphrase.", status: 403 };
    }
    session.unlocked = true;
    return {
      user: { id: DEMO_USER.id, displayName: DEMO_USER.displayName, nathlink: DEMO_USER.nathlink },
      roomCount: rooms.size,
    };
  },

  listRooms(session) {
    if (!session?.unlocked) return null;
    return [...rooms.values()]
      .sort((a, b) => (b.messages.at(-1)?.createdAt || "").localeCompare(a.messages.at(-1)?.createdAt || ""))
      .map(roomSummary);
  },

  getMessages(session, roomId) {
    if (!session?.unlocked) return null;
    const room = rooms.get(roomId);
    return room ? room.messages.map((message) => ({ ...message })) : undefined;
  },

  markRead(session, roomId) {
    if (!session?.unlocked) return null;
    const room = rooms.get(roomId);
    if (!room) return undefined;
    room.unreadCount = 0;
    return roomSummary(room);
  },

  addMessage(session, roomId, text) {
    if (!session?.unlocked) return null;
    const room = rooms.get(roomId);
    if (!room) return undefined;
    const message = {
      id: `msg-${randomUUID()}`,
      senderId: DEMO_USER.id,
      text,
      createdAt: new Date().toISOString(),
    };
    room.messages.push(message);
    room.unreadCount = 0;
    return { ...message };
  },

  logout(sessionId) {
    if (sessionId) sessions.delete(sessionId);
  },
};
