const API_BASE = import.meta.env.VITE_API_URL || '/api';
export const AUTH_TOKEN_KEY = 'skillswap-token';

export function authToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export async function apiRequest(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  const token = authToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error('Cannot reach the SkillSwap API. Start it with npm run dev and check XAMPP MySQL.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token && !path.startsWith('/auth/')) {
      clearAuth();
      window.dispatchEvent(new Event('skillswap-auth-changed'));
    }
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}

export function saveAuth({ token, user }) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem('skillswap-user', user.email);
  localStorage.setItem('skillswap-user-id', String(user.id));
  localStorage.setItem('skillswap-registered-email', user.email);
  localStorage.setItem('skillswap-full-name', user.fullName);
}

export function clearAuth() {
  for (const key of [AUTH_TOKEN_KEY, 'skillswap-user', 'skillswap-user-id', 'skillswap-registered-email', 'skillswap-full-name']) localStorage.removeItem(key);
}

export function backendExchangeData(payload) {
  const reviews = payload.reviews || [];
  const reviewedRequests = new Set(reviews.map(review => review.requestId));
  return {
    profile: { ...payload.profile, wantsToLearn: payload.profile.wantsToLearn.map(skill => ({ ...skill, currentLevel: skill.currentLevel || skill.level })) },
    requests: payload.requests.map(request => ({
      ...request,
      reviewed: reviewedRequests.has(request.id),
      ...(request.session ? { session: {
        ...request.session,
        date: request.session.scheduledAt,
        startTime: request.session.scheduledAt ? new Date(request.session.scheduledAt).toTimeString().slice(0, 5) : '',
        duration: request.session.durationMinutes,
        live: false
      } } : {})
    })),
    history: payload.history || [],
    credits: payload.credits || 0,
    reviews,
    creditActivity: payload.creditActivity || [],
    timeline: payload.timeline || []
  };
}

export async function syncExchangeChanges(previous, next) {
  if (!authToken()) return;
  const profileChanged = JSON.stringify(previous.profile) !== JSON.stringify(next.profile);
  if (profileChanged) {
    const skills = [
      ...next.profile.canTeach.map(skill => ({ ...skill, kind: 'teach' })),
      ...next.profile.wantsToLearn.map(skill => ({ ...skill, kind: 'learn' }))
    ];
    await apiRequest('/profile', { method: 'PUT', body: JSON.stringify({
      bio: next.profile.bio || '', role: next.profile.role || '', goal: next.profile.goal || '',
      availability: next.profile.availability || [], skills
    }) });
  }

  const prior = new Map(previous.requests.map(request => [request.id, request]));
  for (const request of next.requests) {
    const old = prior.get(request.id);
    if (request.sample) continue;
    if (!old && request.direction === 'sent' && Number.isSafeInteger(Number(request.partnerId))) {
      await apiRequest('/requests', { method: 'POST', body: JSON.stringify({
        id: request.id, recipientId: Number(request.partnerId), offeredSkill: request.offeredSkill,
        wantedSkill: request.wantedSkill, matchScore: request.matchScore || 0
      }) });
      continue;
    }
    if (!old) continue;
    const cancellationUsesSession = request.status === 'Cancelled' && Boolean(request.session);
    if (old.status !== request.status && ['Accepted', 'Rejected', 'Cancelled'].includes(request.status) && !cancellationUsesSession) {
      await apiRequest(`/requests/${encodeURIComponent(request.id)}`, { method: 'PATCH', body: JSON.stringify({ status: request.status }) });
    }
    if (request.session && (!old.session || old.session.scheduledAt !== request.session.scheduledAt ||
      old.session.durationMinutes !== request.session.durationMinutes || old.session.mode !== request.session.mode || old.session.note !== request.session.note)) {
      await apiRequest(`/requests/${encodeURIComponent(request.id)}/sessions`, { method: 'POST', body: JSON.stringify({
        sessionId: request.session.id, meetingId: request.session.meetingId || request.meeting?.meetingId || request.meeting?.id,
        mode: request.session.mode, startsAt: request.session.scheduledAt,
        durationMinutes: request.session.durationMinutes, note: request.session.note || ''
      }) });
    }
    if (old.session && request.session && old.session.status !== request.session.status && ['Completed', 'Cancelled'].includes(request.session.status)) {
      await apiRequest(`/sessions/${encodeURIComponent(request.session.id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: request.session.status }) });
    }
  }

  const knownReviews = new Set(previous.reviews.map(review => review.id));
  for (const review of next.reviews) {
    if (knownReviews.has(review.id)) continue;
    const request = next.requests.find(item => item.id === review.requestId);
    if (request?.session?.id) await apiRequest(`/sessions/${encodeURIComponent(request.session.id)}/feedback`, { method: 'POST', body: JSON.stringify(review) });
  }
}
