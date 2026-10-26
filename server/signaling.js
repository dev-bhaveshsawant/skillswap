import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.SIGNALING_PORT || 8787);
const MAX_ROOMS = 500;
const ROOM_TTL = 1000 * 60 * 60 * 24;
const MAX_TIMER_DELAY = 2147483647;
const ROOM_STORE_PATH = process.env.SIGNALING_ROOM_STORE || join(tmpdir(), 'skillswap-meeting-rooms.json');
const MAX_MESSAGE_BYTES = 16 * 1024;
const rooms = new Map();
const sockets = new Set();

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    response.end(JSON.stringify({ status: 'ok', service: 'skillswap-signaling' }));
    return;
  }
  response.writeHead(404);
  response.end('Not found');
});

const webSocketServer = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

function createCredential() {
  return randomBytes(32).toString('base64url');
}

function credentialsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const actualBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function persistRooms() {
  try {
    const savedRooms = [...rooms.values()].map(room => ({
      id: room.id,
      sessionId: room.sessionId,
      exchangeId: room.exchangeId,
      hostUserId: room.hostUserId,
      guestUserId: room.guestUserId,
      participant1Id: room.participant1Id,
      participant2Id: room.participant2Id,
      hostName: room.hostName,
      guestName: room.guestName,
      offeredSkill: room.offeredSkill,
      wantedSkill: room.wantedSkill,
      scheduledAt: room.scheduledAt,
      durationMinutes: room.durationMinutes,
      status: room.status,
      createdAt: room.createdAt,
      hostToken: room.hostToken,
      guestToken: room.guestToken
    }));
    writeFileSync(ROOM_STORE_PATH, JSON.stringify(savedRooms), 'utf8');
  } catch (error) {
    console.error('Could not persist SkillSwap meeting rooms:', error.message);
  }
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function disposeRoom(room) {
  if (room.timer) clearTimeout(room.timer);
  for (const peer of room.peers.values()) {
    if (room.status === 'Cancelled' || room.status === 'Completed') {
      send(peer.socket, { type: 'peer-left', status: room.status });
    }
    peer.socket.close(1000, 'Meeting room closed');
  }
  rooms.delete(room.id);
  persistRooms();
}

function scheduleRoomCleanup(room) {
  if (room.timer) clearTimeout(room.timer);
  const scheduledEnd = Date.parse(room.scheduledAt) + (room.durationMinutes || 60) * 60 * 1000;
  const expiresAt = Math.max(Date.now() + ROOM_TTL, scheduledEnd + 60 * 60 * 1000);
  room.timer = setTimeout(() => {
    if (Date.now() < expiresAt) scheduleRoomCleanup(room);
    else disposeRoom(room);
  }, Math.min(expiresAt - Date.now(), MAX_TIMER_DELAY));
  room.timer.unref?.();
}

function sanitizeMeeting(meeting) {
  return {
    id: meeting.id,
    meetingId: meeting.id,
    sessionId: meeting.sessionId,
    exchangeId: meeting.exchangeId,
    hostUserId: meeting.hostUserId,
    guestUserId: meeting.guestUserId,
    participant1Id: meeting.participant1Id || meeting.hostUserId,
    participant2Id: meeting.participant2Id || meeting.guestUserId,
    hostName: meeting.hostName,
    guestName: meeting.guestName,
    offeredSkill: meeting.offeredSkill,
    wantedSkill: meeting.wantedSkill,
    scheduledAt: meeting.scheduledAt,
    durationMinutes: meeting.durationMinutes,
    status: meeting.status,
    createdAt: meeting.createdAt
  };
}

webSocketServer.on('connection', (socket, request) => {
  sockets.add(socket);
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });

  const origin = request.headers.origin;
  const allowedOrigin = process.env.SIGNALING_ALLOWED_ORIGIN;
  if (allowedOrigin && origin !== allowedOrigin) {
    socket.close(1008, 'Origin not allowed');
    return;
  }

  socket.on('message', raw => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: 'error', code: 'INVALID_JSON', message: 'Message must be valid JSON.' });
      return;
    }

    if (message.type === 'create-room') {
      if (rooms.size >= MAX_ROOMS) {
        send(socket, { type: 'error', code: 'ROOM_LIMIT', message: 'The meeting service is busy. Try again later.' });
        return;
      }
      if (typeof message.exchangeId !== 'string' || !message.exchangeId || typeof message.userId !== 'string' || !message.userId) {
        send(socket, { type: 'error', code: 'INVALID_ROOM', message: 'An exchange and signed-in user are required.' });
        return;
      }
      const scheduledAt = typeof message.scheduledAt === 'string' ? Date.parse(message.scheduledAt) : Date.now();
      const durationMinutes = Number(message.durationMinutes || 60);
      if (!Number.isFinite(scheduledAt) || scheduledAt < Date.now() || ![30, 45, 60, 90].includes(durationMinutes)) {
        send(socket, { type: 'error', code: 'INVALID_SCHEDULE', message: 'Choose a future session date and a valid duration.' });
        return;
      }
      const id = `skillswap-session-${randomBytes(4).toString('hex').toUpperCase()}`;
      const participant1Id = String(message.participant1Id || message.userId);
      const participant2Id = String(message.participant2Id || message.partnerId || '');
      const hostToken = createCredential();
      const guestToken = createCredential();
      const meeting = {
        id,
        sessionId: typeof message.sessionId === 'string' ? message.sessionId : randomUUID(),
        exchangeId: message.exchangeId,
        hostUserId: participant1Id,
        hostName: typeof message.userName === 'string' ? message.userName.slice(0, 80) : 'SkillSwap Member',
        guestUserId: participant2Id,
        participant1Id,
        participant2Id,
        guestName: typeof message.partnerName === 'string' ? message.partnerName.slice(0, 80) : 'Skill Partner',
        offeredSkill: typeof message.offeredSkill === 'string' ? message.offeredSkill.slice(0, 80) : '',
        wantedSkill: typeof message.wantedSkill === 'string' ? message.wantedSkill.slice(0, 80) : '',
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes,
        status: 'Scheduled',
        createdAt: new Date().toISOString(),
        hostToken,
        guestToken,
        peers: new Map(),
        timer: null
      };
      rooms.set(id, meeting);
      scheduleRoomCleanup(meeting);
      persistRooms();
      send(socket, { type: 'room-created', meeting: sanitizeMeeting(meeting), role: 'host', token: hostToken, inviteToken: guestToken });
      return;
    }

    if (message.type === 'room-info') {
      const meeting = rooms.get(message.roomId);
      const hostToken = typeof message.token === 'string' ? message.token : '';
      const inviteToken = typeof message.inviteToken === 'string' ? message.inviteToken : '';
      if (!meeting) {
        send(socket, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'This meeting is not registered with the signaling service.' });
        return;
      }
      const userId = typeof message.userId === 'string' ? message.userId : '';
      const tokenRole = credentialsMatch(hostToken, meeting.hostToken) ? 'host' : credentialsMatch(inviteToken, meeting.guestToken) ? 'guest' : '';
      const identityRole = userId && userId === String(meeting.participant1Id || meeting.hostUserId) ? 'host' : userId && userId === String(meeting.participant2Id || meeting.guestUserId) ? 'guest' : '';
      const role = tokenRole || identityRole;
      if (!role || (tokenRole && identityRole && tokenRole !== identityRole)) {
        send(socket, { type: 'error', code: 'UNAUTHORIZED', message: 'This meeting is unavailable for your account.' });
        return;
      }
      send(socket, { type: 'room-info', meeting: sanitizeMeeting(meeting), role, token: role === 'host' ? meeting.hostToken : meeting.guestToken });
      return;
    }

    if (message.type === 'restore-room') {
      const snapshot = message.meeting;
      const roomId = typeof message.roomId === 'string' ? message.roomId : snapshot?.meetingId || snapshot?.id;
      if (!snapshot || typeof roomId !== 'string' || !/^skillswap-session-[A-Z0-9-]{4,64}$/i.test(roomId)) {
        send(socket, { type: 'error', code: 'INVALID_ROOM', message: 'The saved session does not contain a valid meeting ID.' });
        return;
      }
      const participant1Id = String(snapshot.participant1Id || snapshot.hostUserId || '');
      const participant2Id = String(snapshot.participant2Id || snapshot.guestUserId || '');
      const userId = typeof message.userId === 'string' ? message.userId : '';
      const hostToken = typeof snapshot.hostToken === 'string' ? snapshot.hostToken : '';
      const guestToken = typeof snapshot.guestToken === 'string' ? snapshot.guestToken : typeof snapshot.inviteToken === 'string' ? snapshot.inviteToken : '';
      const role = userId && userId === participant1Id ? 'host' : userId && userId === participant2Id ? 'guest' : '';
      if (!role || !participant1Id || !participant2Id || ['Cancelled', 'Completed'].includes(snapshot.status)) {
        send(socket, { type: 'error', code: 'UNAUTHORIZED', message: 'This meeting is unavailable for your account.' });
        return;
      }
      const meeting = {
        id: roomId,
        meetingId: roomId,
        sessionId: snapshot.sessionId || randomUUID(),
        exchangeId: snapshot.exchangeId || '',
        hostUserId: participant1Id,
        guestUserId: participant2Id,
        participant1Id,
        participant2Id,
        hostName: String(snapshot.participant1Name || snapshot.hostName || 'SkillSwap Member').slice(0, 80),
        guestName: String(snapshot.participant2Name || snapshot.guestName || 'Skill Partner').slice(0, 80),
        offeredSkill: String(snapshot.skillToTeach || snapshot.offeredSkill || '').slice(0, 80),
        wantedSkill: String(snapshot.skillToLearn || snapshot.wantedSkill || '').slice(0, 80),
        scheduledAt: snapshot.scheduledAt || snapshot.date,
        durationMinutes: Number(snapshot.durationMinutes || snapshot.duration || 60),
        status: snapshot.status || 'Scheduled',
        createdAt: snapshot.createdAt || new Date().toISOString(),
        hostToken: hostToken || createCredential(),
        guestToken: guestToken || createCredential(),
        peers: new Map(),
        timer: null
      };
      if (!Number.isFinite(Date.parse(meeting.scheduledAt)) || ![30, 45, 60, 90].includes(meeting.durationMinutes)) {
        send(socket, { type: 'error', code: 'INVALID_ROOM', message: 'The saved meeting schedule is invalid.' });
        return;
      }
      rooms.set(roomId, meeting);
      scheduleRoomCleanup(meeting);
      persistRooms();
      send(socket, { type: 'room-restored', meeting: sanitizeMeeting(meeting), role, token: role === 'host' ? meeting.hostToken : meeting.guestToken, ...(role === 'host' ? { inviteToken: meeting.guestToken } : {}) });
      return;
    }

    if (message.type === 'cancel-room' && !socket.meetingId) {
      const meeting = rooms.get(message.roomId);
      if (!meeting || (!credentialsMatch(message.token, meeting.hostToken) && !credentialsMatch(message.token, meeting.guestToken))) {
        send(socket, { type: 'error', code: 'UNAUTHORIZED', message: 'Only the exchange host can cancel this scheduled room.' });
        return;
      }
      meeting.status = 'Cancelled';
      send(socket, { type: 'room-cancelled', meeting: sanitizeMeeting(meeting) });
      disposeRoom(meeting);
      return;
    }

    if (message.type === 'reschedule-room' && !socket.meetingId) {
      const meeting = rooms.get(message.roomId);
      if (!meeting || !credentialsMatch(message.token, meeting.hostToken)) {
        send(socket, { type: 'error', code: 'UNAUTHORIZED', message: 'Only the exchange host can reschedule this meeting.' });
        return;
      }
      if (typeof message.scheduledAt !== 'string' || !Number.isFinite(Date.parse(message.scheduledAt)) || Date.parse(message.scheduledAt) < Date.now() || ![30, 45, 60, 90].includes(Number(message.durationMinutes))) {
        send(socket, { type: 'error', code: 'INVALID_SCHEDULE', message: 'A valid session date, time, and duration are required.' });
        return;
      }
      meeting.scheduledAt = message.scheduledAt;
      meeting.durationMinutes = Number(message.durationMinutes);
      scheduleRoomCleanup(meeting);
      persistRooms();
      send(socket, { type: 'room-rescheduled', meeting: sanitizeMeeting(meeting) });
      const guest = meeting.peers.get('guest');
      if (guest) send(guest.socket, { type: 'room-rescheduled', meeting: sanitizeMeeting(meeting) });
      return;
    }

    if (message.type === 'join-room') {
      const meeting = rooms.get(message.roomId);
      const role = message.role;
      const expectedToken = role === 'host' ? meeting?.hostToken : role === 'guest' ? meeting?.guestToken : '';
      const userId = typeof message.userId === 'string' ? message.userId : '';
      const identityRole = userId && userId === String(meeting?.participant1Id || meeting?.hostUserId) ? 'host' : userId && userId === String(meeting?.participant2Id || meeting?.guestUserId) ? 'guest' : '';
      if (!meeting || !credentialsMatch(message.token, expectedToken) || (identityRole && identityRole !== role)) {
        send(socket, { type: 'error', code: 'UNAUTHORIZED', message: 'You are not authorized to join this exchange meeting.' });
        socket.close(1008, 'Meeting authorization failed');
        return;
      }
      const startsAt = Date.parse(meeting.scheduledAt);
      const endsAt = startsAt + meeting.durationMinutes * 60 * 1000;
      if (Date.now() < startsAt - 15 * 60 * 1000 || Date.now() >= endsAt) {
        send(socket, { type: 'error', code: Date.now() < startsAt - 15 * 60 * 1000 ? 'TOO_EARLY' : 'SESSION_ENDED', message: Date.now() < startsAt - 15 * 60 * 1000 ? 'This session opens 15 minutes before its scheduled start.' : 'This session has ended.' });
        socket.close(1008, 'Outside session join window');
        return;
      }
      const previousPeer = meeting.peers.get(role);
      if (previousPeer && previousPeer.socket !== socket) {
        previousPeer.socket.close(1000, 'Reconnected from another tab');
      }
      meeting.peers.set(role, { socket, userId: role === 'host' ? meeting.hostUserId : meeting.guestUserId });
      socket.meetingId = meeting.id;
      socket.role = role;
      socket.userId = role === 'host' ? meeting.hostUserId : meeting.guestUserId;
      meeting.status = meeting.peers.size === 2 ? 'Live' : 'Waiting';
      scheduleRoomCleanup(meeting);
      persistRooms();
      send(socket, { type: 'joined', meeting: sanitizeMeeting(meeting), role, peerPresent: meeting.peers.size === 2 });
      const otherRole = role === 'host' ? 'guest' : 'host';
      const otherPeer = meeting.peers.get(otherRole);
      if (otherPeer) {
        send(otherPeer.socket, { type: 'peer-joined', role });
        send(socket, { type: 'peer-joined', role: otherRole });
      }
      return;
    }

    const meeting = rooms.get(socket.meetingId);
    if (!meeting || meeting.peers.get(socket.role)?.socket !== socket) {
      send(socket, { type: 'error', code: 'NOT_IN_MEETING', message: 'Join the meeting before sending signaling messages.' });
      return;
    }
    const targetRole = socket.role === 'host' ? 'guest' : 'host';
    const target = meeting.peers.get(targetRole);

    if (message.type === 'offer' || message.type === 'answer') {
      if (target) send(target.socket, { type: message.type, description: message.description });
      return;
    }
    if (message.type === 'ice-candidate') {
      if (target) send(target.socket, { type: 'ice-candidate', candidate: message.candidate });
      return;
    }
    if (message.type === 'end-call') {
      meeting.status = 'Completed';
      if (target) send(target.socket, { type: 'peer-left', status: 'Completed', endedBy: socket.role });
      send(socket, { type: 'call-ended', status: 'Completed' });
      disposeRoom(meeting);
      return;
    }
    if (message.type === 'cancel-room') {
      meeting.status = 'Cancelled';
      if (target) send(target.socket, { type: 'peer-left', status: 'Cancelled', endedBy: socket.role });
      disposeRoom(meeting);
      return;
    }
    if (message.type === 'leave-room') {
      if (target) send(target.socket, { type: 'peer-left', status: meeting.status });
      meeting.peers.delete(socket.role);
      socket.meetingId = undefined;
      socket.role = undefined;
      if (meeting.status !== 'Completed' && meeting.status !== 'Cancelled') meeting.status = 'Waiting';
      persistRooms();
    }
  });

  socket.on('close', () => {
    sockets.delete(socket);
    const meeting = rooms.get(socket.meetingId);
    if (!meeting || meeting.peers.get(socket.role)?.socket !== socket) return;
    meeting.peers.delete(socket.role);
    if (meeting.status === 'Live') meeting.status = 'Waiting';
    persistRooms();
    const otherRole = socket.role === 'host' ? 'guest' : 'host';
    const otherPeer = meeting.peers.get(otherRole);
    if (otherPeer) send(otherPeer.socket, { type: 'peer-left', status: meeting.status });
  });

  socket.on('error', error => console.error('Signaling socket error:', error.message));
});

const heartbeat = setInterval(() => {
  for (const socket of sockets) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30000);
heartbeat.unref?.();

try {
  const savedRooms = JSON.parse(readFileSync(ROOM_STORE_PATH, 'utf8'));
  if (Array.isArray(savedRooms)) {
    for (const saved of savedRooms) {
      if (!saved.id || !saved.hostToken || !saved.guestToken || ['Completed', 'Cancelled'].includes(saved.status)) continue;
      const room = { ...saved, peers: new Map(), timer: null };
      rooms.set(room.id, room);
      scheduleRoomCleanup(room);
    }
    console.log(`Restored ${rooms.size} SkillSwap meeting room${rooms.size === 1 ? '' : 's'}.`);
  }
} catch (error) {
  if (error.code !== 'ENOENT') console.error('Could not restore SkillSwap meeting rooms:', error.message);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SkillSwap signaling server listening on port ${PORT}`);
});

function shutdown() {
  clearInterval(heartbeat);
  for (const room of rooms.values()) {
    if (room.timer) clearTimeout(room.timer);
    for (const peer of room.peers.values()) peer.socket.close(1001, 'Signaling server restarting');
    room.peers.clear();
  }
  rooms.clear();
  webSocketServer.close();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
