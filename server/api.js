import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';

const app = express();
const port = Number(process.env.PORT || 8788);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.startsWith('replace-')) {
  console.error('Set a unique JWT_SECRET with at least 32 characters in server/.env.');
  process.exit(1);
}

app.use(helmet());
app.use(cors({ origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(value => value.trim()) }));
app.use(express.json({ limit: '32kb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

const fail = (res, status, error) => res.status(status).json({ error });
const string = value => typeof value === 'string' ? value.trim() : '';
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const skillKinds = ['teach', 'learn'];

function auth(req, res, next) {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return fail(res, 401, 'Sign in to continue.');
  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return fail(res, 401, 'Your session expired. Please sign in again.');
  }
}

function issueToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: process.env.JWT_EXPIRES_IN || '2h' });
}

async function readProfile(userId) {
  const [[profile]] = await pool.query('SELECT bio, role, goal, availability FROM profiles WHERE user_id = ?', [userId]);
  const [skills] = await pool.query('SELECT id, name, kind, level, target_level AS targetLevel, experience, goal FROM skills WHERE user_id = ? ORDER BY id', [userId]);
  const [[rating]] = await pool.query('SELECT AVG(teaching) AS teachingRating, COUNT(*) AS reviewCount FROM feedback WHERE reviewee_id=?', [userId]);
  const [[stats]] = await pool.query(`SELECT u.credits, COUNT(DISTINCT r.id) AS completedExchanges FROM users u
    LEFT JOIN exchange_requests r ON (r.requester_id=u.id OR r.recipient_id=u.id) AND r.status='Completed'
    WHERE u.id=? GROUP BY u.id`, [userId]);
  return {
    bio: profile?.bio || '', role: profile?.role || '', goal: profile?.goal || '',
    availability: profile?.availability ? JSON.parse(profile.availability) : [],
    teachingRating: Number(rating?.teachingRating || 0), reviewCount: Number(rating?.reviewCount || 0),
    credits: Number(stats?.credits || 0), completedExchanges: Number(stats?.completedExchanges || 0),
    canTeach: skills.filter(skill => skill.kind === 'teach'),
    wantsToLearn: skills.filter(skill => skill.kind === 'learn').map(skill => ({ ...skill, currentLevel: skill.level }))
  };
}

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
  catch { res.status(503).json({ status: 'error', database: 'unavailable' }); }
});

app.post('/api/auth/register', async (req, res, next) => {
  const fullName = string(req.body?.fullName);
  const email = string(req.body?.email).toLowerCase();
  const password = req.body?.password;
  if (fullName.length < 2 || fullName.length > 100) return fail(res, 400, 'Name must be 2 to 100 characters.');
  if (!validEmail(email)) return fail(res, 400, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) return fail(res, 400, 'Password must be at least 8 characters and no more than 72 UTF-8 bytes.');
  const connection = await pool.getConnection();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.beginTransaction();
    const [result] = await connection.execute('INSERT INTO users (email, full_name, password_hash) VALUES (?, ?, ?)', [email, fullName, passwordHash]);
    await connection.execute('INSERT INTO profiles (user_id, availability) VALUES (?, ?)', [result.insertId, '[]']);
    await connection.commit();
    const user = { id: result.insertId, email, fullName };
    res.status(201).json({ token: issueToken(user), user });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'An account with this email already exists.');
    next(error);
  } finally { connection.release(); }
});

app.post('/api/auth/login', async (req, res, next) => {
  const email = string(req.body?.email).toLowerCase();
  const password = req.body?.password;
  if (!validEmail(email) || typeof password !== 'string') return fail(res, 400, 'Enter your email and password.');
  try {
    const [[user]] = await pool.execute('SELECT id, email, full_name AS fullName, password_hash FROM users WHERE email = ?', [email]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return fail(res, 401, 'Email or password is incorrect.');
    delete user.password_hash;
    res.json({ token: issueToken(user), user });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', auth, async (req, res, next) => {
  try {
    const [[user]] = await pool.execute('SELECT id, email, full_name AS fullName FROM users WHERE id = ?', [req.user.id]);
    if (!user) return fail(res, 401, 'Account not found.');
    res.json({ user, profile: await readProfile(user.id) });
  } catch (error) { next(error); }
});

app.get('/api/profile', auth, async (req, res, next) => {
  try { res.json(await readProfile(req.user.id)); } catch (error) { next(error); }
});

app.get('/api/me/data', auth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`SELECT r.id, r.requester_id AS requesterId, r.recipient_id AS recipientId,
      r.offered_skill AS offeredSkill, r.wanted_skill AS wantedSkill, r.match_score AS matchScore, r.status,
      r.created_at AS date, a.full_name AS requesterName, b.full_name AS recipientName,
      s.id AS sessionId, s.meeting_id AS meetingId, s.mode, s.starts_at AS startsAt,
      s.duration_minutes AS durationMinutes, s.note, s.status AS sessionStatus
      FROM exchange_requests r JOIN users a ON a.id=r.requester_id JOIN users b ON b.id=r.recipient_id
      LEFT JOIN sessions s ON s.request_id=r.id WHERE r.requester_id=? OR r.recipient_id=? ORDER BY r.created_at DESC`, [req.user.id, req.user.id]);
    const requests = rows.map(row => {
      const sent = Number(row.requesterId) === Number(req.user.id);
      return { id: row.id, direction: sent ? 'sent' : 'incoming', partnerId: sent ? row.recipientId : row.requesterId,
        partnerName: sent ? row.recipientName : row.requesterName, offeredSkill: row.offeredSkill,
        wantedSkill: row.wantedSkill, matchScore: row.matchScore, status: row.status, date: row.date,
        ...(row.sessionId ? { session: { id: row.sessionId, sessionId: row.sessionId, meetingId: row.meetingId,
          mode: row.mode, scheduledAt: row.startsAt, durationMinutes: row.durationMinutes,
          note: row.note, status: row.sessionStatus } } : {}) };
    });
    const profile = await readProfile(req.user.id);
    const [[user]] = await pool.execute('SELECT id, full_name AS fullName, email, credits FROM users WHERE id=?', [req.user.id]);
    const history = requests.filter(item => item.status === 'Completed').map(item => ({
      id: item.session?.id || item.id, requestId: item.id, sessionId: item.session?.id,
      partnerId: item.partnerId, partnerName: item.partnerName, offeredSkill: item.offeredSkill,
      wantedSkill: item.wantedSkill, date: item.session?.scheduledAt || item.date,
      durationMinutes: item.session?.durationMinutes, status: 'Completed'
    }));
    const [feedbackRows] = await pool.execute(`SELECT f.id, s.request_id AS requestId, f.reviewee_id AS partnerId,
      u.full_name AS partnerName, f.teaching, f.learning, f.communication, f.overall, f.comment, f.created_at AS date
      FROM feedback f JOIN sessions s ON s.id=f.session_id JOIN users u ON u.id=f.reviewee_id WHERE f.reviewer_id=? ORDER BY f.created_at DESC`, [req.user.id]);
    res.json({ user, profile, credits: Number(user.credits), requests, history, reviews: feedbackRows });
  } catch (error) { next(error); }
});

app.put('/api/profile', auth, async (req, res, next) => {
  const { bio = '', role = '', goal = '', availability = [], skills = [] } = req.body || {};
  if (!Array.isArray(availability) || !Array.isArray(skills) || skills.length > 100 || skills.some(skill => !skill || typeof skill !== 'object')) return fail(res, 400, 'Invalid profile data.');
  if (![bio, role, goal].every(value => typeof value === 'string') || bio.length > 1000 || role.length > 100 || goal.length > 100) return fail(res, 400, 'Profile fields are too long or invalid.');
  const cleanSkills = skills.map(skill => ({
    name: string(skill.name), kind: string(skill.kind), level: string(skill.level || skill.currentLevel) || 'Intermediate',
    targetLevel: string(skill.targetLevel) || 'Intermediate', experience: string(skill.experience), goal: string(skill.goal)
  }));
  if (cleanSkills.some(skill => !skill.name || skill.name.length > 100 || !skillKinds.includes(skill.kind))) return fail(res, 400, 'Each skill needs a name and a valid type.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('INSERT INTO profiles (user_id, bio, role, goal, availability) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE bio=VALUES(bio), role=VALUES(role), goal=VALUES(goal), availability=VALUES(availability)', [req.user.id, bio, role, goal, JSON.stringify(availability.filter(value => typeof value === 'string'))]);
    await connection.execute('DELETE FROM skills WHERE user_id = ?', [req.user.id]);
    for (const skill of cleanSkills) await connection.execute('INSERT INTO skills (user_id, name, kind, level, target_level, experience, goal) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.user.id, skill.name, skill.kind, skill.level, skill.targetLevel, skill.experience, skill.goal]);
    await connection.commit();
    res.json(await readProfile(req.user.id));
  } catch (error) { await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'Duplicate skill in your profile.'); next(error); }
  finally { connection.release(); }
});

app.get('/api/matches', auth, async (req, res, next) => {
  try {
    const own = await readProfile(req.user.id);
    const [users] = await pool.execute('SELECT u.id, u.full_name AS name, p.role, p.bio, p.goal, p.availability FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id <> ?', [req.user.id]);
    const results = [];
    for (const person of users) {
      const profile = await readProfile(person.id);
      const query = string(req.query.skill).toLowerCase();
      const canTeach = profile.canTeach.filter(skill => !query || skill.name.toLowerCase().includes(query));
      const learned = own.wantsToLearn.filter(skill => (!query || skill.name.toLowerCase().includes(query)) && profile.canTeach.some(they => they.name.toLowerCase() === skill.name.toLowerCase()));
      const mutual = own.canTeach.filter(skill => profile.wantsToLearn.some(they => they.name.toLowerCase() === skill.name.toLowerCase()));
      if (!canTeach.length || (!learned.length && !mutual.length)) continue;
      const score = Math.min(98, 40 + (learned.length ? 30 : 0) + (mutual.length ? 20 : 0) + (own.goal && own.goal === person.goal ? 5 : 0) + (own.availability.some(value => profile.availability.includes(value)) ? 5 : 0));
      results.push({ id: person.id, name: person.name, role: person.role, bio: person.bio,
        canTeach: profile.canTeach, wantsToLearn: profile.wantsToLearn,
        levels: Object.fromEntries(profile.canTeach.map(skill => [skill.name, skill.level])),
        availability: profile.availability, teachingRating: profile.teachingRating,
        credits: profile.credits, completedExchanges: profile.completedExchanges, matchScore: score,
        offeredSkill: mutual[0]?.name || own.canTeach[0]?.name || '', wantedSkill: learned[0]?.name || canTeach[0].name });
    }
    res.json(results.sort((a, b) => b.matchScore - a.matchScore));
  } catch (error) { next(error); }
});

app.get('/api/requests', auth, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`SELECT r.id, r.requester_id AS requesterId, r.recipient_id AS recipientId,
      r.offered_skill AS offeredSkill, r.wanted_skill AS wantedSkill, r.match_score AS matchScore,
      r.status, r.created_at AS date, a.full_name AS requesterName, b.full_name AS recipientName,
      s.id AS sessionId, s.mode, s.starts_at AS startsAt, s.duration_minutes AS durationMinutes, s.note, s.status AS sessionStatus
      FROM exchange_requests r JOIN users a ON a.id=r.requester_id JOIN users b ON b.id=r.recipient_id
      LEFT JOIN sessions s ON s.request_id=r.id WHERE r.requester_id=? OR r.recipient_id=? ORDER BY r.created_at DESC`, [req.user.id, req.user.id]);
    res.json(rows.map(row => ({ ...row, direction: Number(row.requesterId) === Number(req.user.id) ? 'sent' : 'incoming', partnerId: Number(row.requesterId) === Number(req.user.id) ? row.recipientId : row.requesterId, partnerName: Number(row.requesterId) === Number(req.user.id) ? row.recipientName : row.requesterName, session: row.sessionId ? { id: row.sessionId, mode: row.mode, scheduledAt: row.startsAt, durationMinutes: row.durationMinutes, note: row.note, status: row.sessionStatus } : null })));
  } catch (error) { next(error); }
});

app.post('/api/requests', auth, async (req, res, next) => {
  const recipientId = Number(req.body?.recipientId);
  const offeredSkill = string(req.body?.offeredSkill);
  const wantedSkill = string(req.body?.wantedSkill);
  const matchScore = Number(req.body?.matchScore || 0);
  if (!Number.isSafeInteger(recipientId) || recipientId === Number(req.user.id) || !offeredSkill || !wantedSkill || offeredSkill.length > 100 || wantedSkill.length > 100 || matchScore < 0 || matchScore > 100) return fail(res, 400, 'Invalid exchange request.');
  try {
    const [[match]] = await pool.execute(`SELECT
      EXISTS(SELECT 1 FROM skills WHERE user_id=? AND kind='teach' AND LOWER(name)=LOWER(?)) AS senderTeaches,
      EXISTS(SELECT 1 FROM skills WHERE user_id=? AND kind='learn' AND LOWER(name)=LOWER(?)) AS senderLearns,
      EXISTS(SELECT 1 FROM skills WHERE user_id=? AND kind='teach' AND LOWER(name)=LOWER(?)) AS recipientTeaches,
      EXISTS(SELECT 1 FROM skills WHERE user_id=? AND kind='learn' AND LOWER(name)=LOWER(?)) AS recipientLearns`, [req.user.id, offeredSkill, req.user.id, wantedSkill, recipientId, wantedSkill, recipientId, offeredSkill]);
    if (!match.senderTeaches || !match.senderLearns || !match.recipientTeaches || !match.recipientLearns) return fail(res, 400, 'Both skills must match the users’ saved profiles.');
    const [[active]] = await pool.execute("SELECT id FROM exchange_requests WHERE status IN ('Pending','Accepted') AND ((requester_id=? AND recipient_id=?) OR (requester_id=? AND recipient_id=?)) LIMIT 1", [req.user.id, recipientId, recipientId, req.user.id]);
    if (active) return fail(res, 409, 'You already have an active exchange request with this person.');
    const suppliedId = string(req.body?.id);
    const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedId) ? suppliedId : randomUUID();
    await pool.execute('INSERT INTO exchange_requests (id, requester_id, recipient_id, offered_skill, wanted_skill, match_score) VALUES (?, ?, ?, ?, ?, ?)', [id, req.user.id, recipientId, offeredSkill, wantedSkill, matchScore]);
    res.status(201).json({ id, requesterId: Number(req.user.id), recipientId, offeredSkill, wantedSkill, matchScore, status: 'Pending', date: new Date().toISOString() });
  } catch (error) { if (error.code === 'ER_NO_REFERENCED_ROW_2') return fail(res, 404, 'That skill partner no longer exists.'); next(error); }
});

app.patch('/api/requests/:id', auth, async (req, res, next) => {
  const status = string(req.body?.status);
  if (!['Accepted', 'Rejected', 'Cancelled'].includes(status)) return fail(res, 400, 'Invalid request status.');
  try {
    const [result] = status === 'Cancelled'
      ? await pool.execute("UPDATE exchange_requests SET status=? WHERE id=? AND requester_id=? AND status='Pending'", [status, req.params.id, req.user.id])
      : await pool.execute("UPDATE exchange_requests SET status=? WHERE id=? AND recipient_id=? AND status='Pending'", [status, req.params.id, req.user.id]);
    if (!result.affectedRows) return fail(res, 404, 'Pending request not found or you cannot change it.');
    res.json({ id: req.params.id, status });
  } catch (error) { next(error); }
});

app.post('/api/requests/:id/sessions', auth, async (req, res, next) => {
  const { mode = 'Online Video Exchange', durationMinutes = 60, note = '' } = req.body || {};
  const meetingId = string(req.body?.meetingId) || null;
  const startsAt = new Date(req.body?.startsAt);
  const duration = Number(durationMinutes);
  if (!Number.isFinite(startsAt.getTime()) || startsAt <= new Date() || ![30,45,60,90].includes(duration) || !['Online Video Exchange','Offline'].includes(mode) || typeof note !== 'string' || note.length > 1000) return fail(res, 400, 'Enter a future date, valid duration, mode, and note.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[request]] = await connection.execute("SELECT id, requester_id, recipient_id FROM exchange_requests WHERE id=? AND status='Accepted' FOR UPDATE", [req.params.id]);
    if (!request || ![Number(request.requester_id), Number(request.recipient_id)].includes(Number(req.user.id))) { await connection.rollback(); return fail(res, 404, 'Accepted exchange not found.'); }
    const [conflicts] = await connection.execute(`SELECT s.id FROM sessions s JOIN exchange_requests r ON r.id=s.request_id
      WHERE s.status='Scheduled' AND s.starts_at < DATE_ADD(?, INTERVAL ? MINUTE)
      AND DATE_ADD(s.starts_at, INTERVAL s.duration_minutes MINUTE) > ?
      AND s.request_id <> ? AND (r.requester_id IN (?,?,?) OR r.recipient_id IN (?,?,?)) FOR UPDATE`,
      [startsAt, duration, startsAt, req.params.id, req.user.id, request.requester_id, request.recipient_id, req.user.id, request.requester_id, request.recipient_id]);
    if (conflicts.length) { await connection.rollback(); return fail(res, 409, 'This time overlaps with another scheduled exchange.'); }
    const suppliedId = string(req.body?.sessionId);
    const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedId) ? suppliedId : randomUUID();
    const [[collision]] = await connection.execute('SELECT request_id FROM sessions WHERE id=? FOR UPDATE', [id]);
    if (collision && collision.request_id !== req.params.id) { await connection.rollback(); return fail(res, 409, 'That session identifier is already in use.'); }
    await connection.execute('INSERT INTO sessions (id, request_id, meeting_id, mode, starts_at, duration_minutes, note) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE meeting_id=VALUES(meeting_id), mode=VALUES(mode), starts_at=VALUES(starts_at), duration_minutes=VALUES(duration_minutes), note=VALUES(note), status=\'Scheduled\'', [id, req.params.id, meetingId, mode, startsAt, duration, note.trim()]);
    await connection.commit();
    res.status(201).json({ id, requestId: req.params.id, meetingId, mode, startsAt: startsAt.toISOString(), durationMinutes: duration, note: note.trim(), status: 'Scheduled' });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

app.patch('/api/sessions/:id/status', auth, async (req, res, next) => {
  const status = string(req.body?.status);
  if (!['Completed', 'Cancelled'].includes(status)) return fail(res, 400, 'Invalid session status.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[session]] = await connection.execute(`SELECT s.request_id, s.status AS currentStatus, r.requester_id, r.recipient_id FROM sessions s JOIN exchange_requests r ON r.id=s.request_id
      WHERE s.id=? AND (r.requester_id=? OR r.recipient_id=?) FOR UPDATE`, [req.params.id, req.user.id, req.user.id]);
    if (!session) { await connection.rollback(); return fail(res, 404, 'Session not found.'); }
    if (['Completed', 'Cancelled'].includes(session.currentStatus) && session.currentStatus !== status) { await connection.rollback(); return fail(res, 409, 'This session already has a final status.'); }
    await connection.execute('UPDATE sessions SET status=? WHERE id=?', [status, req.params.id]);
    await connection.execute('UPDATE exchange_requests SET status=? WHERE id=?', [status, session.request_id]);
    if (status === 'Completed' && session.currentStatus !== 'Completed') await connection.execute('UPDATE users SET credits=credits+20 WHERE id IN (?,?)', [session.requester_id, session.recipient_id]);
    await connection.commit();
    res.json({ id: req.params.id, status });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

app.post('/api/sessions/:id/feedback', auth, async (req, res, next) => {
  const values = ['teaching','learning','communication','overall'].map(key => Number(req.body?.[key]));
  const comment = string(req.body?.comment);
  if (values.some(value => !Number.isInteger(value) || value < 1 || value > 5) || comment.length > 2000) return fail(res, 400, 'Ratings must be from 1 to 5 and feedback must be under 2000 characters.');
  try {
    const [[session]] = await pool.execute(`SELECT s.id, r.requester_id, r.recipient_id FROM sessions s JOIN exchange_requests r ON r.id=s.request_id WHERE s.id=? AND s.status='Completed' AND (r.requester_id=? OR r.recipient_id=?)`, [req.params.id, req.user.id, req.user.id]);
    if (!session) return fail(res, 404, 'Completed session not found.');
    const reviewee = Number(session.requester_id) === Number(req.user.id) ? session.recipient_id : session.requester_id;
    await pool.execute('INSERT INTO feedback (session_id, reviewer_id, reviewee_id, teaching, learning, communication, overall, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [session.id, req.user.id, reviewee, ...values, comment]);
    res.status(201).json({ sessionId: session.id, ratings: { teaching: values[0], learning: values[1], communication: values[2], overall: values[3] }, comment });
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'You already reviewed this session.'); next(error); }
});

app.use((error, _req, res, _next) => {
  console.error('API error:', error.message);
  res.status(500).json({ error: 'Server error. Check the API and database logs.' });
});

app.listen(port, '0.0.0.0', () => console.log(`SkillSwap API listening on port ${port}`));
