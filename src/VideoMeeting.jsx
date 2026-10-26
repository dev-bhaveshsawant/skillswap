import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, CameraOff, Check, Maximize, Mic, MicOff, PhoneOff, ShieldCheck, Video } from 'lucide-react';
import { completeExchangeSession, loadExchangeData, makeExchangeId, saveExchangeData } from './exchangeData.js';
import { cancelMeetingRoom, getMeetingInfo, restoreMeetingRoom, signalingUrl } from './videoSignaling.js';
import { findProgrammingVideo, RecommendedLearningVideo } from './ProgrammingVideos.jsx';
import { apiRequest } from './api.js';

function currentUserName() {
  const savedName = localStorage.getItem('skillswap-full-name');
  if (savedName) return savedName;
  const email = localStorage.getItem('skillswap-user') || 'SkillSwap Member';
  return email.includes('@') ? email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : email;
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes} min ${remainingSeconds.toString().padStart(2, '0')} sec`;
}

function meetingJoinState(meeting, now = Date.now()) {
  const start = Date.parse(meeting?.scheduledAt);
  if (!Number.isFinite(start)) return { allowed: true, label: 'Join Meeting' };
  const end = start + Number(meeting.durationMinutes || 60) * 60000;
  if (now < start - 15 * 60000) {
    const minutes = Math.ceil((start - now) / 60000);
    return { allowed: false, label: `Starts in ${minutes} minute${minutes === 1 ? '' : 's'}` };
  }
  if (now >= end) return { allowed: false, label: 'Session Completed' };
  return { allowed: true, label: 'Join Meeting' };
}

function updateMeetingRecord(meeting, status, durationSeconds) {
  const data = loadExchangeData();
  const requestId = meeting.exchangeId;
  const request = data.requests.find(item => item.id === requestId);
  if (request?.session) {
    if (status === 'Cancelled') {
      saveExchangeData({
        ...data,
        requests: data.requests.map(item => item.id === requestId ? { ...item, status: 'Cancelled', session: { ...item.session, status: 'Cancelled', cancelledAt: new Date().toISOString() }, meeting: { ...item.meeting, status: 'Cancelled' } } : item)
      });
      return;
    }
    const completed = completeExchangeSession(data, requestId, durationSeconds);
    saveExchangeData({
      ...completed,
      requests: completed.requests.map(item => item.id === requestId ? { ...item, meeting: { ...item.meeting, id: meeting.id, status: 'Completed' } } : item)
    });
    return;
  }
  const existing = data.history.find(item => item.requestId === requestId || item.meetingId === meeting.id);
  const historyItem = {
    id: existing?.id || makeExchangeId(),
    requestId,
    meetingId: meeting.id,
    partnerId: meeting.role === 'host' ? request?.partnerId : meeting.hostUserId,
    partnerName: meeting.role === 'host' ? meeting.guestName : meeting.hostName,
    offeredSkill: meeting.offeredSkill,
    wantedSkill: meeting.wantedSkill,
    date: new Date().toISOString(),
    durationSeconds,
    rating: existing?.rating || null,
    credits: 20,
    status: 'Completed'
  };
  const cancelled = status === 'Cancelled';
  const next = {
    ...data,
    credits: existing || cancelled ? data.credits : data.credits + 20,
    requests: data.requests.map(item => item.id === requestId ? { ...item, status: status === 'Cancelled' ? 'Cancelled' : 'Completed', meeting: { ...item.meeting, status } } : item),
    history: cancelled ? data.history : existing ? data.history.map(item => item.id === existing.id ? historyItem : item) : [historyItem, ...data.history],
    creditActivity: existing || cancelled ? data.creditActivity : [{ id: makeExchangeId(), amount: 20, title: `Completed video exchange with ${historyItem.partnerName}`, date: new Date().toISOString() }, ...data.creditActivity],
    timeline: [{ id: makeExchangeId(), label: status === 'Cancelled' ? 'Video exchange cancelled' : 'Completed a live video exchange', detail: `${meeting.offeredSkill} ↔ ${meeting.wantedSkill} with ${historyItem.partnerName}`, date: new Date().toISOString() }, ...data.timeline]
  };
  saveExchangeData(next);
}

function VideoTile({ title, name, stream, muted = false, videoEnabled = true, placeholder }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null;
  }, [stream]);
  return <div className={`video-tile ${stream ? 'has-stream' : ''}`}>
    <video ref={videoRef} autoPlay playsInline muted={muted} className={videoEnabled ? '' : 'camera-disabled'} />
    {!stream && <div className="video-placeholder"><div className="video-avatar">{name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div><strong>{placeholder}</strong></div>}
    {stream && !videoEnabled && <div className="camera-off-overlay"><CameraOff size={27} /><span>Camera is off</span></div>}
    <div className="video-nameplate"><span className={`video-status-dot ${stream ? 'is-live' : ''}`} />{title}<span>{name}</span></div>
  </div>;
}

export default function VideoMeetingPage({ toast }) {
  const routeParams = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState(null);
  const [pageState, setPageState] = useState('loading');
  const [connection, setConnection] = useState('Checking meeting room');
  const [error, setError] = useState('');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [duration, setDuration] = useState(0);
  const [rating, setRating] = useState({ teaching: 5, learning: 5, communication: 5, overall: 5, wouldAgain: 'Yes', comment: '' });
  const [reviewSent, setReviewSent] = useState(false);
  const meetingSocket = useRef(null);
  const peerConnection = useRef(null);
  const streamRef = useRef(null);
  const remoteCandidates = useRef([]);
  const meetingRef = useRef(null);
  const startedAt = useRef(null);
  const ended = useRef(false);
  const hostRole = useRef(false);
  const videoStage = useRef(null);
  const joinAttempt = useRef(0);
  const completionPersist = useRef(Promise.resolve());
  const params = { roomId: routeParams.meetingId || searchParams.get('room'), inviteToken: searchParams.get('invite'), exchangeId: searchParams.get('exchange') };

  useEffect(() => {
    let active = true;
    async function loadRoom() {
      try {
        const stored = loadExchangeData();
        const request = params.exchangeId
          ? stored.requests.find(item => item.id === params.exchangeId)
          : stored.requests.find(item => item.session?.meetingId === params.roomId || item.meeting?.meetingId === params.roomId || item.meeting?.id === params.roomId);
        const session = request?.session;
        const roomId = params.roomId || session?.meetingId || request?.meeting?.meetingId || request?.meeting?.id;
        if (!roomId) throw new Error('This accepted exchange does not have a meeting room yet. Return to My Exchanges and accept or schedule the request first.');
        if (request && request.status !== 'Accepted' && request.status !== 'Completed') throw new Error('Accept the exchange request before joining its video session.');
        const userId = String(localStorage.getItem('skillswap-user-id') || localStorage.getItem('skillswap-user') || '');
        const token = request?.meeting?.hostToken || request?.session?.hostToken;
        const inviteToken = params.inviteToken || request?.meeting?.inviteToken || request?.meeting?.guestToken || request?.session?.inviteToken;
        let response;
        let restoredRoom;
        try {
          response = await getMeetingInfo(roomId, { token, inviteToken, userId });
        } catch (roomError) {
          if (roomError.code !== 'ROOM_NOT_FOUND' || !request || !userId) throw roomError;
          const savedMeeting = {
            ...session,
            ...request.meeting,
            id: roomId,
            meetingId: roomId,
            sessionId: session?.sessionId || session?.id,
            exchangeId: request.id,
            participant1Id: session?.participant1Id || request.meeting?.participant1Id || request.meeting?.hostUserId || userId,
            participant2Id: session?.participant2Id || request.meeting?.participant2Id || request.meeting?.guestUserId || request.partnerId,
            participant1Name: session?.participant1Name || request.meeting?.participant1Name || request.meeting?.hostName || currentUserName(),
            participant2Name: session?.participant2Name || request.meeting?.participant2Name || request.meeting?.guestName || request.partnerName,
            skillToLearn: session?.skillToLearn || request.wantedSkill,
            skillToTeach: session?.skillToTeach || request.offeredSkill,
            scheduledAt: session?.scheduledAt || request.meeting?.scheduledAt,
            durationMinutes: session?.durationMinutes || request.meeting?.durationMinutes || 60,
            status: session?.status || request.meeting?.status || request.status
          };
          restoredRoom = await restoreMeetingRoom(savedMeeting, userId);
          response = await getMeetingInfo(roomId, { token: restoredRoom.token, userId });
        }
        if (!active) return;
        if (restoredRoom && request) {
          const restoredMeeting = {
            ...request.meeting,
            ...restoredRoom.meeting,
            id: roomId,
            meetingId: roomId,
            sessionId: session?.sessionId || session?.id,
            participant1Id: session?.participant1Id || request.meeting?.participant1Id || (response.role === 'host' ? userId : response.meeting.participant1Id),
            participant2Id: session?.participant2Id || request.meeting?.participant2Id || response.meeting.participant2Id || (response.role === 'guest' ? userId : request.partnerId),
            hostToken: response.role === 'host' ? response.token : request.meeting?.hostToken,
            guestToken: restoredRoom.inviteToken || request.meeting?.guestToken,
            inviteToken: restoredRoom.inviteToken || request.meeting?.inviteToken
          };
          saveExchangeData({
            ...stored,
            requests: stored.requests.map(item => item.id === request.id ? {
              ...item,
              meeting: restoredMeeting,
              session: item.session ? { ...item.session, meetingId: roomId, hostToken: restoredMeeting.hostToken, inviteToken: restoredMeeting.inviteToken } : item.session
            } : item)
          });
        }
        const info = {
          ...session,
          ...request?.meeting,
          ...response.meeting,
          id: roomId,
          meetingId: roomId,
          role: response.role,
          token: response.token,
          exchangeId: response.meeting.exchangeId || request?.id,
          offeredSkill: response.meeting.offeredSkill || request?.offeredSkill,
          wantedSkill: response.meeting.wantedSkill || request?.wantedSkill,
          durationMinutes: response.meeting.durationMinutes || session?.durationMinutes || 60,
          scheduledAt: response.meeting.scheduledAt || session?.scheduledAt,
          hostName: response.meeting.hostName || session?.participant1Name,
          guestName: response.meeting.guestName || session?.participant2Name
        };
        meetingRef.current = info;
        hostRole.current = response.role === 'host';
        setMeeting(info);
        setReviewSent(Boolean(request?.reviewed));
        setPageState('preview');
        setConnection('Ready to connect');
      } catch (loadError) {
        if (!active) return;
        setError(loadError.message);
        setPageState('error');
      }
    }
    loadRoom();
    return () => { active = false; };
  }, [params.exchangeId, params.inviteToken, params.roomId]);

  useEffect(() => {
    if (pageState !== 'live') return undefined;
    const timer = window.setInterval(() => {
      if (startedAt.current) setDuration(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pageState]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    peerConnection.current?.close();
    if (meetingSocket.current?.readyState === WebSocket.OPEN) meetingSocket.current.send(JSON.stringify({ type: 'leave-room' }));
    meetingSocket.current?.close();
  }, []);

  const persistStatus = status => {
    const current = meetingRef.current;
    if (!current) return;
    const data = loadExchangeData();
    saveExchangeData({
      ...data,
      requests: data.requests.map(item => item.id === current.exchangeId ? { ...item, meeting: { ...item.meeting, id: current.id, status }, ...(item.session ? { session: { ...item.session, status: status === 'Live' ? 'Live' : ['Completed', 'Cancelled'].includes(status) ? status : 'Scheduled', live: status === 'Live' } } : {}) } : item)
    });
    setMeeting(previous => previous ? { ...previous, status } : previous);
  };

  const closeMedia = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setLocalStream(null);
    peerConnection.current?.close();
    peerConnection.current = null;
    setRemoteStream(null);
  };

  const cancelPreview = async () => {
    const current = meetingRef.current;
    if (!current) return;
    if (current.role !== 'host') {
      navigate('/my-exchanges');
      return;
    }
    try {
      await cancelMeetingRoom(current.id, current.token);
      if (current.sessionId || current.session?.id) await apiRequest(`/sessions/${encodeURIComponent(current.sessionId || current.session.id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Cancelled' }) });
      setConnection('Cancelled');
      setPageState('cancelled');
      updateMeetingRecord(current, 'Cancelled', 0);
    } catch (cancelError) {
      setError(cancelError.message);
    }
  };

  const finishCall = (status = 'Completed', sendSignal = true) => {
    if (ended.current) return;
    ended.current = true;
    const finalStatus = status === 'Completed' && !startedAt.current ? 'Cancelled' : status;
    const socket = meetingSocket.current;
    if (sendSignal && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: finalStatus === 'Cancelled' ? 'cancel-room' : 'end-call' }));
    closeMedia();
    socket?.close();
    meetingSocket.current = null;
    const elapsed = startedAt.current ? Math.floor((Date.now() - startedAt.current) / 1000) : duration;
    setDuration(elapsed);
    setPageState(finalStatus === 'Cancelled' ? 'cancelled' : 'completed');
    setConnection(finalStatus === 'Cancelled' ? 'Cancelled' : 'Completed');
    const current = meetingRef.current;
    completionPersist.current = (async () => {
      try {
        if (current?.sessionId || current?.session?.id) await apiRequest(`/sessions/${encodeURIComponent(current.sessionId || current.session.id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: finalStatus }) });
        if (current) updateMeetingRecord(current, finalStatus, elapsed);
        toast?.show(finalStatus === 'Cancelled' ? 'Video session cancelled.' : 'Live exchange completed. Your history and credits were updated.');
      } catch (persistError) {
        setError(`The call ended, but saving it to MySQL failed: ${persistError.message}`);
        toast?.show('The call ended, but could not be saved to the backend.');
      }
    })();
  };

  const connectSignaling = async stream => {
    const info = meetingRef.current;
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        ...(import.meta.env.VITE_TURN_URL ? [{ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }] : [])
      ]
    });
    peerConnection.current = peer;
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    peer.ontrack = event => setRemoteStream(event.streams[0]);
    peer.onicecandidate = event => {
      if (event.candidate && meetingSocket.current?.readyState === WebSocket.OPEN) {
        meetingSocket.current.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate }));
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        setConnection('Connected');
        setPageState('live');
        startedAt.current ||= Date.now();
        persistStatus('Live');
      } else if (peer.connectionState === 'connecting') setConnection('Connecting securely');
      else if (peer.connectionState === 'failed') {
        setConnection('Connection failed');
        setError('Could not establish a direct video connection. If either participant is behind a restrictive firewall, configure a TURN server with VITE_TURN_URL and TURN credentials.');
      } else if (peer.connectionState === 'disconnected') setConnection('Reconnecting');
    };

    const socket = new WebSocket(signalingUrl());
    meetingSocket.current = socket;
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Could not reach the SkillSwap video signaling service. Run the project using npm run dev.')), 8000);
      socket.addEventListener('open', () => {
        window.clearTimeout(timeout);
        const userId = info.role === 'host' ? info.participant1Id || info.hostUserId : info.participant2Id || info.guestUserId;
        socket.send(JSON.stringify({ type: 'join-room', roomId: info.id, role: info.role, token: info.token, userId: String(userId || '') }));
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        window.clearTimeout(timeout);
        reject(new Error('Could not reach the SkillSwap video signaling service. Run the project using npm run dev.'));
      }, { once: true });
    });

    socket.addEventListener('message', async event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'error') {
        setError(message.message);
        setConnection('Connection error');
      } else if (message.type === 'joined') {
        setConnection(message.peerPresent ? 'Connecting securely' : 'Waiting for your partner');
        persistStatus(message.peerPresent ? 'Live' : 'Waiting');
      } else if (message.type === 'peer-joined' && info.role === 'host' && !peer.remoteDescription) {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.send(JSON.stringify({ type: 'offer', description: peer.localDescription }));
      } else if (message.type === 'offer') {
        await peer.setRemoteDescription(new RTCSessionDescription(message.description));
        for (const candidate of remoteCandidates.current.splice(0)) await peer.addIceCandidate(candidate);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.send(JSON.stringify({ type: 'answer', description: peer.localDescription }));
      } else if (message.type === 'answer') {
        await peer.setRemoteDescription(new RTCSessionDescription(message.description));
        for (const candidate of remoteCandidates.current.splice(0)) await peer.addIceCandidate(candidate);
      } else if (message.type === 'ice-candidate' && message.candidate) {
        const candidate = new RTCIceCandidate(message.candidate);
        if (peer.remoteDescription) await peer.addIceCandidate(candidate);
        else remoteCandidates.current.push(candidate);
      } else if (message.type === 'peer-left') {
        if (message.status === 'Completed' || message.status === 'Cancelled') finishCall(message.status, false);
        else {
          setConnection('Partner disconnected; waiting to reconnect');
          setRemoteStream(null);
        }
      } else if (message.type === 'call-ended') finishCall('Completed', false);
    });
    socket.addEventListener('close', event => {
      if (!ended.current && event.code !== 1000) setConnection('Signaling connection closed');
    });
  };

  const joinMeeting = async () => {
    if (!meetingJoinState(meeting).allowed) {
      setError(meetingJoinState(meeting).label);
      return;
    }
    const attempt = ++joinAttempt.current;
    setError('');
    setPageState('joining');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone access requires HTTPS or localhost in a supported browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (attempt !== joinAttempt.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      setLocalStream(stream);
      setMicEnabled(true);
      setCameraEnabled(true);
      await connectSignaling(stream);
      if (attempt !== joinAttempt.current) {
        meetingSocket.current?.close();
        meetingSocket.current = null;
        closeMedia();
        return;
      }
      setConnection('Waiting for your partner');
      setPageState('live');
    } catch (joinError) {
      closeMedia();
      meetingSocket.current?.close();
      meetingSocket.current = null;
      if (attempt !== joinAttempt.current) return;
      setPageState('preview');
      const isPermissionError = ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError'].includes(joinError.name);
      setError(isPermissionError ? 'Camera or microphone permission is required to join the video session.' : joinError.message || 'Camera or microphone permission is required to join the video session.');
    }
  };

  const toggleTrack = kind => {
    const track = streamRef.current?.getTracks().find(item => item.kind === kind);
    if (!track) return;
    track.enabled = !track.enabled;
    if (kind === 'audio') setMicEnabled(track.enabled);
    if (kind === 'video') setCameraEnabled(track.enabled);
  };

  const submitReview = async event => {
    event.preventDefault();
    const current = meetingRef.current;
    const data = loadExchangeData();
    const partnerName = current.role === 'host' ? current.guestName : current.hostName;
    const storedRequest = data.requests.find(item => item.id === current.exchangeId);
    const review = { id: makeExchangeId(), requestId: current.exchangeId, meetingId: current.id, sessionId: storedRequest?.session?.id, partnerId: current.role === 'host' ? storedRequest?.partnerId : current.hostUserId, partnerName, ...rating, date: new Date().toISOString() };
    const next = {
      ...data,
      reviews: [review, ...data.reviews],
      requests: data.requests.map(item => item.id === current.exchangeId ? { ...item, reviewed: true, session: item.session ? { ...item.session, rating: review.overall } : item.session, meeting: { ...item.meeting, status: 'Completed' } } : item),
      history: data.history.map(item => item.meetingId === current.id || item.requestId === current.exchangeId ? { ...item, rating: review.overall, feedback: rating.comment } : item)
    };
    try {
      await completionPersist.current;
      if (storedRequest?.session?.id) await apiRequest(`/sessions/${encodeURIComponent(storedRequest.session.id)}/feedback`, { method: 'POST', body: JSON.stringify(review) });
      saveExchangeData(next);
      setReviewSent(true);
      toast?.show('Your skill partner review has been saved.');
    } catch (reviewError) {
      setError(`Could not save your review: ${reviewError.message}`);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else videoStage.current?.requestFullscreen?.();
  };

  const participantName = meeting ? meeting.role === 'host' ? meeting.hostName : meeting.guestName : 'You';
  const otherName = meeting ? meeting.role === 'host' ? meeting.guestName : meeting.hostName : 'Skill Partner';
  const joinState = meetingJoinState(meeting);
  const exchangeRequest = params.exchangeId ? loadExchangeData().requests.find(item => item.id === params.exchangeId) : null;
  const recommendationSkill = meeting?.wantedSkill || exchangeRequest?.wantedSkill;

  return <main className="video-meeting-page">
    <header className="video-meeting-header"><Link to="/my-exchanges" className="video-back-link"><ArrowLeft size={16} /> My Exchanges</Link><div className="video-session-id">{meeting?.id || 'Private meeting room'}</div></header>
    {pageState === 'loading' && <section className="meeting-state-panel"><div className="meeting-loader" /><h1>Opening your meeting room</h1><p>Verifying your exchange and private room invitation...</p></section>}
    {pageState === 'error' && <section className="meeting-state-panel"><ShieldCheck size={29} /><h1>Meeting unavailable</h1><p>{error}</p><Link className="button button-outline" to="/my-exchanges">Return to My Exchanges</Link>{findProgrammingVideo(recommendationSkill) && <div className="meeting-alternative"><strong>Can’t join the Skill Exchange?</strong><p>Learn {recommendationSkill} through this recommended video instead.</p><RecommendedLearningVideo skill={recommendationSkill} compact /></div>}</section>}
    {pageState === 'preview' && meeting && <section className="meeting-preview"><div className="exchange-eyebrow"><Video size={14} /> Private peer-to-peer video session</div><h1>Ready for your Skill Exchange?</h1><p className="meeting-skill-pair">{meeting.hostName} ↔ {meeting.guestName}<br /><strong>{meeting.offeredSkill} ↔ {meeting.wantedSkill}</strong></p><div className="preview-camera"><div className="video-avatar">{participantName.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div><span><Camera size={15} /> Camera preview starts after you join</span></div><div className="preview-permissions"><span><MicOff size={15} /> Microphone is off until you join</span><span><ShieldCheck size={15} /> No audio or video is recorded</span></div>{error && <><p className="meeting-error" role="alert">{error}</p>{findProgrammingVideo(recommendationSkill) && <div className="meeting-alternative"><strong>Can’t join the Skill Exchange?</strong><p>Learn {recommendationSkill} through this recommended video instead.</p><RecommendedLearningVideo skill={recommendationSkill} compact /></div>}</>}<div className="preview-actions"><button className="button button-outline" onClick={cancelPreview}>Cancel</button><button className="button button-primary" disabled={!joinState.allowed} onClick={joinMeeting}><Video size={16} /> {joinState.label}</button></div></section>}
    {pageState === 'joining' && <section className="meeting-state-panel"><div className="meeting-loader" /><h1>Joining Skill Exchange</h1><p>Waiting for camera and microphone access...</p>{error && <p className="meeting-error" role="alert">{error}</p>}<button className="button button-outline" onClick={() => { joinAttempt.current += 1; meetingSocket.current?.close(); meetingSocket.current = null; closeMedia(); setPageState('preview'); setError(''); }}>Cancel Join</button></section>}
    {(pageState === 'live' || pageState === 'completed' || pageState === 'cancelled') && meeting && <>
      {pageState === 'live' && <section className="live-call" ref={videoStage}><div className="live-call-top"><div><div className="exchange-eyebrow">Live Skill Exchange</div><h1>{meeting.hostName} <span>↔</span> {meeting.guestName}</h1><p>{meeting.offeredSkill} ↔ {meeting.wantedSkill}</p></div><div className={`connection-pill ${connection === 'Connected' ? 'connected' : ''}`}><span />{connection}</div></div>{error && <><p className="meeting-error" role="alert">{error}</p>{findProgrammingVideo(recommendationSkill) && <div className="meeting-alternative"><strong>Can’t complete the Skill Exchange video call?</strong><p>Continue learning {recommendationSkill} with this recommended video.</p><RecommendedLearningVideo skill={recommendationSkill} compact /></div>}</>}<div className="video-grid"><VideoTile title="Other Participant" name={otherName} stream={remoteStream} placeholder={connection === 'Connected' ? 'Waiting for video' : 'Waiting for partner'} /><VideoTile title="Your Camera" name={participantName} stream={localStream} muted videoEnabled={cameraEnabled} placeholder="Your camera is private" /></div><div className="live-call-footer"><div className="call-duration">{formatDuration(duration)} <span>· no recording</span></div><div className="call-controls"><button className={!micEnabled ? 'call-control is-off' : 'call-control'} title={micEnabled ? 'Turn microphone off' : 'Turn microphone on'} aria-label={micEnabled ? 'Turn microphone off' : 'Turn microphone on'} onClick={() => toggleTrack('audio')}>{micEnabled ? <Mic /> : <MicOff />}</button><button className={!cameraEnabled ? 'call-control is-off' : 'call-control'} title={cameraEnabled ? 'Turn camera off' : 'Turn camera on'} aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'} onClick={() => toggleTrack('video')}>{cameraEnabled ? <Camera /> : <CameraOff />}</button><button className="call-control" title="Toggle full screen" aria-label="Toggle full screen" onClick={toggleFullscreen}><Maximize /></button><button className="call-control end-call" title="End call" aria-label="End call" onClick={() => finishCall('Completed')}><PhoneOff /></button></div></div></section>}
      {(pageState === 'completed' || pageState === 'cancelled') && <section className="meeting-completion"><div className="completion-icon"><Check size={23} /></div><div className="exchange-eyebrow">{pageState === 'cancelled' ? 'Session cancelled' : 'Exchange saved to My Exchanges'}</div><h1>{pageState === 'cancelled' ? 'Video session cancelled' : 'Skill Exchange Completed'}</h1><div className="completion-summary"><div><span>Exchange</span><strong>{meeting.offeredSkill} ↔ {meeting.wantedSkill}</strong></div><div><span>Duration</span><strong>{formatDuration(duration)}</strong></div><div><span>Partner</span><strong>{otherName}</strong></div><div><span>Skill Credits</span><strong>{pageState === 'completed' ? '+20 earned' : 'No credits earned'}</strong></div></div>{pageState === 'completed' && !reviewSent && <form className="exchange-form meeting-review-form" onSubmit={submitReview}><h2>Rate Your Skill Exchange</h2><label>Teaching Experience<select className="exchange-input" value={rating.teaching} onChange={event => setRating({ ...rating, teaching: Number(event.target.value) })}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{'★'.repeat(value)} ({value})</option>)}</select></label><label>Learning Experience<select className="exchange-input" value={rating.learning} onChange={event => setRating({ ...rating, learning: Number(event.target.value) })}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{'★'.repeat(value)} ({value})</option>)}</select></label><label>Communication<select className="exchange-input" value={rating.communication} onChange={event => setRating({ ...rating, communication: Number(event.target.value) })}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{'★'.repeat(value)} ({value})</option>)}</select></label><label>Overall Experience<select className="exchange-input" value={rating.overall} onChange={event => setRating({ ...rating, overall: Number(event.target.value) })}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{'★'.repeat(value)} ({value})</option>)}</select></label><label>Would you exchange skills with this person again?<select className="exchange-input" value={rating.wouldAgain} onChange={event => setRating({ ...rating, wouldAgain: event.target.value })}><option>Yes</option><option>No</option></select></label><label>Feedback<textarea className="exchange-input" value={rating.comment} onChange={event => setRating({ ...rating, comment: event.target.value })} placeholder="Share feedback about your exchange" /></label><button className="button button-primary">Submit Feedback</button></form>}{reviewSent && <p className="review-submitted"><Check size={15} /> Review saved to your profile</p>}<Link className="button button-outline" to="/my-exchanges">Back to My Exchanges</Link></section>}
    </>}
  </main>;
}
