import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, Award, CalendarDays, Camera, Check, ChevronRight, Clock3, Coins, GraduationCap, HeartHandshake, Link as LinkIcon, Plus, Search, Send, Sparkles, Star, Trash2, TrendingUp, Users, Video, X } from 'lucide-react';
import {
  AVAILABILITY_OPTIONS,
  DEMO_PARTNERS,
  EXCHANGE_STORAGE_KEY,
  LEARNING_GOALS,
  SKILL_LEVELS,
  getMatchDetails,
  completeExchangeSession,
  loadExchangeData,
  makeExchangeId,
  saveExchangeData
} from './exchangeData.js';
import { cancelMeetingRoom, createMeetingRoom, getMeetingInfo, rescheduleMeetingRoom } from './videoSignaling.js';
import { RecommendedLearningVideo } from './ProgrammingVideos.jsx';
import { apiRequest, authToken, backendExchangeData, syncExchangeChanges } from './api.js';

const SESSION_DURATIONS = [30, 45, 60, 90];

function localDateTimeParts(value) {
  const date = new Date(parseSessionTimestamp(value));
  const pad = part => String(part).padStart(2, '0');
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}

function defaultSchedule() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return { ...localDateTimeParts(date), durationMinutes: 60, mode: 'Online Video Exchange', note: '' };
}

function sessionStatus(session, now = Date.now()) {
  if (!session) return 'Scheduled';
  if (session.status === 'Cancelled' || session.status === 'Completed') return session.status;
  const start = parseSessionTimestamp(session.scheduledAt);
  if (!Number.isFinite(start)) return 'Scheduled';
  const end = start + Number(session.durationMinutes || 60) * 60 * 1000;
  if (now >= end) return 'Completed';
  if (session.live || session.status === 'Live') return 'Live';
  if (now >= start) return 'Live';
  if (start - now <= 30 * 60 * 1000) return 'Starting Soon';
  return 'Scheduled';
}

function joinSessionState(session, now = Date.now()) {
  if (!session || session.mode !== 'Online Video Exchange' || ['Cancelled', 'Completed'].includes(session.status)) return { allowed: false, label: session?.status === 'Completed' ? 'Session Completed' : 'Join Video Exchange' };
  const start = parseSessionTimestamp(session.scheduledAt);
  if (!Number.isFinite(start)) return { allowed: false, label: 'Join Video Exchange' };
  const end = start + Number(session.durationMinutes || 60) * 60 * 1000;
  if (now < start - 15 * 60 * 1000) {
    const minutes = Math.ceil((start - now) / 60000);
    return { allowed: false, label: `Starts in ${minutes} minute${minutes === 1 ? '' : 's'}` };
  }
  if (now >= end) return { allowed: false, label: 'Session Completed' };
  return { allowed: true, label: 'Join Now' };
}

function parseSessionTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return Number.NaN;
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i);
  const dayFirst = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (iso || dayFirst) {
    const match = iso || dayFirst;
    const year = Number(iso ? match[1] : match[3]);
    const month = Number(match[2]);
    const day = Number(iso ? match[3] : match[1]);
    const hours = Number(match[4] || 0);
    const minutes = Number(match[5] || 0);
    const seconds = Number(match[6] || 0);
    const milliseconds = Number(iso && match[7] ? match[7].padEnd(3, '0').slice(0, 3) : 0);
    if (iso && match[8]) return Date.parse(text);
    const parsed = new Date(year, month - 1, day, hours, minutes, seconds, milliseconds);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day || parsed.getHours() !== hours || parsed.getMinutes() !== minutes || parsed.getSeconds() !== seconds) return Number.NaN;
    return parsed.getTime();
  }
  return Date.parse(text);
}

function localScheduleParts(timestamp) {
  const date = new Date(timestamp);
  const pad = part => String(part).padStart(2, '0');
  return {
    date: `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
  };
}

function scheduleConflict(data, requestId, startsAt, durationMinutes) {
  const newStart = parseSessionTimestamp(startsAt);
  const newDuration = Number(durationMinutes);
  if (!Number.isFinite(newStart) || !Number.isFinite(newDuration) || newDuration <= 0) return null;
  const newEnd = newStart + newDuration * 60 * 1000;
  const newParts = localScheduleParts(newStart);
  const request = (data.requests || []).find(item => item.id === requestId);
  const currentSessionId = request?.session?.id;
  const currentUser = localStorage.getItem('skillswap-user');
  const records = [
    ...(data.requests || []).filter(item => item.session).map(item => ({ session: item.session, request: item })),
    ...(data.sessions || []).map(session => ({ session, request: (data.requests || []).find(item => item.id === session.requestId) }))
  ];
  const seenSessions = new Set();
  let conflictingRequest = null;

  for (const record of records) {
    const { session, request: ownerRequest } = record;
    const existingStart = parseSessionTimestamp(session.scheduledAt || ownerRequest?.meeting?.scheduledAt);
    const duration = Number(session.durationMinutes ?? ownerRequest?.meeting?.durationMinutes ?? 60);
    const existingEnd = existingStart + duration * 60 * 1000;
    const existingParts = Number.isFinite(existingStart) ? localScheduleParts(existingStart) : { date: 'Invalid', time: 'Invalid' };
    const existingEndParts = Number.isFinite(existingEnd) ? localScheduleParts(existingEnd) : { date: 'Invalid', time: 'Invalid' };
    const status = [session.status, ownerRequest?.status, ownerRequest?.meeting?.status].filter(Boolean).map(value => String(value).toLowerCase());
    const displayStatus = status.includes('cancelled') ? 'Cancelled' : status.includes('completed') ? 'Completed' : status[0] || 'Scheduled';
    const partner = session.partnerName || ownerRequest?.partnerName || 'Unknown partner';
    const owner = session.userId || session.ownerId || session.accountId || session.createdBy || ownerRequest?.userId || ownerRequest?.ownerId || ownerRequest?.accountId;
    const sessionKey = session.id || session.meetingId || ownerRequest?.id;
    let ignoreReason = '';

    if (ownerRequest?.id === requestId || session.requestId === requestId || (currentSessionId && session.id === currentSessionId)) ignoreReason = 'current session';
    else if (status.includes('cancelled') || status.includes('completed')) ignoreReason = 'cancelled or completed';
    else if (owner && currentUser && owner !== currentUser) ignoreReason = 'different user';
    else if (sessionKey && seenSessions.has(sessionKey)) ignoreReason = 'duplicate session record';
    else if (!Number.isFinite(existingStart) || !Number.isFinite(duration) || duration <= 0) ignoreReason = 'invalid date or duration';

    if (sessionKey && !ignoreReason) seenSessions.add(sessionKey);
    const sameDate = Number.isFinite(existingStart) && existingParts.date === newParts.date;
    const overlaps = sameDate && newStart < existingEnd && newEnd > existingStart;
    const conflict = !ignoreReason && overlaps;
    console.debug('[SkillSwap] schedule conflict check', {
      existingSession: { date: existingParts.date, startTime: existingParts.time, endTime: existingEndParts.time, status: displayStatus, partner },
      newSession: { date: newParts.date, startTime: newParts.time, endTime: localScheduleParts(newEnd).time },
      conflict,
      ...(ignoreReason ? { ignored: ignoreReason } : {})
    });

    if (conflict && !conflictingRequest) conflictingRequest = ownerRequest || { partnerName: partner };
  }
  return conflictingRequest;
}

function ScheduleSessionForm({ request, initialSession, rescheduling = false, onSubmit, onCancel }) {
  const [form, setForm] = useState(() => {
    if (!initialSession) return { ...defaultSchedule(), mode: 'Online Video Exchange' };
    const parts = localDateTimeParts(initialSession.scheduledAt);
    return { ...parts, durationMinutes: initialSession.durationMinutes || 60, mode: initialSession.mode || 'Online Video Exchange', note: initialSession.note || '' };
  });
  const [error, setError] = useState('');
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const submit = event => {
    event.preventDefault();
    const scheduledAt = new Date(`${form.date}T${form.time}`);
    if (!form.date || !form.time || !Number.isFinite(scheduledAt.getTime()) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.time)) {
      setError('Enter a valid session date and time.');
      return;
    }
    if (scheduledAt.getTime() < Date.now()) {
      setError('Choose a date and time in the future.');
      return;
    }
    onSubmit({ ...form, durationMinutes: Number(form.durationMinutes), scheduledAt: scheduledAt.toISOString() }, setError);
  };
  return <form className="session-form" onSubmit={submit}>
    <div className="session-form-partner"><span>Skill Partner</span><strong>{request.partnerName}</strong></div>
    {!rescheduling && <div className="session-form-skills"><label>Skill to Learn<input className="exchange-input" value={request.wantedSkill} readOnly required /></label><label>Skill to Teach<input className="exchange-input" value={request.offeredSkill} readOnly required /></label></div>}
    <div className="session-form-grid"><label>Session Date<input className="exchange-input" type="date" min={localDateTimeParts(Date.now()).date} value={form.date} onChange={event => change('date', event.target.value)} required /></label><label>Start Time<input className="exchange-input" type="time" value={form.time} onChange={event => change('time', event.target.value)} required /></label><label>Duration<select className="exchange-input" value={form.durationMinutes} onChange={event => change('durationMinutes', event.target.value)}>{SESSION_DURATIONS.map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>{!rescheduling && <label>Session Mode<select className="exchange-input" value={form.mode} onChange={event => change('mode', event.target.value)}><option>Online Video Exchange</option><option>Offline</option></select></label>}</div>
    {!rescheduling && <label>Optional Session Note<textarea className="exchange-input" rows="3" value={form.note} onChange={event => change('note', event.target.value)} placeholder="What would you like to focus on?" /></label>}
    {error && <p className="meeting-error" role="alert">{error}</p>}
    <div className="form-actions"><button className="button button-primary">{rescheduling ? 'Save New Schedule' : 'Schedule Session'}</button><button type="button" className="button button-outline" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function useExchangeData() {
  const [data, setData] = useState(loadExchangeData);
  const dataRef = React.useRef(data);
  const syncQueue = React.useRef(Promise.resolve());
  useEffect(() => {
    if (!authToken()) return;
    if (!localStorage.getItem('skillswap-local-demo-backup')) {
      const oldData = localStorage.getItem(EXCHANGE_STORAGE_KEY);
      if (oldData) localStorage.setItem('skillswap-local-demo-backup', JSON.stringify({ data: oldData }));
    }
    let active = true;
    apiRequest('/me/data').then(payload => {
      if (!active) return;
      const next = { ...loadExchangeData(), ...backendExchangeData(payload) };
      dataRef.current = next;
      saveExchangeData(next);
      setData(next);
    }).catch(error => {
      if (active) window.dispatchEvent(new CustomEvent('skillswap-backend-error', { detail: error.message }));
    });
    return () => { active = false; };
  }, []);
  const update = change => {
    const previous = dataRef.current;
    const next = change(previous);
    dataRef.current = next;
    saveExchangeData(next);
    setData(next);
    if (authToken()) {
      syncQueue.current = syncQueue.current.then(() => syncExchangeChanges(previous, next))
        .catch(error => window.dispatchEvent(new CustomEvent('skillswap-backend-error', { detail: error.message })));
    }
  };
  return [data, update];
}

function currentUserName() {
  const savedName = localStorage.getItem('skillswap-full-name');
  if (savedName) return savedName;
  const email = localStorage.getItem('skillswap-user') || 'SkillSwap Member';
  return email.includes('@') ? email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : email;
}

function partnerWithLocalReviews(partner, reviews) {
  const ratings = reviews.filter(review => review.partnerId === partner.id && Number.isFinite(Number(review.teaching))).map(review => Number(review.teaching));
  if (!ratings.length) return partner;
  const existingSessions = Math.max(partner.teachingSessions, 1);
  const total = partner.teachingRating * existingSessions + ratings.reduce((sum, rating) => sum + rating, 0);
  return { ...partner, teachingRating: Number((total / (existingSessions + ratings.length)).toFixed(1)) };
}

function timelineItem(label, detail) {
  return { id: makeExchangeId(), label, detail, date: new Date().toISOString() };
}

function meetingRoute(request) {
  const meetingId = request.session?.meetingId || request.meeting?.meetingId || request.meeting?.id;
  return meetingId
    ? `/meeting/${encodeURIComponent(meetingId)}`
    : `/video-meeting?exchange=${encodeURIComponent(request.id)}`;
}

function Panel({ className = '', children }) {
  return <section className={`exchange-panel ${className}`}>{children}</section>;
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="exchange-heading"><div><div className="exchange-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Metric({ icon: Icon, label, value, detail }) {
  return <div className="exchange-metric"><span className="metric-icon"><Icon size={17} /></span><span className="metric-label">{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function SkillTags({ skills = [] }) {
  return skills.length
    ? <div className="exchange-tags">{skills.map(skill => <span key={skill.name || skill}>{skill.name || skill}</span>)}</div>
    : <span className="exchange-muted">Not added yet</span>;
}

function Status({ value }) {
  return <span className={`exchange-status status-${value.toLowerCase().replace(/\s+/g, '-')}`}>{value}</span>;
}

function Empty({ title, text, action }) {
  return <div className="exchange-empty"><HeartHandshake size={25} /><strong>{title}</strong><p>{text}</p>{action}</div>;
}

function PartnerCard({ partner, score, details, onRequest, requestSent = false, canRequest = true, requestLabel = 'Send Exchange Request' }) {
  return <article className="partner-card">
    <div className="partner-card-top"><div className="partner-avatar">{partner.initials}</div><div className="partner-heading"><Link to={`/profile?partner=${partner.id}`}><strong>{partner.name}</strong></Link><span>{partner.role}</span></div><div className="match-score"><strong>{score}%</strong><small>match</small></div></div>
    <div className="partner-skill-row"><b>Can teach</b><SkillTags skills={partner.canTeach} /></div>
    <div className="partner-skill-row"><b>Wants to learn</b><SkillTags skills={partner.wantsToLearn} /></div>
    <div className="partner-stats"><span><Star size={14} fill="currentColor" /> {partner.teachingRating.toFixed(1)}</span><span><Coins size={14} /> {partner.credits} credits</span><span><Check size={14} /> {partner.completedExchanges} exchanges</span></div>
    <div className="partner-availability"><Clock3 size={14} /> {partner.availability.join(' / ')} <span>Sample profile</span></div>
    {details?.learnedSkill && <div className="partner-exchange">You teach <b>{details.teachSkill || 'your skill'}</b><ArrowRight size={13} /> learn <b>{details.learnedSkill}</b></div>}
    {details?.factors?.length > 0 && <div className="match-factors">{details.factors.map(factor => <span className={factor.passed ? 'factor-passed' : ''} key={factor.label}>{factor.passed ? <Check size={12} /> : <X size={12} />}{factor.label}</span>)}</div>}
    {details?.learnedSkill && <RecommendedLearningVideo skill={details.learnedSkill} compact />}
    <div className="partner-actions"><Link className="button button-outline" to={`/profile?partner=${partner.id}`}>View Profile</Link><button className="button button-primary" disabled={!canRequest || requestSent} onClick={() => onRequest(partner, details)}>{requestSent ? 'Request sent' : <><Send size={14} /> {requestLabel}</>}</button></div>
  </article>;
}

function createRequest(data, partner, details, toast) {
  if (!data.profile.canTeach.length || !data.profile.wantsToLearn.length) {
    toast?.show('Add one skill to teach and one skill to learn in My Skills first.');
    return false;
  }
  const activeRequest = data.requests.find(request => request.direction === 'sent' && request.partnerId === partner.id && ['Pending', 'Accepted'].includes(request.status));
  if (activeRequest) {
    toast?.show('You already have an active request with this skill partner.');
    return false;
  }
  const offeredSkill = details?.teachSkill || data.profile.canTeach[0].name;
  const wantedSkill = details?.learnedSkill || data.profile.wantsToLearn[0].name;
  const request = {
    id: makeExchangeId(),
    direction: 'sent',
    partnerId: partner.id,
    partnerName: partner.name,
    offeredSkill,
    wantedSkill,
    matchScore: details?.score || 0,
    status: 'Pending',
    date: new Date().toISOString()
  };
  const next = {
    ...data,
    requests: [request, ...data.requests],
    timeline: [timelineItem('Exchange request sent', `${partner.name}: ${offeredSkill} for ${wantedSkill}`), ...data.timeline]
  };
  saveExchangeData(next);
  toast?.show(`Exchange request sent to ${partner.name}.`);
  return next;
}

export function HomePage({ toast }) {
  const navigate = useNavigate();
  return <main className="exchange-home">
    <section className="exchange-hero">
      <div className="exchange-hero-copy"><div className="exchange-eyebrow"><Sparkles size={14} /> Peer-to-peer skill exchange</div><h1>Share What You Know.<br /><em>Learn What You Want.</em></h1><p>Connect with people who can teach what you want to learn while sharing the skills you already know.</p><div className="exchange-hero-actions"><button className="button button-primary" onClick={() => navigate('/ai-match')}>Find My Skill Match <ArrowRight size={16} /></button><button className="button button-outline" onClick={() => navigate('/my-skills')}>Share a Skill <Plus size={15} /></button></div><div className="exchange-hero-proof"><Users size={16} /> Real people. Shared skills. Progress both ways.</div></div>
      <div className="exchange-flow" aria-label="Skill exchange flow">{[['Your Skills', 'Teach what you know'], ['AI Match', 'Compare fit and goals'], ['Skill Partner', 'Meet a two-way match'], ['Exchange', 'Learn from each other'], ['Grow Together', 'Build credits and trust']].map(([title, detail], index) => <div className="exchange-flow-step" key={title}><span className="flow-index">0{index + 1}</span><div><strong>{title}</strong><small>{detail}</small></div>{index < 4 && <ChevronRight className="flow-arrow" size={18} />}</div>)}</div>
    </section>
    <section className="exchange-how"><div className="section-heading"><div><div className="exchange-eyebrow">How SkillSwap works</div><h2>One good exchange changes both sides.</h2></div><button className="text-link" onClick={() => navigate('/dashboard')}>Open dashboard <ArrowRight size={15} /></button></div><div className="exchange-steps">{[
      ['01', 'Create Your Skill Profile', 'Add skills you can teach and skills you want to learn.'],
      ['02', 'Get AI Skill Matches', 'Compare skills, levels, goals, availability, and reputation.'],
      ['03', 'Send an Exchange Request', 'Propose a clear two-way skill exchange to a partner.'],
      ['04', 'Exchange Skills', 'Teach your skill and learn theirs, session by session.'],
      ['05', 'Build Reputation', 'Complete exchanges, earn credits, and share ratings.']
    ].map(([number, title, text]) => <article className="exchange-step" key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <section className="exchange-home-cta"><div><span>Start with what you already know</span><h2>Your next skill partner is out there.</h2></div><button className="button button-light" onClick={() => navigate('/my-skills')}>Build My Skill Profile <ArrowRight size={15} /></button></section>
  </main>;
}

export function DashboardPage({ toast }) {
  const [data, update] = useExchangeData();
  const navigate = useNavigate();
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    data.requests.forEach(request => {
      const session = request.session;
      if (!session || session.mode !== 'Online Video Exchange' || session.status === 'Cancelled') return;
      const minutes = Math.ceil((parseSessionTimestamp(session.scheduledAt) - clock) / 60000);
      if (![30, 15, 5].includes(minutes)) return;
      const key = `skillswap-reminder-${session.id}-${minutes}`;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, 'shown');
      toast?.show(`Starting in ${minutes} minutes: ${request.partnerName}`);
    });
  }, [clock, data.requests, toast]);
  const profile = data.profile;
  const matches = DEMO_PARTNERS.map(partner => ({ partner, details: getMatchDetails(profile, partner) })).filter(item => item.details.learnedSkill).sort((a, b) => b.details.score - a.details.score).slice(0, 3);
  const pending = data.requests.filter(request => request.status === 'Pending');
  const earned = data.creditActivity.filter(activity => activity.amount > 0).reduce((sum, activity) => sum + activity.amount, 0);
  const learned = [...new Set(data.history.map(exchange => exchange.wantedSkill))].filter(Boolean);
  const taught = [...new Set(data.history.map(exchange => exchange.offeredSkill))].filter(Boolean);
  const reputation = data.profile.teachingRating ? `${data.profile.teachingRating.toFixed(1)} ★` : 'New';
  const prioritize = () => {
    if (data.credits < 10) { toast?.show('Complete an exchange to earn credits first.'); return; }
    update(current => ({ ...current, credits: current.credits - 10, creditActivity: [{ id: makeExchangeId(), amount: -10, title: 'Priority skill match', date: new Date().toISOString() }, ...current.creditActivity] }));
    toast?.show('10 credits used for a priority match.');
  };
  return <main className="exchange-page">
    <PageHeading eyebrow="Your exchange control center" title={`Welcome back, ${currentUserName()}`} description="Your skills, partners, requests, and reputation in one place." action={<button className="button button-primary" onClick={() => navigate('/my-skills')}><Plus size={15} /> Update My Skills</button>} />
    <div className="exchange-metrics-grid"><Metric icon={GraduationCap} label="Skills I teach" value={profile.canTeach.length} detail="Ready to share" /><Metric icon={Sparkles} label="Skills I want" value={profile.wantsToLearn.length} detail="Ready to practice" /><Metric icon={Coins} label="Skill Credits" value={data.credits} detail="Virtual, non-monetary" /><Metric icon={Award} label="Reputation" value={reputation} detail={`${data.history.length} completed exchanges`} /><Metric icon={Check} label="Completed Exchanges" value={data.history.length} detail="Keep growing together" /></div>
    <div className="exchange-dashboard-grid">
      <Panel><div className="exchange-panel-heading"><div><div className="exchange-eyebrow">AI-assisted matching</div><h2>Your Top Skill Matches</h2></div><Link to="/ai-match" className="text-link">All matches <ArrowRight size={14} /></Link></div>{matches.length ? <div className="dashboard-match-list">{matches.map(({ partner, details }) => <div className="dashboard-match" key={partner.id}><div className="partner-avatar small">{partner.initials}</div><div className="dashboard-match-main"><Link to={`/profile?partner=${partner.id}`}><strong>{partner.name}</strong></Link><span>{details.learnedSkill} ↔ {details.teachSkill || 'Your skill'}</span></div><b className="dashboard-score">{details.score}%</b><button className="icon-button" aria-label={`Request exchange with ${partner.name}`} onClick={() => { const next = createRequest(data, partner, details, toast); if (next) update(() => next); }}><Send size={16} /></button></div>)}</div> : <Empty title="Add skills to find your first match" text="Tell us what you can teach and what you want to learn to see compatible people." action={<Link className="button button-outline" to="/my-skills">Set up My Skills</Link>} />}</Panel>
      <Panel><div className="exchange-panel-heading"><div><div className="exchange-eyebrow">Needs your attention</div><h2>Pending Requests</h2></div><Link to="/my-exchanges" className="text-link">Inbox <ArrowRight size={14} /></Link></div>{pending.length ? <div className="compact-request-list">{pending.slice(0, 4).map(request => <div key={request.id}><strong>{request.partnerName}</strong><span>{request.offeredSkill} ↔ {request.wantedSkill}</span><Status value={request.status} /></div>)}</div> : <Empty title="No pending requests" text="Your sent and incoming exchange requests will show here." />}</Panel>
      <Panel className="upcoming-exchanges"><div className="exchange-panel-heading"><div><div className="exchange-eyebrow">Accepted skill sessions</div><h2>Upcoming Skill Exchanges</h2></div><Link to="/my-exchanges" className="text-link">All exchanges <ArrowRight size={14} /></Link></div>{data.requests.filter(request => request.session && !['Cancelled', 'Completed'].includes(sessionStatus(request.session, clock))).length ? <div className="upcoming-list">{data.requests.filter(request => request.session && !['Cancelled', 'Completed'].includes(sessionStatus(request.session, clock))).map(request => { const session = request.session; const status = sessionStatus(session, clock); const join = joinSessionState(session, clock); const startsAt = new Date(parseSessionTimestamp(session.scheduledAt)); return <article className="upcoming-item session-upcoming-item" key={request.id}><div className="upcoming-person"><span className="partner-avatar small">{request.partnerName.split(' ').map(part => part[0]).join('').slice(0, 2)}</span><div><strong>{request.partnerName}</strong><span>Learn {request.wantedSkill} · Teach {request.offeredSkill}</span></div></div><div className="upcoming-time"><span>{startsAt.toLocaleDateString()} · {startsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><span>{session.durationMinutes} min · {session.mode === 'Online Video Exchange' ? 'Online' : 'Offline'}</span><Status value={status} /></div><div className="upcoming-session-actions">{session.mode === 'Online Video Exchange' && (join.allowed ? <Link className="button button-primary" to={`/video-meeting?exchange=${encodeURIComponent(request.id)}`}><Video size={14} /> Join Video Exchange</Link> : <span className="session-countdown">{join.label}</span>)}<Link className="button button-outline" to={`/sessions/${encodeURIComponent(session.id)}`}>Session Details</Link></div></article>; })}</div> : <Empty title="No upcoming sessions" text="Accepted exchanges with a scheduled session will appear here." action={<Link className="button button-outline" to="/my-exchanges">View Exchange Requests</Link>} />}</Panel>
      <Panel><div className="exchange-panel-heading"><div><div className="exchange-eyebrow">Skill economy</div><h2>Skill Credits</h2></div><Coins size={19} /></div><div className="credits-balance"><strong>{data.credits}</strong><span>credits</span></div><p className="exchange-muted">Earn 20 credits when you complete an exchange. Use 10 to prioritize a match.</p><button className="button button-outline" disabled={data.credits < 10} onClick={prioritize}><ArrowDownRight size={15} /> Use 10 credits</button><div className="credit-recent"><b>Credit Activity</b>{data.creditActivity.slice(0, 3).map(activity => <div key={activity.id}><span>{activity.title}</span><strong className={activity.amount > 0 ? 'credit-positive' : 'credit-negative'}>{activity.amount > 0 ? '+' : ''}{activity.amount}</strong></div>)}</div></Panel>
      <Panel><div className="exchange-panel-heading"><div><div className="exchange-eyebrow">Your next milestone</div><h2>Skill Growth</h2></div><TrendingUp size={19} /></div><div className="growth-summary"><div><strong>{taught.length}</strong><span>Skills taught</span></div><div><strong>{learned.length}</strong><span>Skills learned</span></div><div><strong>{earned}</strong><span>Credits earned</span></div></div><div className="timeline-list">{data.timeline.slice(0, 4).map(item => <div className="timeline-item" key={item.id}><span className="timeline-dot" /><div><strong>{item.label}</strong><p>{item.detail}</p><small>{new Date(item.date).toLocaleDateString()}</small></div></div>)}{!data.timeline.length && <p className="exchange-muted">Your skill journey will appear here as you add skills and complete exchanges.</p>}</div><Link to="/skill-gap" className="text-link">Open Skill Gap Detector <ArrowRight size={14} /></Link></Panel>
    </div>
  </main>;
}

export function MySkillsPage({ toast }) {
  const [data, update] = useExchangeData();
  const [teachForm, setTeachForm] = useState({ name: '', level: 'Intermediate', experience: '' });
  const [learnForm, setLearnForm] = useState({ name: '', currentLevel: 'Beginner', targetLevel: 'Intermediate', goal: 'Career Development' });
  const [showTeach, setShowTeach] = useState(false);
  const [showLearn, setShowLearn] = useState(false);
  const [profile, setProfile] = useState(data.profile);
  useEffect(() => setProfile(data.profile), [data.profile]);
  const addSkill = (kind, event) => {
    event.preventDefault();
    const form = kind === 'teach' ? teachForm : learnForm;
    const listKey = kind === 'teach' ? 'canTeach' : 'wantsToLearn';
    if (data.profile[listKey].some(skill => skill.name.toLowerCase() === form.name.trim().toLowerCase())) {
      toast?.show('That skill is already in your profile.');
      return;
    }
    const newSkill = { ...form, id: makeExchangeId(), name: form.name.trim() };
    update(current => ({
      ...current,
      profile: { ...current.profile, [listKey]: [...current.profile[listKey], newSkill] },
      timeline: [timelineItem(kind === 'teach' ? 'Added a teaching skill' : 'Added a learning goal', newSkill.name), ...current.timeline]
    }));
    if (kind === 'teach') { setTeachForm({ name: '', level: 'Intermediate', experience: '' }); setShowTeach(false); }
    else { setLearnForm({ name: '', currentLevel: 'Beginner', targetLevel: 'Intermediate', goal: data.profile.goal || 'Career Development' }); setShowLearn(false); }
    toast?.show('My Skills profile updated.');
  };
  const removeSkill = (kind, id) => {
    const listKey = kind === 'teach' ? 'canTeach' : 'wantsToLearn';
    const removed = data.profile[listKey].find(skill => skill.id === id);
    update(current => ({ ...current, profile: { ...current.profile, [listKey]: current.profile[listKey].filter(skill => skill.id !== id) }, timeline: [timelineItem('Updated My Skills', `Removed ${removed?.name || 'a skill'}`), ...current.timeline] }));
  };
  const savePreferences = event => {
    event.preventDefault();
    update(current => ({ ...current, profile: { ...current.profile, bio: profile.bio || '', role: profile.role || '', goal: profile.goal, availability: profile.availability } }));
    toast?.show('Matching preferences saved.');
  };
  return <main className="exchange-page">
    <PageHeading eyebrow="Your exchange profile" title="My Skills" description="Show the community what you can teach and what you want to learn." action={<Link className="button button-primary" to="/ai-match"><Sparkles size={15} /> Find My Skill Match</Link>} />
    <div className="skill-columns">
      <Panel className="skill-column"><div className="exchange-panel-heading"><div><div className="exchange-eyebrow">Share your experience</div><h2>Skills I Can Teach</h2></div><span className="skill-count">{data.profile.canTeach.length}</span></div><p className="exchange-muted">Skills you can offer to a partner.</p><div className="owned-skills">{data.profile.canTeach.map(skill => <article className="owned-skill" key={skill.id}><div><strong>{skill.name}</strong><span>Level: {skill.level} · Experience: {skill.experience || 'Add experience'}</span></div><button className="icon-button" onClick={() => removeSkill('teach', skill.id)} aria-label={`Remove ${skill.name}`}><Trash2 size={15} /></button></article>)}{!data.profile.canTeach.length && <Empty title="No teaching skills yet" text="Add a skill you are comfortable sharing with someone." />}</div>{showTeach ? <form className="exchange-form" onSubmit={event => addSkill('teach', event)}><label>Skill name<input className="exchange-input" value={teachForm.name} onChange={event => setTeachForm({ ...teachForm, name: event.target.value })} placeholder="JavaScript" required /></label><label>Skill level<select className="exchange-input" value={teachForm.level} onChange={event => setTeachForm({ ...teachForm, level: event.target.value })}>{SKILL_LEVELS.map(level => <option key={level}>{level}</option>)}</select></label><label>Teaching experience<input className="exchange-input" value={teachForm.experience} onChange={event => setTeachForm({ ...teachForm, experience: event.target.value })} placeholder="e.g. 2 years" /></label><div className="form-actions"><button className="button button-primary">Add Skill</button><button type="button" className="button button-outline" onClick={() => setShowTeach(false)}>Cancel</button></div></form> : <button className="button button-outline" onClick={() => setShowTeach(true)}><Plus size={15} /> Add Skill I Can Teach</button>}</Panel>
      <Panel className="skill-column"><div className="exchange-panel-heading"><div><div className="exchange-eyebrow">Choose your next step</div><h2>Skills I Want to Learn</h2></div><span className="skill-count">{data.profile.wantsToLearn.length}</span></div><p className="exchange-muted">Goals to exchange toward with a skill partner.</p><div className="owned-skills">{data.profile.wantsToLearn.map(skill => <article className="owned-skill" key={skill.id}><div><strong>{skill.name}</strong><span>Current: {skill.currentLevel} → Target: {skill.targetLevel}</span><span>Goal: {skill.goal}</span></div><button className="icon-button" onClick={() => removeSkill('learn', skill.id)} aria-label={`Remove ${skill.name}`}><Trash2 size={15} /></button></article>)}{!data.profile.wantsToLearn.length && <Empty title="No learning goals yet" text="Add a skill you want another person to teach you." />}</div>{showLearn ? <form className="exchange-form" onSubmit={event => addSkill('learn', event)}><label>Skill name<input className="exchange-input" value={learnForm.name} onChange={event => setLearnForm({ ...learnForm, name: event.target.value })} placeholder="Python" required /></label><label>Current level<select className="exchange-input" value={learnForm.currentLevel} onChange={event => setLearnForm({ ...learnForm, currentLevel: event.target.value })}>{SKILL_LEVELS.map(level => <option key={level}>{level}</option>)}</select></label><label>Target level<select className="exchange-input" value={learnForm.targetLevel} onChange={event => setLearnForm({ ...learnForm, targetLevel: event.target.value })}>{SKILL_LEVELS.map(level => <option key={level}>{level}</option>)}</select></label><label>Learning goal<select className="exchange-input" value={learnForm.goal} onChange={event => setLearnForm({ ...learnForm, goal: event.target.value })}>{LEARNING_GOALS.map(goal => <option key={goal}>{goal}</option>)}</select></label><div className="form-actions"><button className="button button-primary">Add Learning Goal</button><button type="button" className="button button-outline" onClick={() => setShowLearn(false)}>Cancel</button></div></form> : <button className="button button-outline" onClick={() => setShowLearn(true)}><Plus size={15} /> Add Skill I Want to Learn</button>}</Panel>
    </div>
    <Panel className="preferences-panel"><div className="exchange-panel-heading"><div><div className="exchange-eyebrow">Your public profile</div><h2>About You and Availability</h2></div></div><form className="preferences-form" onSubmit={savePreferences}><label>Role or headline<input className="exchange-input" maxLength="100" value={profile.role || ''} onChange={event => setProfile({ ...profile, role: event.target.value })} placeholder="e.g. Computer Science student" /></label><label>About you<textarea className="exchange-input" rows="3" maxLength="1000" value={profile.bio || ''} onChange={event => setProfile({ ...profile, bio: event.target.value })} placeholder="Share a little about your background and learning goals." /></label><label>Learning goal<select className="exchange-input" value={profile.goal || ''} onChange={event => setProfile({ ...profile, goal: event.target.value })}><option value="">Choose a goal</option>{LEARNING_GOALS.map(goal => <option key={goal}>{goal}</option>)}</select></label><fieldset className="availability-field"><legend>Availability</legend><div>{AVAILABILITY_OPTIONS.map(time => <label key={time} className="checkbox-option"><input type="checkbox" checked={profile.availability.includes(time)} onChange={() => setProfile({ ...profile, availability: profile.availability.includes(time) ? profile.availability.filter(value => value !== time) : [...profile.availability, time] })} />{time}</label>)}</div></fieldset><button className="button button-primary">Save Profile</button></form></Panel>
  </main>;
}

function MatchingPage({ toast, partnersOnly = false }) {
  const [data, update] = useExchangeData();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('skill') || data.profile.wantsToLearn[0]?.name || '');
  const [level, setLevel] = useState('Any level');
  const [availability, setAvailability] = useState('Any time');
  const [minimumRating, setMinimumRating] = useState('Any rating');
  const [submitted, setSubmitted] = useState(false);
  const [apiMatches, setApiMatches] = useState([]);
  const [matchError, setMatchError] = useState('');
  const profileReady = data.profile.canTeach.length > 0 && data.profile.wantsToLearn.length > 0;
  const loadMatches = async skill => {
    try {
      const found = await apiRequest(`/matches?skill=${encodeURIComponent(skill || '')}`);
      setApiMatches(found.map(person => {
        const canTeach = person.canTeach.map(item => typeof item === 'string' ? item : item.name);
        const wantsToLearn = person.wantsToLearn.map(item => typeof item === 'string' ? item : item.name);
        const partner = { ...person, id: Number(person.id), initials: person.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase(),
          canTeach, wantsToLearn, teachingRating: Number(person.teachingRating || 0), credits: Number(person.credits || 0),
          completedExchanges: Number(person.completedExchanges || 0), availability: person.availability || [] };
        return { partner, details: { score: person.matchScore, learnedSkill: person.wantedSkill, teachSkill: person.offeredSkill, factors: [] } };
      }));
      setMatchError('');
    } catch (error) { setMatchError(error.message); }
  };
  useEffect(() => { if (authToken()) loadMatches(query); }, [data.profile]);
  const candidates = apiMatches.filter(({ partner }) => {
    const levelMatch = level === 'Any level' || partner.canTeach.some(skill => partner.levels?.[skill] === level);
    const timeMatch = availability === 'Any time' || partner.availability.includes(availability);
    const ratingMatch = minimumRating === 'Any rating' || partner.teachingRating >= Number(minimumRating);
    return levelMatch && timeMatch && ratingMatch;
  });
  const send = (partner, details) => {
    const next = createRequest(data, partner, details, toast);
    if (next) update(() => next);
  };
  const hasActiveRequest = partnerId => data.requests.some(request => request.direction === 'sent' && request.partnerId === partnerId && ['Pending', 'Accepted'].includes(request.status));
  return <main className="exchange-page">
    <PageHeading eyebrow={partnersOnly ? 'People-first discovery' : 'AI-assisted skill matching'} title={partnersOnly ? 'Explore Skill Partners' : 'AI Skill Match'} description={partnersOnly ? 'Find people who can teach what you want to learn, and who want to learn what you can teach.' : 'A transparent, rule-based match score compares skills, levels, goals, availability, and teaching reputation.'} />
    {!profileReady && <div className="profile-nudge"><Sparkles size={17} /><span><strong>Complete My Skills for mutual matches.</strong> Add at least one skill you can teach and one you want to learn.</span><Link to="/my-skills" className="button button-outline">Set up My Skills <ArrowRight size={14} /></Link></div>}
    <Panel className="matching-search"><form className="match-filters" onSubmit={event => { event.preventDefault(); setSubmitted(true); loadMatches(query); }}><label className="match-query"><span>{partnersOnly ? 'I want to learn' : 'Skill I want to learn'}</span><div className="match-search-box"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Try Python, React, or Figma" /></div></label><label><span>Teaching level</span><select className="exchange-input" value={level} onChange={event => setLevel(event.target.value)}><option>Any level</option>{SKILL_LEVELS.map(value => <option key={value}>{value}</option>)}</select></label><label><span>Availability</span><select className="exchange-input" value={availability} onChange={event => setAvailability(event.target.value)}><option>Any time</option>{AVAILABILITY_OPTIONS.map(value => <option key={value}>{value}</option>)}</select></label><label><span>Teaching rating</span><select className="exchange-input" value={minimumRating} onChange={event => setMinimumRating(event.target.value)}><option>Any rating</option><option value="4.5">4.5+</option><option value="4.8">4.8+</option><option value="4.9">4.9+</option></select></label><button className="button button-primary"><Search size={15} /> Find Partners</button></form></Panel>
    {matchError && <p className="meeting-error" role="alert">{matchError}</p>}
    <div className="match-result-heading"><div><div className="exchange-eyebrow">{partnersOnly ? 'Community sample profiles' : 'Your compatibility results'}</div><h2>{candidates.length} {partnersOnly ? 'skill partners' : 'potential matches'}</h2></div><span>Scores are rule-based, not generated by an external AI model.</span></div>
    {candidates.length ? <div className="partner-grid">{candidates.map(({ partner, details }) => <PartnerCard key={partner.id} partner={partner} score={details.score} details={details} onRequest={send} requestSent={hasActiveRequest(partner.id)} canRequest={profileReady} />)}</div> : <Empty title={submitted ? 'No partners match these filters' : 'No matching skill partners yet'} text="Try another skill or adjust your filters. You can also add more skills to your profile." action={<Link to="/my-skills" className="button button-outline">Edit My Skills</Link>} />}
  </main>;
}

export function SkillPartnersPage({ toast }) {
  return <MatchingPage toast={toast} partnersOnly />;
}

export function AiSkillMatchPage({ toast }) {
  return <MatchingPage toast={toast} />;
}

function ExchangeRequestCard({ request, onStatus, onSchedule, onReview }) {
  const [reviewing, setReviewing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [ratings, setRatings] = useState({ teaching: 5, learning: 5, communication: 5, comment: '' });
  const alreadyReviewed = request.reviewed;
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  return <article className="request-card"><div className="request-card-top"><div><div className="exchange-eyebrow">{request.direction === 'incoming' ? 'Incoming request' : 'Sent request'}{request.sample && ' · Sample'}</div><h3>{request.partnerName}</h3></div><Status value={request.status} /></div><div className="request-exchange"><span>{request.direction === 'incoming' ? 'They teach' : 'You teach'} <strong>{request.direction === 'incoming' ? request.wantedSkill : request.offeredSkill}</strong></span><ArrowRight size={15} /><span>{request.direction === 'incoming' ? 'They want to learn' : 'You learn'} <strong>{request.direction === 'incoming' ? request.offeredSkill : request.wantedSkill}</strong></span></div><div className="request-meta"><span><Sparkles size={14} /> {request.matchScore}% match</span><span><CalendarDays size={14} /> {new Date(request.date).toLocaleDateString()}</span></div>
    {request.status === 'Pending' && request.direction === 'incoming' && <div className="request-actions"><button className="button button-primary" onClick={() => onStatus(request, 'Accepted')}><Check size={14} /> Accept Request</button><button className="button button-outline" onClick={() => onStatus(request, 'Rejected')}><X size={14} /> Reject</button></div>}
    {request.status === 'Pending' && request.direction === 'sent' && <button className="button button-outline" onClick={() => onStatus(request, 'Cancelled')}>Cancel Request</button>}
    {request.status === 'Accepted' && <div className="accepted-session"><div className="accepted-session-heading"><span className="exchange-eyebrow">Accepted Skill Exchange</span>{request.session && <Status value={sessionStatus(request.session, clock)} />}</div>{request.session ? <><div className="request-meta"><span><CalendarDays size={14} /> {new Date(request.session.scheduledAt).toLocaleString()}</span><span>{request.session.durationMinutes} minutes · {request.session.mode === 'Online Video Exchange' ? 'Online' : 'Offline'}</span><span>{request.session.id}</span></div><div className="request-actions"><Link className="button button-outline" to={`/sessions/${encodeURIComponent(request.session.id)}`}>Session Details</Link>{request.session.mode === 'Online Video Exchange' && (() => { const join = joinSessionState(request.session, clock); return join.allowed ? <Link className="button button-primary" to={`/video-meeting?exchange=${encodeURIComponent(request.id)}`}><Video size={15} /> Join Video Exchange</Link> : <span className="session-countdown">{join.label}</span>; })()}{request.meeting?.inviteUrl && <button className="button button-outline" onClick={async () => { try { await navigator.clipboard.writeText(request.meeting.inviteUrl); window.alert('Private participant invite link copied. Share it only with your exchange partner.'); } catch { window.prompt('Copy this private participant invite link:', request.meeting.inviteUrl); } }}><LinkIcon size={14} /> Copy Partner Invite</button>}</div></> : scheduling ? <ScheduleSessionForm request={request} onSubmit={(form, setError) => onSchedule(request, form, setError)} onCancel={() => setScheduling(false)} /> : <button className="button button-primary" onClick={() => setScheduling(true)}><CalendarDays size={15} /> Schedule Skill Exchange</button>}</div>}
    {request.status === 'Completed' && (alreadyReviewed ? <p className="review-submitted"><Check size={15} /> Review submitted</p> : <div className="review-area"><button className="button button-outline" onClick={() => setReviewing(!reviewing)}>{reviewing ? 'Close review' : 'Rate Your Skill Partner'}</button>{reviewing && <form className="exchange-form review-form" onSubmit={event => { event.preventDefault(); onReview(request, ratings); setReviewing(false); }}><label>Teaching rating<select className="exchange-input" value={ratings.teaching} onChange={event => setRatings({ ...ratings, teaching: Number(event.target.value) })}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} stars</option>)}</select></label><label>Learning experience<select className="exchange-input" value={ratings.learning} onChange={event => setRatings({ ...ratings, learning: Number(event.target.value) })}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} stars</option>)}</select></label><label>Communication<select className="exchange-input" value={ratings.communication} onChange={event => setRatings({ ...ratings, communication: Number(event.target.value) })}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} stars</option>)}</select></label><label>Feedback<textarea className="exchange-input" value={ratings.comment} onChange={event => setRatings({ ...ratings, comment: event.target.value })} placeholder="What worked well?" /></label><button className="button button-primary">Submit Review</button></form>}</div>)}
  </article>;
}

export function MyExchangesPage({ toast }) {
  const [data, update] = useExchangeData();
  const [filter, setFilter] = useState('All');
  const requests = data.requests.filter(request => filter === 'All' || (filter === 'Active' ? request.status === 'Accepted' : request.status === filter));
  const addSample = () => {
    if (data.requests.some(request => request.sample && request.status === 'Pending')) return;
    const sample = { id: makeExchangeId(), direction: 'incoming', partnerId: 'rahul-patil', partnerName: 'Rahul Patil', offeredSkill: 'JavaScript', wantedSkill: 'Python', matchScore: 92, status: 'Pending', date: new Date().toISOString(), sample: true };
    update(current => ({ ...current, requests: [sample, ...current.requests] }));
    toast?.show('Sample request added. Accept or reject it to preview the inbox.');
  };
  const setStatus = (request, status) => {
    update(current => ({ ...current, requests: current.requests.map(item => item.id === request.id ? { ...item, status } : item), timeline: [timelineItem(status === 'Accepted' ? 'Exchange request accepted' : `Request ${status.toLowerCase()}`, `${request.partnerName}: ${request.offeredSkill} ↔ ${request.wantedSkill}`), ...current.timeline] }));
    toast?.show(status === 'Accepted' ? 'Request accepted. Schedule a session with your partner.' : `Request ${status.toLowerCase()}.`);
  };
  const scheduleSession = async (request, form, setError) => {
    const conflict = scheduleConflict(data, request.id, form.scheduledAt, form.durationMinutes);
    if (conflict) {
      setError(`This time overlaps with your session with ${conflict.partnerName}. Choose another time.`);
      return;
    }
    const sessionId = makeExchangeId();
    const userId = localStorage.getItem('skillswap-user-id') || localStorage.getItem('skillswap-user') || '';
    let meeting;
    if (form.mode === 'Online Video Exchange') {
      try {
        const response = await createMeetingRoom({
          ...request,
          sessionId,
          participant1Id: userId,
          participant2Id: request.partnerId,
          scheduledAt: form.scheduledAt,
          durationMinutes: form.durationMinutes
        }, { id: userId, name: currentUserName() });
        const inviteUrl = new URL('/video-meeting', window.location.origin);
        inviteUrl.searchParams.set('room', response.meeting.id);
        inviteUrl.searchParams.set('invite', response.inviteToken);
        meeting = {
          ...response.meeting,
          id: response.meeting.id,
          meetingId: response.meeting.meetingId || response.meeting.id,
          sessionId,
          exchangeId: request.id,
          participant1Id: userId,
          participant2Id: request.partnerId,
          participant1Name: currentUserName(),
          participant2Name: request.partnerName,
          skillToLearn: request.wantedSkill,
          skillToTeach: request.offeredSkill,
          scheduledAt: form.scheduledAt,
          durationMinutes: form.durationMinutes,
          mode: form.mode,
          hostToken: response.token,
          guestToken: response.inviteToken,
          inviteToken: response.inviteToken,
          inviteUrl: inviteUrl.toString(),
          role: 'host'
        };
      } catch (error) {
        setError(error.message);
        return;
      }
    }
    const scheduleParts = localScheduleParts(parseSessionTimestamp(form.scheduledAt));
    const session = {
      id: sessionId,
      sessionId,
      exchangeId: request.id,
      meetingId: meeting?.meetingId || meeting?.id || null,
      participant1Id: userId,
      participant2Id: request.partnerId,
      participant1Name: currentUserName(),
      participant2Name: request.partnerName,
      skillToLearn: request.wantedSkill,
      skillToTeach: request.offeredSkill,
      date: scheduleParts.date,
      startTime: scheduleParts.time,
      scheduledAt: form.scheduledAt,
      duration: form.durationMinutes,
      durationMinutes: form.durationMinutes,
      mode: form.mode,
      note: form.note.trim(),
      notes: '',
      status: 'Scheduled'
    };
    update(current => ({
      ...current,
      requests: current.requests.map(item => item.id === request.id ? { ...item, status: 'Accepted', session, ...(meeting ? { meeting } : {}) } : item),
      timeline: [timelineItem('Skill exchange session scheduled', `${request.partnerName}: ${request.offeredSkill} ↔ ${request.wantedSkill}`), ...current.timeline]
    }));
    toast?.show(form.mode === 'Online Video Exchange' ? 'Session scheduled. A private WebRTC room is ready.' : 'Offline skill exchange scheduled.');
  };
  const completeExchange = request => {
    update(current => completeExchangeSession(current, request.id));
    toast?.show('Exchange completed. 20 Skill Credits earned.');
  };
  const submitReview = (request, ratings) => {
    const review = { id: makeExchangeId(), requestId: request.id, partnerId: request.partnerId, partnerName: request.partnerName, ...ratings, date: new Date().toISOString() };
    update(current => ({ ...current, reviews: [review, ...current.reviews], requests: current.requests.map(item => item.id === request.id ? { ...item, reviewed: true, session: item.session ? { ...item.session, rating: ratings.overall || ratings.teaching } : item.session } : item), history: current.history.map(item => item.requestId === request.id ? { ...item, rating: ratings.overall || ratings.teaching } : item) }));
    toast?.show('Thanks. Your partner feedback has been saved.');
  };
  return <main className="exchange-page">
    <PageHeading eyebrow="Coordinate your learning together" title="My Exchanges" description="Manage incoming and sent requests, then record completed skill exchanges." action={<button className="button button-outline" onClick={addSample}><Plus size={14} /> Preview Sample Request</button>} />
    <div className="exchange-filter-tabs">{['All', 'Pending', 'Active', 'Completed', 'Cancelled', 'Rejected'].map(value => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div>
    {requests.length ? <div className="request-grid">{requests.map(request => <ExchangeRequestCard key={request.id} request={request} onStatus={setStatus} onSchedule={scheduleSession} onReview={submitReview} />)}</div> : <Empty title={`No ${filter === 'All' ? '' : `${filter.toLowerCase()} `}exchange requests`} text="When you or another skill partner sends a request, it will appear here." action={<Link className="button button-primary" to="/explore">Explore Skill Partners</Link>} />}
    <Panel className="exchange-history-panel"><div className="exchange-panel-heading"><div><div className="exchange-eyebrow">Completed and cancelled sessions</div><h2>Exchange History</h2></div><span>{data.history.length} completed · {data.requests.filter(item => item.session?.status === 'Cancelled').length} cancelled</span></div>{data.history.length || data.requests.some(item => item.session?.status === 'Cancelled') ? <div className="history-table-wrap"><table className="history-table"><thead><tr><th>Partner</th><th>Exchange</th><th>Date</th><th>Duration</th><th>Status</th><th>Rating</th><th>Credits</th><th></th></tr></thead><tbody>{[...data.history.map(item => ({ ...item, sessionId: item.sessionId || data.requests.find(request => request.id === item.requestId)?.session?.id })), ...data.requests.filter(request => request.session?.status === 'Cancelled' && !data.history.some(item => item.requestId === request.id)).map(request => ({ id: request.session.id, sessionId: request.session.id, requestId: request.id, partnerName: request.partnerName, offeredSkill: request.offeredSkill, wantedSkill: request.wantedSkill, date: request.session.scheduledAt, durationMinutes: request.session.durationMinutes, status: 'Cancelled', rating: null, credits: 0 }))].map(item => <tr key={item.id}><td>{item.partnerName}</td><td>{item.offeredSkill} ↔ {item.wantedSkill}</td><td>{new Date(item.date).toLocaleDateString()}</td><td>{item.durationMinutes || (item.durationSeconds ? Math.ceil(item.durationSeconds / 60) : '—')} min</td><td><Status value={item.status || 'Completed'} /></td><td>{item.rating ? `${item.rating}.0 ★` : item.status === 'Cancelled' ? '—' : 'Not rated'}</td><td className={item.credits ? 'credit-positive' : ''}>{item.credits ? `+${item.credits}` : '—'}</td><td>{item.sessionId && <Link className="text-link" to={`/sessions/${encodeURIComponent(item.sessionId)}`}>View Session Details</Link>}</td></tr>)}</tbody></table></div> : <p className="exchange-muted">Completed exchanges and ratings will appear here.</p>}</Panel>
  </main>;
}

export function SessionDetailsPage({ toast }) {
  const { sessionId } = useParams();
  const [data, update] = useExchangeData();
  const [clock, setClock] = useState(Date.now());
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [ratings, setRatings] = useState({ teaching: 5, learning: 5, communication: 5, overall: 5, wouldAgain: 'Yes', comment: '' });
  const request = data.requests.find(item => item.session?.id === sessionId);
  const session = request?.session;
  const status = sessionStatus(session, clock);
  const join = joinSessionState(session, clock);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => setNotes(session?.notes || ''), [session?.id, session?.notes]);

  if (!request || !session) {
    return <main className="exchange-page"><PageHeading eyebrow="Session unavailable" title="Skill Exchange Session" description="This session could not be found in your exchange records." /><Link className="button button-outline" to="/my-exchanges">Return to My Exchanges</Link></main>;
  }

  const saveNotes = event => {
    event.preventDefault();
    update(current => ({ ...current, requests: current.requests.map(item => item.id === request.id ? { ...item, session: { ...item.session, notes } } : item) }));
    toast?.show('Session notes saved.');
  };
  const reschedule = async (form, setError) => {
    const conflict = scheduleConflict(data, request.id, form.scheduledAt, form.durationMinutes);
    if (conflict) {
      setError(`This time overlaps with your session with ${conflict.partnerName}. Choose another time.`);
      return;
    }
    setSaving(true);
    let meeting;
    if (session.mode === 'Online Video Exchange') {
      try {
        const meetingId = request.meeting?.meetingId || request.meeting?.id || session.meetingId;
        const userId = localStorage.getItem('skillswap-user-id') || localStorage.getItem('skillswap-user') || '';
        const room = await getMeetingInfo(meetingId, { userId, token: request.meeting?.hostToken });
        if (room.role !== 'host') throw new Error('Only the person who created this video room can reschedule it.');
        const response = await rescheduleMeetingRoom(meetingId, room.token, form.scheduledAt, form.durationMinutes);
        meeting = { ...(request.meeting || {}), ...response.meeting };
      } catch (error) {
        setSaving(false);
        setError(error.message);
        return;
      }
    }
    const rescheduledParts = localScheduleParts(parseSessionTimestamp(form.scheduledAt));
    update(current => ({
      ...current,
      requests: current.requests.map(item => item.id === request.id ? {
        ...item,
        meeting: meeting ? { ...item.meeting, ...meeting } : item.meeting,
        session: {
          ...item.session,
          scheduledAt: form.scheduledAt,
          date: rescheduledParts.date,
          startTime: rescheduledParts.time,
          duration: form.durationMinutes,
          durationMinutes: form.durationMinutes,
          meetingId: meeting?.meetingId || item.session.meetingId,
          status: 'Scheduled'
        }
      } : item),
      timeline: [timelineItem('Skill exchange rescheduled', `${request.partnerName}: ${new Date(form.scheduledAt).toLocaleString()}`), ...current.timeline]
    }));
    setSaving(false);
    setEditingSchedule(false);
    toast?.show('Session schedule updated.');
  };
  const cancelSession = async () => {
    setSaving(true);
    if (session.mode === 'Online Video Exchange') {
      try {
        const meetingId = request.meeting?.meetingId || request.meeting?.id || session.meetingId;
        const userId = localStorage.getItem('skillswap-user-id') || localStorage.getItem('skillswap-user') || '';
        const room = await getMeetingInfo(meetingId, { userId, token: request.meeting?.hostToken || request.meeting?.guestToken });
        await cancelMeetingRoom(meetingId, room.token);
      } catch (error) {
        setSaving(false);
        toast?.show(error.message);
        return;
      }
    }
    update(current => ({
      ...current,
      requests: current.requests.map(item => item.id === request.id ? { ...item, status: 'Cancelled', session: { ...item.session, status: 'Cancelled', cancelledAt: new Date().toISOString() }, meeting: item.meeting ? { ...item.meeting, status: 'Cancelled' } : item.meeting } : item),
      timeline: [timelineItem('Skill exchange session cancelled', `${request.partnerName}: ${request.offeredSkill} ↔ ${request.wantedSkill}`), ...current.timeline]
    }));
    setSaving(false);
    setConfirmCancel(false);
    toast?.show('Skill Exchange session cancelled.');
  };
  const markCompleted = () => {
    update(current => completeExchangeSession(current, request.id));
    toast?.show('Session completed. 20 Skill Credits earned.');
  };
  const submitFeedback = event => {
    event.preventDefault();
    if (request.reviewed) return;
    const review = { id: makeExchangeId(), requestId: request.id, sessionId: session.id, partnerId: request.partnerId, partnerName: request.partnerName, ...ratings, date: new Date().toISOString() };
    update(current => ({
      ...current,
      reviews: [review, ...current.reviews],
      requests: current.requests.map(item => item.id === request.id ? { ...item, reviewed: true, session: { ...item.session, rating: ratings.overall } } : item),
      history: current.history.map(item => item.requestId === request.id ? { ...item, rating: ratings.overall, feedback: ratings.comment } : item)
    }));
    toast?.show('Your skill exchange feedback has been saved.');
  };

  return <main className="exchange-page session-details-page">
    <Link className="back-link" to="/my-exchanges">← My Exchanges</Link>
    <PageHeading eyebrow="Your learning together" title="Skill Exchange Session" description={`${request.partnerName} · ${request.offeredSkill} ↔ ${request.wantedSkill}`} action={<Status value={status} />} />
    <div className="session-detail-layout">
      <Panel className="session-detail-main">
        <div className="session-detail-partner"><span className="partner-avatar">{request.partnerName.split(' ').map(part => part[0]).join('').slice(0, 2)}</span><div><span className="exchange-eyebrow">Skill Partner</span><strong>{request.partnerName}</strong></div></div>
        <div className="session-detail-grid"><div><span>Skill to Learn</span><strong>{request.wantedSkill}</strong></div><div><span>Skill to Teach</span><strong>{request.offeredSkill}</strong></div><div><span>Date</span><strong>{new Date(session.scheduledAt).toLocaleDateString()}</strong></div><div><span>Start Time</span><strong>{new Date(session.scheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong></div><div><span>Duration</span><strong>{session.durationMinutes} minutes</strong></div><div><span>Session Mode</span><strong>{session.mode}</strong></div><div><span>{session.mode === 'Online Video Exchange' ? 'Meeting ID' : 'Session ID'}</span><strong className="session-id-value">{session.id}</strong></div><div><span>Session Status</span><Status value={status} /></div></div>
        {session.note && <div className="session-note-summary"><strong>Session Note</strong><p>{session.note}</p></div>}
        {session.status === 'Cancelled' && <p className="session-cancelled-note">This session was cancelled{session.cancelledAt ? ` on ${new Date(session.cancelledAt).toLocaleString()}` : ''}. Video joining is disabled.</p>}
        {session.mode === 'Online Video Exchange' && join.allowed && request.status !== 'Completed' && <Link className="button button-primary" to={`/video-meeting?exchange=${encodeURIComponent(request.id)}`}><Video size={15} /> Join Video Exchange</Link>}
        {session.mode === 'Online Video Exchange' && !join.allowed && status !== 'Cancelled' && status !== 'Completed' && <span className="session-countdown">{join.label}</span>}
        {status === 'Completed' && request.status !== 'Completed' && <button className="button button-primary" disabled={saving} onClick={markCompleted}><Check size={15} /> Mark as Completed</button>}
        {(status === 'Scheduled' || status === 'Starting Soon') && <div className="session-detail-actions">{editingSchedule ? <ScheduleSessionForm request={request} initialSession={session} rescheduling onSubmit={reschedule} onCancel={() => setEditingSchedule(false)} /> : <><button className="button button-outline" disabled={saving} onClick={() => setEditingSchedule(true)}><CalendarDays size={14} /> Reschedule</button><button className="button button-outline session-cancel-button" disabled={saving} onClick={() => setConfirmCancel(true)}><X size={14} /> Cancel Session</button></>}</div>}
      </Panel>
      <Panel className="session-notes-panel"><div className="exchange-panel-heading"><div><div className="exchange-eyebrow">Keep your learning in one place</div><h2>Session Notes</h2></div></div><form className="exchange-form" onSubmit={saveNotes}><label>Topics, important points, resources, and practice<textarea className="exchange-input" rows="10" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Write your notes here..." /></label><button className="button button-primary"><Check size={14} /> Save Notes</button></form></Panel>
    </div>
    {status === 'Completed' && request.status === 'Completed' && <Panel className="session-feedback-panel"><div className="exchange-panel-heading"><div><div className="exchange-eyebrow">Exchange complete</div><h2>Rate Your Skill Exchange</h2></div></div><div className="completion-summary session-completion-summary"><div><span>Partner</span><strong>{request.partnerName}</strong></div><div><span>Skill learned</span><strong>{request.wantedSkill}</strong></div><div><span>Skill taught</span><strong>{request.offeredSkill}</strong></div><div><span>Session duration</span><strong>{session.durationMinutes} minutes</strong></div><div><span>Completion date</span><strong>{new Date(session.completedAt || Date.now()).toLocaleDateString()}</strong></div></div>{request.reviewed ? <p className="review-submitted"><Check size={15} /> Feedback submitted</p> : <form className="exchange-form session-rating-form" onSubmit={submitFeedback}>{[['teaching', 'Teaching Experience'], ['learning', 'Learning Experience'], ['communication', 'Communication'], ['overall', 'Overall Experience']].map(([key, label]) => <label key={key}>{label}<select className="exchange-input" value={ratings[key]} onChange={event => setRatings(current => ({ ...current, [key]: Number(event.target.value) }))}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{'★'.repeat(value)} ({value})</option>)}</select></label>)}<label>Would you exchange skills with this person again?<select className="exchange-input" value={ratings.wouldAgain} onChange={event => setRatings(current => ({ ...current, wouldAgain: event.target.value }))}><option>Yes</option><option>No</option></select></label><label>Feedback<textarea className="exchange-input" rows="3" value={ratings.comment} onChange={event => setRatings(current => ({ ...current, comment: event.target.value }))} placeholder="Share what made this exchange useful." /></label><button className="button button-primary">Submit Feedback</button></form>}</Panel>}
    {confirmCancel && <div className="session-confirm-backdrop"><section className="session-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-session-title"><h2 id="cancel-session-title">Are you sure you want to cancel this Skill Exchange session?</h2><p>The meeting room will no longer be available to join.</p><div className="form-actions"><button className="button button-danger" disabled={saving} onClick={cancelSession}>Cancel Session</button><button className="button button-outline" onClick={() => setConfirmCancel(false)}>Keep Session</button></div></section></div>}
  </main>;
}

export function SkillGapPage() {
  const [data] = useExchangeData();
  const navigate = useNavigate();
  const [goal, setGoal] = useState('Frontend Developer');
  const goalSkills = {
    'Frontend Developer': ['HTML', 'CSS', 'JavaScript', 'React', 'TypeScript', 'Git'],
    'Backend Developer': ['JavaScript', 'Node.js', 'SQL', 'API Design', 'Git'],
    'Product Designer': ['UI/UX Design', 'Figma', 'Prototyping', 'User Research']
  };
  const owned = data.profile.canTeach.map(skill => skill.name.toLowerCase());
  const current = new Set(owned);
  const gaps = goalSkills[goal].filter(skill => !current.has(skill.toLowerCase()));
  const covered = goalSkills[goal].filter(skill => current.has(skill.toLowerCase()));
  const helpfulPartners = DEMO_PARTNERS.filter(partner => partner.canTeach.some(skill => gaps.some(gap => gap.toLowerCase() === skill.toLowerCase()))).slice(0, 3);
  return <main className="exchange-page"><PageHeading eyebrow="Turn a career goal into a people-powered plan" title="Skill Gap Detector" description="Compare your current skill profile with a goal, then find community members who can help you bridge the gaps." /><Panel className="gap-goal-panel"><label>Choose a goal<select className="exchange-input" value={goal} onChange={event => setGoal(event.target.value)}>{Object.keys(goalSkills).map(value => <option key={value}>{value}</option>)}</select></label><div className="gap-checklist"><section><h2><Check size={16} /> Skills in your profile</h2>{covered.length ? covered.map(skill => <div className="gap-skill owned" key={skill}><Check size={15} />{skill}</div>) : <p className="exchange-muted">Add skills to My Skills to track what you already know.</p>}</section><section><h2><ArrowDownRight size={16} /> Skills to develop</h2>{gaps.map(skill => <button className="gap-skill missing" key={skill} onClick={() => navigate('/my-skills')}><Plus size={15} />{skill}<span>Add goal</span></button>)}</section></div></Panel><div className="match-result-heading"><div><div className="exchange-eyebrow">Learn from people, not a course list</div><h2>People who can help</h2></div></div>{helpfulPartners.length ? <div className="partner-grid">{helpfulPartners.map(partner => { const skill = gaps.find(gap => partner.canTeach.some(value => value.toLowerCase() === gap.toLowerCase())) || ''; const details = getMatchDetails(data.profile, partner, skill); return <PartnerCard key={partner.id} partner={partner} score={details.score} details={details} onRequest={() => navigate(`/ai-match?skill=${encodeURIComponent(skill)}`)} requestLabel="View Match" />; })}</div> : <Empty title="No partners for these gaps yet" text="Browse Skill Partners or add a learning goal to get more relevant matches." action={<Link className="button button-outline" to="/explore">Explore Skill Partners</Link>} />}</main>;
}

export function ProfilePage({ toast }) {
  const [data] = useExchangeData();
  const [searchParams] = useSearchParams();
  const basePartner = DEMO_PARTNERS.find(item => item.id === searchParams.get('partner'));
  const partner = basePartner ? partnerWithLocalReviews(basePartner, data.reviews) : undefined;
  const partnerReviews = data.reviews.filter(review => review.partnerId === partner?.id);
  const personName = partner?.name || currentUserName();
  const canTeach = partner?.canTeach.map((name, index) => ({ id: `${partner.id}-${index}`, name, level: partner.levels[name], experience: partner.experience })) || data.profile.canTeach;
  const wantsToLearn = partner?.wantsToLearn.map((name, index) => ({ id: `${partner.id}-want-${index}`, name, currentLevel: 'Beginner', targetLevel: 'Intermediate', goal: 'Career Development' })) || data.profile.wantsToLearn;
  const rating = partner?.teachingRating || data.profile.teachingRating;
  const acceptedSessions = data.requests.filter(request => request.status === 'Accepted' && request.meeting?.id && (!partner || request.partnerId === partner.id));
  const sendPartnerRequest = () => {
    const details = getMatchDetails(data.profile, partner);
    const next = createRequest(data, partner, details, toast);
    if (next) { saveExchangeData(next); toast?.show(`Exchange request sent to ${partner.name}.`); }
  };
  const badges = [];
  if (data.history.length >= 1 && rating >= 4.5) badges.push('Trusted Teacher');
  if (data.history.length >= 3) badges.push('Active Skill Exchanger');
  if (data.reviews.length >= 2) badges.push('Consistent Learner');
  if (partner?.completedExchanges >= 10) badges.push('Highly Rated');
  return <main className="exchange-page"><PageHeading eyebrow={partner ? 'Community sample profile' : 'Your skill exchange profile'} title={personName} description={partner ? partner.role : data.profile.bio || 'Add skills you can teach, learning goals, and availability to help people find you.'} action={partner ? <button className="button button-primary" onClick={sendPartnerRequest}><Send size={14} /> Request Skill Exchange</button> : <Link className="button button-primary" to="/my-skills">Edit My Skills <ArrowRight size={14} /></Link>} />
    <div className="profile-metrics exchange-metrics-grid"><Metric icon={Star} label="Skill Reputation" value={rating ? `${rating.toFixed(1)} / 5` : 'New'} detail="Teaching rating" /><Metric icon={HeartHandshake} label="Completed Exchanges" value={partner?.completedExchanges || data.history.length} detail="Recorded exchanges" /><Metric icon={GraduationCap} label="Teaching Sessions" value={partner?.teachingSessions || 0} detail="Skill sessions" /><Metric icon={Coins} label="Skill Credits" value={partner?.credits || data.credits} detail="Virtual credits" /></div>
    {acceptedSessions.length > 0 && <Panel className="profile-online-session"><div><div className="exchange-eyebrow">Online Skill Exchange Available</div><strong>{acceptedSessions[0].offeredSkill} ↔ {acceptedSessions[0].wantedSkill}</strong></div><Link className="button button-primary" to={`/video-meeting?exchange=${encodeURIComponent(acceptedSessions[0].id)}`}><Video size={14} /> Start Video Exchange</Link></Panel>}
    <div className="skill-columns"><Panel><div className="exchange-eyebrow">Share with partners</div><h2>Skills I Can Teach</h2>{canTeach.length ? canTeach.map(skill => <article className="profile-skill" key={skill.id}><strong>{skill.name}</strong><span>Level: {skill.level}</span><small>{skill.experience || 'Teaching details not added'}</small></article>) : <Empty title="No teaching skills listed" text="Add at least one skill you can teach." action={<Link to="/my-skills" className="button button-outline">Add skills</Link>} />}</Panel><Panel><div className="exchange-eyebrow">Your next exchange</div><h2>Skills I Want to Learn</h2>{wantsToLearn.length ? wantsToLearn.map(skill => <article className="profile-skill" key={skill.id}><strong>{skill.name}</strong><span>Current: {skill.currentLevel} → Target: {skill.targetLevel}</span><small>Goal: {skill.goal}</small></article>) : <Empty title="No learning goals listed" text="Add a skill you want to learn with a partner." action={<Link to="/my-skills" className="button button-outline">Add goals</Link>} />}</Panel></div>
    <div className="exchange-dashboard-grid"><Panel><div className="exchange-eyebrow">Earned through exchanges</div><h2>Skill Reputation</h2><div className="reputation-breakdown"><div><span>Teaching Rating</span><strong>{rating ? `${rating.toFixed(1)} ★` : 'Not rated yet'}</strong></div><div><span>Learning Rating</span><strong>{partner ? `${partner.learningRating.toFixed(1)} ★` : 'Not rated yet'}</strong></div><div><span>Learning Sessions</span><strong>{partner?.completedExchanges || data.history.length}</strong></div><div><span>Skill Credits</span><strong>{partner?.credits || data.credits}</strong></div></div><div className="badge-list">{badges.length ? badges.map(badge => <span key={badge}><Award size={14} /> {badge}</span>) : <p className="exchange-muted">Complete exchanges and receive reviews to earn reputation badges.</p>}</div></Panel><Panel><div className="exchange-eyebrow">Community feedback</div><h2>Reviews</h2>{partner ? partnerReviews.length ? partnerReviews.map(review => <article className="profile-review" key={review.id}><strong>You rated {review.partnerName} · {review.teaching} ★</strong><p>{review.comment || 'Skill exchange completed.'}</p></article>) : <p className="exchange-muted">Sample profile. No local feedback has been submitted for this partner.</p> : data.reviews.length ? data.reviews.map(review => <article className="profile-review" key={review.id}><strong>{review.partnerName} · {review.teaching} ★</strong><p>{review.comment || 'Skill exchange completed.'}</p></article>) : <p className="exchange-muted">Reviews you submit after completed exchanges are kept in your local exchange history.</p>}</Panel></div>
  </main>;
}
