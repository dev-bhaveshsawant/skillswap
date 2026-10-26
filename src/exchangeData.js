export const EXCHANGE_STORAGE_KEY = 'skillswap-exchange-data';

export const SKILL_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
export const LEARNING_GOALS = ['Career Development', 'Personal Growth', 'Project Support', 'Community Learning'];
export const AVAILABILITY_OPTIONS = ['Morning', 'Afternoon', 'Evening', 'Weekend'];

export const DEMO_PARTNERS = [
  {
    id: 'rahul-patil',
    name: 'Rahul Patil',
    initials: 'RP',
    role: 'Software developer',
    canTeach: ['Python', 'Django', 'SQL'],
    wantsToLearn: ['React', 'JavaScript'],
    levels: { Python: 'Advanced', Django: 'Intermediate', SQL: 'Intermediate' },
    goals: ['Career Development', 'Project Support'],
    availability: ['Evening', 'Weekend'],
    teachingRating: 4.9,
    learningRating: 4.7,
    credits: 120,
    completedExchanges: 15,
    teachingSessions: 12,
    experience: '2 years teaching Python'
  },
  {
    id: 'sneha-joshi',
    name: 'Sneha Joshi',
    initials: 'SJ',
    role: 'Product designer',
    canTeach: ['UI/UX Design', 'Figma', 'Prototyping'],
    wantsToLearn: ['JavaScript', 'React'],
    levels: { 'UI/UX Design': 'Advanced', Figma: 'Advanced', Prototyping: 'Intermediate' },
    goals: ['Career Development', 'Personal Growth'],
    availability: ['Afternoon', 'Evening'],
    teachingRating: 4.8,
    learningRating: 4.9,
    credits: 95,
    completedExchanges: 11,
    teachingSessions: 9,
    experience: '3 years in product design'
  },
  {
    id: 'amit-kulkarni',
    name: 'Amit Kulkarni',
    initials: 'AK',
    role: 'Backend engineer',
    canTeach: ['Java', 'SQL', 'Git'],
    wantsToLearn: ['Python', 'Django'],
    levels: { Java: 'Advanced', SQL: 'Advanced', Git: 'Intermediate' },
    goals: ['Project Support', 'Community Learning'],
    availability: ['Morning', 'Weekend'],
    teachingRating: 4.7,
    learningRating: 4.8,
    credits: 82,
    completedExchanges: 9,
    teachingSessions: 8,
    experience: '4 years building backend systems'
  },
  {
    id: 'maya-chen',
    name: 'Maya Chen',
    initials: 'MC',
    role: 'Product engineer',
    canTeach: ['React', 'TypeScript', 'JavaScript'],
    wantsToLearn: ['Python', 'Photography'],
    levels: { React: 'Advanced', TypeScript: 'Advanced', JavaScript: 'Advanced' },
    goals: ['Career Development', 'Project Support'],
    availability: ['Evening'],
    teachingRating: 4.9,
    learningRating: 4.8,
    credits: 140,
    completedExchanges: 18,
    teachingSessions: 15,
    experience: '5 years building web products'
  },
  {
    id: 'priya-shah',
    name: 'Priya Shah',
    initials: 'PS',
    role: 'Visual storyteller',
    canTeach: ['Photography', 'Lightroom', 'Writing'],
    wantsToLearn: ['Digital Marketing', 'Design'],
    levels: { Photography: 'Advanced', Lightroom: 'Intermediate', Writing: 'Advanced' },
    goals: ['Personal Growth', 'Community Learning'],
    availability: ['Afternoon', 'Weekend'],
    teachingRating: 5.0,
    learningRating: 4.9,
    credits: 105,
    completedExchanges: 13,
    teachingSessions: 10,
    experience: '6 years of visual storytelling'
  }
];

export function createInitialExchangeData() {
  return {
    profile: {
      bio: '',
      canTeach: [],
      wantsToLearn: [],
      goal: '',
      availability: []
    },
    credits: 0,
    requests: [],
    history: [],
    creditActivity: [],
    reviews: [],
    timeline: []
  };
}

export function loadExchangeData() {
  const fallback = createInitialExchangeData();
  try {
    const stored = JSON.parse(localStorage.getItem(EXCHANGE_STORAGE_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return fallback;
    return {
      ...fallback,
      ...stored,
      profile: { ...fallback.profile, ...stored.profile },
      requests: Array.isArray(stored.requests) ? stored.requests : [],
      history: Array.isArray(stored.history) ? stored.history : [],
      sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
      creditActivity: Array.isArray(stored.creditActivity) ? stored.creditActivity : [],
      reviews: Array.isArray(stored.reviews) ? stored.reviews : [],
      timeline: Array.isArray(stored.timeline) ? stored.timeline : []
    };
  } catch {
    return fallback;
  }
}

export function saveExchangeData(data) {
  try {
    localStorage.setItem(EXCHANGE_STORAGE_KEY, JSON.stringify(data));
  } catch {
    return false;
  }
  return true;
}

export function makeExchangeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function completeExchangeSession(data, requestId, durationSeconds = 0) {
  const request = data.requests.find(item => item.id === requestId);
  if (!request?.session || request.session.status === 'Cancelled') return data;
  const existing = data.history.find(item => item.requestId === requestId || item.sessionId === request.session.id || item.meetingId === request.meeting?.id);
  const completedAt = existing?.completedAt || new Date().toISOString();
  const historyItem = {
    id: existing?.id || makeExchangeId(),
    requestId,
    sessionId: request.session.id,
    meetingId: request.meeting?.id || null,
    partnerId: request.partnerId,
    partnerName: request.partnerName,
    offeredSkill: request.offeredSkill,
    wantedSkill: request.wantedSkill,
    date: request.session.scheduledAt,
    completedAt,
    durationMinutes: request.session.durationMinutes,
    durationSeconds: durationSeconds || existing?.durationSeconds || 0,
    rating: existing?.rating || null,
    credits: existing?.credits || 20,
    status: 'Completed'
  };
  return {
    ...data,
    credits: existing ? data.credits : data.credits + 20,
    requests: data.requests.map(item => item.id === requestId ? {
      ...item,
      status: 'Completed',
      session: { ...item.session, status: 'Completed', completedAt },
      meeting: item.meeting ? { ...item.meeting, status: 'Completed' } : item.meeting
    } : item),
    history: existing
      ? data.history.map(item => item.id === existing.id ? historyItem : item)
      : [historyItem, ...data.history],
    creditActivity: existing ? data.creditActivity : [
      { id: makeExchangeId(), amount: 20, title: `Completed exchange with ${request.partnerName}`, date: completedAt },
      ...data.creditActivity
    ],
    timeline: existing ? data.timeline : [
      { id: makeExchangeId(), label: 'Completed a skill exchange', detail: `${request.offeredSkill} ↔ ${request.wantedSkill} with ${request.partnerName}`, date: completedAt },
      ...data.timeline
    ]
  };
}

export function getMatchDetails(profile, partner, query = '') {
  const wanted = profile.wantsToLearn.map(skill => skill.name.toLowerCase());
  const offered = profile.canTeach.map(skill => skill.name.toLowerCase());
  const partnerTeaches = partner.canTeach.map(skill => skill.toLowerCase());
  const partnerWants = partner.wantsToLearn.map(skill => skill.toLowerCase());
  const querySkill = query.trim().toLowerCase();
  const learnedSkillKey = wanted.find(skill => partnerTeaches.includes(skill)) || (querySkill && partnerTeaches.includes(querySkill) ? querySkill : '');
  const teachSkillKey = offered.find(skill => partnerWants.includes(skill)) || '';
  const learnedSkill = profile.wantsToLearn.find(skill => skill.name.toLowerCase() === learnedSkillKey)?.name || partner.canTeach.find(skill => skill.toLowerCase() === learnedSkillKey) || '';
  const teachSkill = profile.canTeach.find(skill => skill.name.toLowerCase() === teachSkillKey)?.name || '';
  const skillCompatibility = learnedSkill ? 42 : 0;
  const mutualExchange = learnedSkill && teachSkill ? 20 : 0;
  const selectedSkill = learnedSkill.toLowerCase() || querySkill;
  const userLevel = profile.wantsToLearn.find(skill => skill.name.toLowerCase() === selectedSkill)?.currentLevel;
  const partnerLevel = partner.levels[partner.canTeach.find(skill => skill.toLowerCase() === selectedSkill)] || 'Intermediate';
  const levelCompatible = Boolean(selectedSkill && userLevel && Math.abs(SKILL_LEVELS.indexOf(userLevel) - SKILL_LEVELS.indexOf(partnerLevel)) <= 1);
  const levelCompatibility = levelCompatible ? 12 : selectedSkill && userLevel ? 5 : selectedSkill ? 8 : 0;
  const goalCompatibility = profile.goal && partner.goals.includes(profile.goal) ? 8 : 0;
  const availabilityCompatibility = profile.availability.some(time => partner.availability.includes(time)) ? 8 : 3;
  const reputation = Math.round(partner.teachingRating * 2);
  const score = Math.min(98, skillCompatibility + mutualExchange + levelCompatibility + goalCompatibility + availabilityCompatibility + reputation);
  const factors = [
    { label: 'Skill compatibility', passed: Boolean(learnedSkill) },
    { label: 'Mutual exchange', passed: Boolean(learnedSkill && teachSkill) },
    { label: 'Level compatibility', passed: levelCompatible },
    { label: 'Availability', passed: availabilityCompatibility === 8 },
    { label: 'Teaching reputation', passed: partner.teachingRating >= 4.5 }
  ];
  return { score, learnedSkill, teachSkill, factors };
}
