export function signalingUrl() {
  if (import.meta.env.VITE_SIGNALING_URL) return import.meta.env.VITE_SIGNALING_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8787`;
}

function requestSignaling(message, expectedType) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(signalingUrl());
    const timeout = window.setTimeout(() => {
      socket.close();
      reject(new Error('Could not reach the video meeting service. Make sure the SkillSwap dev server is running.'));
    }, 8000);

    socket.addEventListener('open', () => socket.send(JSON.stringify(message)), { once: true });
    socket.addEventListener('message', event => {
      let response;
      try {
        response = JSON.parse(event.data);
      } catch {
        return;
      }
      if (response.type === 'error') {
        window.clearTimeout(timeout);
        socket.close();
        const error = new Error(response.message || 'The video meeting request could not be completed.');
        error.code = response.code;
        reject(error);
      } else if (response.type === expectedType) {
        window.clearTimeout(timeout);
        socket.close();
        resolve(response);
      }
    });
    socket.addEventListener('error', () => {
      window.clearTimeout(timeout);
      reject(new Error('Could not reach the video meeting service. Make sure the SkillSwap dev server is running.'));
    }, { once: true });
  });
}

export function createMeetingRoom(request, user) {
  return requestSignaling({
    type: 'create-room',
    sessionId: request.sessionId,
    exchangeId: request.id,
    userId: user.id,
    participant1Id: request.participant1Id || user.id,
    participant2Id: request.participant2Id || request.partnerId,
    userName: user.name,
    partnerId: request.partnerId,
    partnerName: request.partnerName,
    offeredSkill: request.offeredSkill,
    wantedSkill: request.wantedSkill,
    scheduledAt: request.scheduledAt || new Date().toISOString(),
    durationMinutes: request.durationMinutes || 60
  }, 'room-created');
}

export function getMeetingInfo(roomId, options = {}) {
  return requestSignaling({
    type: 'room-info',
    roomId,
    userId: options.userId,
    token: options.token,
    inviteToken: options.inviteToken
  }, 'room-info');
}

export function restoreMeetingRoom(meeting, userId) {
  return requestSignaling({
    type: 'restore-room',
    roomId: meeting.meetingId || meeting.id,
    userId,
    meeting
  }, 'room-restored');
}

export function cancelMeetingRoom(roomId, token) {
  return requestSignaling({ type: 'cancel-room', roomId, token }, 'room-cancelled');
}

export function rescheduleMeetingRoom(roomId, token, scheduledAt, durationMinutes) {
  return requestSignaling({ type: 'reschedule-room', roomId, token, scheduledAt, durationMinutes }, 'room-rescheduled');
}
