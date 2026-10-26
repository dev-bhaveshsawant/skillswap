import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Bell, BookOpen, Check, ChevronDown, Compass, FileText, Heart, Home as HomeIcon, LayoutDashboard, LogOut, Menu, MessageCircle, Moon, Search, Sparkles, Star, Sun, Upload, Users, X, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AiSkillMatchPage, DashboardPage, HomePage, MyExchangesPage, MySkillsPage, ProfilePage, SessionDetailsPage, SkillGapPage, SkillPartnersPage } from './ExchangePages.jsx';
import VideoMeetingPage from './VideoMeeting.jsx';
import ProgrammingVideosPage from './ProgrammingVideos.jsx';
import AuthPage from './Auth.jsx';
import { authToken, clearAuth } from './api.js';
import { loadExchangeData } from './exchangeData.js';
import './exchange.css';
import './styles.css';

const skills = [
  { name: 'React Development', category: 'Programming', level: 'Intermediate', teacher: 'Maya Chen', rating: '4.9', students: 128, icon: 'RC', tone: 'blue', description: 'Build polished interfaces with reusable components, hooks, and modern React patterns.' },
  { name: 'UI / UX Design', category: 'Design', level: 'Advanced', teacher: 'Noah Williams', rating: '4.8', students: 94, icon: 'UX', tone: 'violet', description: 'Turn complex problems into clear, delightful product experiences.' },
  { name: 'Photography', category: 'Creative', level: 'Beginner', teacher: 'Priya Shah', rating: '5.0', students: 76, icon: 'PH', tone: 'orange', description: 'Learn visual storytelling, composition, and how to find your signature style.' },
  { name: 'Digital Marketing', category: 'Business', level: 'Intermediate', teacher: 'Andre Silva', rating: '4.7', students: 61, icon: 'DM', tone: 'green', description: 'Grow an audience with practical content strategy and ethical growth loops.' },
  { name: 'Python Automation', category: 'Programming', level: 'Advanced', teacher: 'Liam Brooks', rating: '4.9', students: 142, icon: 'PY', tone: 'teal', description: 'Automate repetitive work and build useful tools with Python.' },
  { name: 'Spanish Conversation', category: 'Languages', level: 'Beginner', teacher: 'Sofia Garcia', rating: '4.9', students: 48, icon: 'ES', tone: 'pink', description: 'Build confidence through friendly, real-world conversation practice.' },
];
const people = [
  { name: 'Maya Chen', role: 'Product engineer', location: 'Singapore', skills: ['React', 'TypeScript', 'Mentoring'], initials: 'MC', color: 'blue', rating: '4.9', exchanges: 34 },
  { name: 'Noah Williams', role: 'Product designer', location: 'London, UK', skills: ['UI/UX', 'Figma', 'Branding'], initials: 'NW', color: 'violet', rating: '4.8', exchanges: 28 },
  { name: 'Priya Shah', role: 'Visual storyteller', location: 'Mumbai, India', skills: ['Photography', 'Lightroom', 'Writing'], initials: 'PS', color: 'orange', rating: '5.0', exchanges: 19 },
  { name: 'Andre Silva', role: 'Growth strategist', location: 'Lisbon, Portugal', skills: ['Marketing', 'SEO', 'Analytics'], initials: 'AS', color: 'green', rating: '4.7', exchanges: 25 },
];

function Avatar({ initials, color = 'blue', small = false }) { return <div className={`avatar avatar-${color} ${small ? 'avatar-small' : ''}`}>{initials}</div>; }
function Button({ children, variant = 'primary', onClick, icon = false }) { return <button className={`button button-${variant}`} onClick={onClick}>{children}{icon && <ArrowRight size={16} />}</button>; }
function Toast({ message, close }) { return <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="toast"><Check size={17} />{message}<button onClick={close}><X size={15} /></button></motion.div>; }
function Navbar({ dark, toggleDark }) {
  const [open, setOpen] = useState(false); const [loggedIn, setLoggedIn] = useState(() => Boolean(authToken())); const navigate = useNavigate();
  useEffect(() => { const sync = () => setLoggedIn(Boolean(authToken())); window.addEventListener('skillswap-auth-changed', sync); return () => window.removeEventListener('skillswap-auth-changed', sync); }, []);
  const logout = () => { clearAuth(); setLoggedIn(false); setOpen(false); navigate('/login'); };
  return <header className="navbar"><Link to="/" className="brand"><span className="brand-mark"><Sparkles size={17} /></span>Skill<span>Swap</span></Link><nav className={open ? 'nav-links nav-open' : 'nav-links'}><NavLink to="/" onClick={() => setOpen(false)}>Home</NavLink><NavLink to="/explore" onClick={() => setOpen(false)}>Skill Partners</NavLink><NavLink to="/ai-match" onClick={() => setOpen(false)}>AI Match</NavLink><NavLink to="/programming-videos" onClick={() => setOpen(false)}>Programming Videos</NavLink><NavLink to="/my-skills" onClick={() => setOpen(false)}>My Skills</NavLink><NavLink to="/my-exchanges" onClick={() => setOpen(false)}>My Exchanges</NavLink><NavLink to="/dashboard" onClick={() => setOpen(false)}>Dashboard</NavLink></nav><div className="nav-actions"><button className="icon-button" aria-label="Toggle theme" onClick={toggleDark}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>{loggedIn ? <Button variant="ghost" onClick={logout}><LogOut size={16} /> Logout</Button> : <Button onClick={() => navigate('/login')}>Log in / Register <ArrowRight size={15} /></Button>}</div><button className="menu-button" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button></header>;
}
function Footer() { return <footer><div><Link to="/" className="brand"><span className="brand-mark"><Sparkles size={17} /></span>Skill<span>Swap</span></Link><p>Share what you know. Learn what you want.</p></div><div className="footer-links"><div><b>Exchange</b><Link to="/explore">Skill Partners</Link><Link to="/ai-match">AI Skill Match</Link><Link to="/my-exchanges">My Exchanges</Link></div><div><b>Your Skills</b><Link to="/my-skills">My Skills</Link><Link to="/programming-videos">Programming Videos</Link><Link to="/profile">Profile</Link><Link to="/skill-gap">Skill Gap Detector</Link></div><div><b>Account</b><Link to="/login">Log in</Link><Link to="/register">Join SkillSwap</Link><Link to="/how-it-works">How it works</Link></div></div></footer>; }
function Layout({ children, dark, toggleDark }) { return <><Navbar dark={dark} toggleDark={toggleDark} /><div className="global-notes"><NotesPopup /></div>{children}<Footer /></>; }
function SkillCard({ skill, favorite, onFavorite }) { const navigate = useNavigate(); return <motion.article className="skill-card" whileHover={{ y: -5 }}><div className="card-top"><div className={`skill-icon ${skill.tone}`}>{skill.icon}</div><button className={favorite ? 'favorite active' : 'favorite'} onClick={onFavorite} aria-label="Save skill"><Heart size={18} fill={favorite ? 'currentColor' : 'none'} /></button></div><div className="eyebrow">{skill.category} <span>•</span> {skill.level}</div><h3>{skill.name}</h3><p>{skill.description}</p><div className="teacher"><Avatar initials={skill.teacher.split(' ').map(x => x[0]).join('')} color={skill.tone} small /><span>{skill.teacher}</span><span className="rating"><Star size={14} fill="currentColor" /> {skill.rating}</span></div><div className="card-bottom"><span>{skill.students} learners</span><button onClick={() => navigate('/skills/1')}>View skill <ArrowRight size={15} /></button></div></motion.article>; }
function Home({ toast, dark, toggleDark }) { const navigate = useNavigate(); return <Layout dark={dark} toggleDark={toggleDark} {...toast}><main><section className="hero"><div className="hero-copy"><div className="pill"><span className="pulse-dot" /> The social way to learn</div><h1>Exchange skills.<br /><em>Build connections.</em><br />Grow together.</h1><p className="hero-text">SkillSwap helps curious people learn from one another while sharing what they already know.</p><div className="hero-actions"><Button onClick={() => navigate('/explore')} icon>Explore skills</Button><Button variant="outline" onClick={() => navigate('/login')}>Log in / Register</Button></div><div className="social-proof"><div className="avatar-stack"><Avatar initials="MC" color="blue" small /><Avatar initials="PS" color="orange" small /><Avatar initials="NW" color="violet" small /><Avatar initials="+" color="green" small /></div><div><div className="stars">★★★★★</div><span>Trusted by 10,000+ learners</span></div></div></div><div className="hero-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><motion.div animate={{ y: [0, -12, 0], rotate: [-2, 2, -2] }} transition={{ duration: 5, repeat: Infinity }} className="hero-center"><div className="connection-lines" /><Avatar initials="MC" color="blue" /><div><strong>Skill exchange</strong><span>React ↔ UI/UX</span></div><Check className="check-badge" size={16} /></motion.div><motion.div animate={{ y: [0, 10, 0] }} transition={{ duration: 4, repeat: Infinity }} className="float-card float-a"><span className="mini-icon blue">RC</span><div><b>React development</b><small>+ 12 learners</small></div></motion.div><motion.div animate={{ y: [0, -9, 0] }} transition={{ duration: 4.5, repeat: Infinity }} className="float-card float-b"><span className="mini-icon orange">PH</span><div><b>Photography</b><small>Priya is teaching</small></div></motion.div><motion.div animate={{ y: [0, 8, 0] }} transition={{ duration: 5.5, repeat: Infinity }} className="float-card float-c"><span className="mini-icon violet">UX</span><div><b>UI / UX design</b><small>96% match</small></div></motion.div></div></section><section className="metrics"><div><strong>10k<span>+</span></strong><small>Active learners</small></div><div><strong>5k<span>+</span></strong><small>Skills to discover</small></div><div><strong>3k<span>+</span></strong><small>Exchanges made</small></div><div><strong>95<span>%</span></strong><small>Learner satisfaction</small></div></section><section className="section popular"><div className="section-heading"><div><div className="eyebrow">Find your next spark</div><h2>Popular skills</h2></div><Link to="/explore" className="text-link">Explore all skills <ArrowRight size={16} /></Link></div><div className="skill-grid">{skills.slice(0, 3).map(s => <SkillCard key={s.name} skill={s} onFavorite={() => toast.show('Skill saved to favorites')} />)}</div></section><section className="section steps-section"><div className="section-heading center"><div className="eyebrow">Simple by design</div><h2>How learning should feel</h2><p>Find your people, trade what you know, and make meaningful progress together.</p></div><div className="steps"><Step number="01" icon={<Users />} title="Create your profile" text="Tell the community what lights you up and where you want to grow." /><Step number="02" icon={<Compass />} title="Find your match" text="Explore skills and people that fit your goals, pace, and personality." /><Step number="03" icon={<Zap />} title="Exchange knowledge" text="Set up a learning connection and make progress side by side." /></div></section><section className="cta"><div><div className="eyebrow">Your next chapter starts here</div><h2>Everyone has something<br /><em>worth sharing.</em></h2></div><Button variant="light" onClick={() => navigate('/login')} icon>Log in / Register</Button></section></main></Layout>; }
function Step({ number, icon, title, text }) { return <motion.div className="step" whileHover={{ y: -4 }}><span>{number}</span><div className="step-icon">{icon}</div><h3>{title}</h3><p>{text}</p></motion.div>; }
function Explore({ toast, dark, toggleDark }) { const [query, setQuery] = useState(''); const [favorites, setFavorites] = useState([]); const filtered = skills.filter(s => `${s.name} ${s.category} ${s.teacher}`.toLowerCase().includes(query.toLowerCase())); return <Layout dark={dark} toggleDark={toggleDark} {...toast}><main className="page"><div className="page-header"><div><div className="eyebrow">Discover your next skill</div><h1>Explore skills</h1><p>Learn from people who are excited to share what they know.</p></div><Button onClick={() => toast.show('Sign in to add your own skill')} icon>Share a skill</Button></div><div className="search-row"><div className="search-box"><Search size={19} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search skills, topics, or people..." /></div><button className="filter-button">All categories <ChevronDown size={16} /></button><button className="filter-button">Top rated <ChevronDown size={16} /></button></div><div className="category-row"><span className="category active">All skills</span>{['Programming', 'Design', 'Business', 'Creative', 'Languages'].map(c => <span className="category" key={c}>{c}</span>)}</div><div className="results-label"><span><b>{filtered.length * 20 + 34}</b> skills available</span><span>Sort by <b>Most relevant</b> <ChevronDown size={15} /></span></div><div className="skill-grid">{filtered.map(s => <SkillCard key={s.name} skill={s} favorite={favorites.includes(s.name)} onFavorite={() => { setFavorites(favorites.includes(s.name) ? favorites.filter(x => x !== s.name) : [...favorites, s.name]); toast.show(favorites.includes(s.name) ? 'Removed from favorites' : 'Skill saved to favorites'); }} />)}</div>{filtered.length === 0 && <div className="empty"><Search size={30} /><h3>No skills found</h3><p>Try searching for another topic.</p></div>}</main></Layout>; }
function People({ toast, dark, toggleDark }) { if (window.location.hash === '#ai-match') return <AiMatch toast={toast} dark={dark} toggleDark={toggleDark} />; const [query, setQuery] = useState(''); const list = people.filter(p => `${p.name} ${p.role} ${p.skills.join(' ')}`.toLowerCase().includes(query.toLowerCase())); return <Layout dark={dark} toggleDark={toggleDark} {...toast}><main className="page"><div className="page-header"><div><div className="eyebrow">Meet your community</div><h1>Find your people</h1><p>Great exchanges start with a good connection.</p></div></div><div className="search-row"><div className="search-box"><Search size={19} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, skill, or role..." /></div><button className="filter-button">Location <ChevronDown size={16} /></button><button className="filter-button">Availability <ChevronDown size={16} /></button></div><div className="people-grid">{list.map(p => <motion.article className="person-card" key={p.name} whileHover={{ y: -5 }}><div className="person-head"><Avatar initials={p.initials} color={p.color} /><div><h3>{p.name}</h3><p>{p.role}</p><small>{p.location}</small></div><button className="favorite" onClick={() => toast.show(`${p.name} saved to favorites`)}><Heart size={18} /></button></div><p className="person-bio">Open to sharing practical knowledge and learning from thoughtful people.</p><div className="tag-list">{p.skills.map(s => <span key={s}>{s}</span>)}</div><div className="person-foot"><span><Star size={14} fill="currentColor" /> {p.rating} <i>·</i> {p.exchanges} exchanges</span><Button variant="outline" onClick={() => toast.show(`Message request sent to ${p.name}`)}>Connect</Button></div></motion.article>)}</div></main></Layout>; }
function AiMatch({ toast, dark, toggleDark }) {
  const [profile, setProfile] = useState({ name: '', skill: '', level: 'Any level' });
  const [matches, setMatches] = useState([]);
  const findMatches = event => {
    event.preventDefault();
    const keyword = profile.skill.toLowerCase();
    const ranked = people.map(person => {
      const searchable = `${person.skills.join(' ')} ${person.role}`.toLowerCase();
      const skillScore = keyword && searchable.includes(keyword) ? 70 : keyword ? 25 : 40;
      const levelScore = profile.level === 'Any level' || person.role.toLowerCase().includes(profile.level.toLowerCase()) ? 20 : 12;
      return { ...person, match: Math.min(98, skillScore + levelScore + (person.rating >= '4.9' ? 8 : 5)) };
    }).sort((a, b) => b.match - a.match);
    setMatches(ranked);
    toast.show('Your best skill matches are ready');
  };
  return <Layout dark={dark} toggleDark={toggleDark} {...toast}><main className="page ai-match-page"><div className="ai-match-intro"><div className="eyebrow"><Sparkles size={14} /> Personalised discovery</div><h1>Find your <em>perfect match.</em></h1><p>Tell us what you want to learn and our matching assistant will find people who can help you grow.</p></div><form className="match-form" onSubmit={findMatches}><label>Your name<input value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} placeholder="e.g. Bhavesh" required /></label><label>What do you want to learn?<select value={profile.skill} onChange={e => setProfile({ ...profile, skill: e.target.value })} required><option value="">Choose a skill</option>{skills.map(skill => <option key={skill.name} value={skill.category}>{skill.name}</option>)}<option value="React">React</option><option value="Photography">Photography</option></select></label><label>Preferred level<select value={profile.level} onChange={e => setProfile({ ...profile, level: e.target.value })}><option>Any level</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label><Button icon>Find my matches</Button></form>{matches.length > 0 && <section className="match-results"><div className="results-label"><span><b>{matches.length} people</b> matched for {profile.name}</span><span>Sorted by compatibility</span></div><div className="people-grid">{matches.map(person => <motion.article className="person-card match-card" key={person.name}><div className="match-score">{person.match}% match</div><div className="person-head"><Avatar initials={person.initials} color={person.color} /><div><h3>{person.name}</h3><p>{person.role}</p><small>{person.location}</small></div></div><p className="person-bio">{person.name} can help you explore {profile.skill} through practical, friendly sessions.</p><div className="tag-list">{person.skills.map(skill => <span key={skill}>{skill}</span>)}</div><div className="person-foot"><span><Star size={14} fill="currentColor" /> {person.rating}</span><Button variant="outline" onClick={() => toast.show(`Message request sent to ${person.name}`)}>Connect</Button></div></motion.article>)}</div></section>}</main></Layout>;
}
function InfoPage({ type, toast, dark, toggleDark }) { const isAbout = type === 'about'; return <Layout dark={dark} toggleDark={toggleDark} {...toast}><main className="page info-page"><div className="info-hero"><div className="eyebrow">{isAbout ? 'A community with momentum' : 'A better way to grow'}</div><h1>{isAbout ? <>The internet is better<br /><em>when we learn together.</em></> : <>Learning is not a<br /><em>solo sport.</em></>}</h1><p>{isAbout ? 'SkillSwap is a people-first platform for exchanging knowledge, finding your next collaborator, and making progress feel less lonely.' : 'We make it easy to find the right people, trade practical knowledge, and build connections that last beyond a single lesson.'}</p></div><div className="info-band"><div><span className="big-number">01</span><h2>{isAbout ? 'Built for generous people' : 'Share what you know'}</h2><p>Skills are more valuable when they move. Whether you are a patient mentor or a curious beginner, your perspective belongs here.</p></div><div><span className="big-number">02</span><h2>{isAbout ? 'Progress over perfection' : 'Learn what moves you'}</h2><p>Small, consistent exchanges create the kind of momentum that changes careers, hobbies, and everyday confidence.</p></div><div><span className="big-number">03</span><h2>{isAbout ? 'Human by default' : 'Grow side by side'}</h2><p>No faceless courses or endless feeds. Just real people, clear goals, and a little more room to be human.</p></div></div><section className="cta compact"><div><h2>Ready to find your people?</h2></div><Button variant="light" onClick={() => toast.show('Welcome to SkillSwap!')} icon>Get started</Button></section></main></Layout>; }
function Login({ register = false, toast, dark, toggleDark }) { const navigate = useNavigate(); const [email, setEmail] = useState(''); const submit = e => { e.preventDefault(); const normalizedEmail = email.trim().toLowerCase(); const registeredEmail = localStorage.getItem('skillswap-registered-email') || localStorage.getItem('skillswap-user'); if (register) { localStorage.setItem('skillswap-registered-email', normalizedEmail); localStorage.removeItem('skillswap-user'); toast.show('Registration complete. Please log in.'); navigate('/login'); return; } if (!registeredEmail || !registeredEmail.includes('@')) { localStorage.removeItem('skillswap-user'); toast.show('Please register first'); navigate('/register'); return; } if (registeredEmail.toLowerCase() !== normalizedEmail) { localStorage.removeItem('skillswap-user'); toast.show('Please enter the correct registered email'); return; } localStorage.setItem('skillswap-registered-email', normalizedEmail); localStorage.setItem('skillswap-user', normalizedEmail); toast.show('Welcome back to SkillSwap'); navigate('/'); }; return <Layout dark={dark} toggleDark={toggleDark} {...toast}><main className="auth-page"><div className="auth-aside"><Link to="/" className="brand"><span className="brand-mark"><Sparkles size={17} /></span>Skill<span>Swap</span></Link><div><div className="eyebrow">{register ? 'Your learning story starts here' : 'Welcome back'}</div><h1>{register ? <>Make your<br /><em>next move.</em></> : <>Good to see<br /><em>you again.</em></>}</h1><p>Learn openly. Share generously. Build something meaningful.</p></div></div><div className="auth-form"><div className="eyebrow">{register ? 'Create your account' : 'Sign in to continue'}</div><h2>{register ? 'Join the exchange' : 'Welcome back'}</h2><p className="muted">{register ? 'Start learning and sharing in minutes.' : 'Pick up where you left off.'}</p><form onSubmit={submit}>{register && <label>Full name<input placeholder="Your name" required /></label>}<label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></label><label>Password<input type="password" placeholder="••••••••" required /></label>{register && <label className="check-label"><input type="checkbox" required /> I agree to the community guidelines</label>}<Button>{register ? 'Create account' : 'Log in'} <ArrowRight size={16} /></Button></form><div className="auth-switch">{register ? 'Already a member?' : 'New to SkillSwap?'} <button onClick={() => navigate(register ? '/login' : '/register')}>{register ? 'Log in' : 'Create an account'}</button></div></div></main></Layout>; }
function Dashboard({ toast, dark, toggleDark }) { const navigate = useNavigate(); const user = localStorage.getItem('skillswap-user') || 'Bhavesh'; return <Layout dark={dark} toggleDark={toggleDark} {...toast}><main className="dashboard page"><div className="dash-top"><div><div className="eyebrow">Wednesday, August 26, 2026</div><h1>Good morning, {user.split('@')[0]} <span className="wave">✦</span></h1><p>Here is what is happening in your learning world.</p></div><Button onClick={() => navigate('/explore')} icon>Find a skill</Button></div><div className="stat-grid"><Stat icon={<BookOpen />} label="Skills offered" value="08" change="+2 this month" /><Stat icon={<Compass />} label="Skills learning" value="04" change="+1 this month" /><Stat icon={<MessageCircle />} label="Active exchanges" value="03" change="2 this week" /><Stat icon={<Check />} label="Completed" value="17" change="+4 this month" /></div><div className="dash-grid"><section className="panel progress-panel"><div className="panel-title"><div><div className="eyebrow">Keep going</div><h2>Learning progress</h2></div><button className="dots">•••</button></div>{[['UI / UX Design', '74%', 'violet'], ['Python Automation', '48%', 'teal'], ['Photography', '32%', 'orange']].map(x => <div className="progress-item" key={x[0]}><div><span>{x[0]}</span><b>{x[1]}</b></div><div className="progress-bar"><i className={x[2]} style={{ width: x[1] }} /></div></div>)}<button className="panel-link" onClick={() => navigate('/explore')}>View all learning <ArrowRight size={15} /></button></section><section className="panel activity-panel"><div className="panel-title"><div><div className="eyebrow">Your space</div><h2>Recent activity</h2></div><button className="dots">•••</button></div>{['You added React Development', 'Maya accepted your request', 'You completed a skill exchange', 'You saved UI / UX Design'].map((a, i) => <div className="activity" key={a}><span className={`activity-dot dot-${i}`} /><div><b>{a}</b><small>{i + 1} day{i ? 's' : ''} ago</small></div></div>)}</section></div><section className="section dash-recommend"><div className="section-heading"><div><div className="eyebrow">Picked for you</div><h2>Recommended skills</h2></div><Link to="/explore" className="text-link">See all <ArrowRight size={16} /></Link></div><div className="skill-grid">{skills.slice(1, 4).map(s => <SkillCard key={s.name} skill={s} onFavorite={() => toast.show('Skill saved to favorites')} />)}</div></section></main></Layout>; }
function NotesPopup({ toast = { show: () => {} } }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [generated, setGenerated] = useState(false);
  const [draft, setDraft] = useState(() => {
    try {
      return localStorage.getItem('skillswap-notes-draft') || '';
    } catch {
      return '';
    }
  });
  const [savedNotes, setSavedNotes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('skillswap-notes') || '[]');
    } catch {
      return [];
    }
  });
  const readPdfText = async file => {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), disableWorker: true }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(' '));
    }
    return pages.join('\n\n');
  };
  const addFiles = async selectedFiles => {
    const accepted = Array.from(selectedFiles).filter(file => /^(image|video|audio|application\/pdf|text\/plain)/.test(file.type) || /\.(pdf|png|jpe?g|webp|mp4|mp3|wav|txt)$/i.test(file.name));
    const prepared = await Promise.all(accepted.map(async file => {
      let text = '';
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        try { text = await readPdfText(file); } catch { toast.show(`Could not read ${file.name}`); }
      }
      return { name: file.name, size: file.size, type: file.type, text };
    }));
    setFiles(current => [...current, ...prepared]);
    setGenerated(false);
    if (accepted.length) toast.show(`${accepted.length} file${accepted.length > 1 ? 's' : ''} added for notes`);
  };
  const extractedText = files.filter(file => file.text).map(file => `--- ${file.name} ---\n${file.text}`).join('\n\n');
  const generateNotes = () => {
    const note = extractedText || 'Your notes are ready. Add or edit the summary here.';
    setDraft(note);
    try {
      localStorage.setItem('skillswap-notes-draft', note);
    } catch {}
    setGenerated(true);
    toast.show('Notes generated from your uploads');
  };
  const saveNotes = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const entry = {
      id: Date.now(),
      title: files[0]?.name || 'My notes',
      text: trimmed,
      savedAt: new Date().toLocaleString()
    };
    const next = [entry, ...savedNotes].slice(0, 6);
    setSavedNotes(next);
    try {
      localStorage.setItem('skillswap-notes', JSON.stringify(next));
      localStorage.setItem('skillswap-notes-draft', trimmed);
    } catch {}
    toast.show('Notes saved successfully');
  };
  const printNotes = () => {
    if (!draft.trim()) {
      toast.show('Write or generate notes before printing');
      return;
    }
    window.print();
  };
  return <div className="notes-tool"><Button variant="outline" onClick={() => setOpen(!open)}><FileText size={16} /> Create notes</Button>{open && <motion.div className="notes-popup" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}><div className="notes-popup-head"><div><strong>AI Notes</strong><small>Upload learning material</small></div><button className="icon-button" aria-label="Close notes popup" onClick={() => setOpen(false)}><X size={16} /></button></div><label className="upload-zone"><Upload size={22} /><span>Choose files to summarize</span><small>PDF, image, video or audio</small><input type="file" accept="image/*,video/*,audio/*,application/pdf,text/plain,.pdf" multiple onChange={event => { const input = event.currentTarget; addFiles(input.files); input.value = ''; }} /></label>{files.length > 0 && <div className="uploaded-files">{files.map((file, index) => <div className="uploaded-file" key={`${file.name}-${index}`}><FileText size={15} /><span>{file.name}</span><small>{Math.ceil(file.size / 1024)} KB</small></div>)}<button className="button button-primary notes-generate" onClick={generateNotes}>Generate notes <Sparkles size={15} /></button>{generated && <div className="notes-preview"><strong>Exact PDF text</strong>{extractedText ? <pre className="extracted-text">{extractedText}</pre> : <p>PDF text was not available. This file may contain scanned images only.</p>}</div>}</div>}<div className="notes-editor"><label>Notes</label><textarea value={draft} onChange={event => { setDraft(event.target.value); try { localStorage.setItem('skillswap-notes-draft', event.target.value); } catch {} }} placeholder="Write your notes here..." /></div><div className="notes-actions"><button className="button button-primary" onClick={saveNotes}>Save notes</button><button className="button button-outline" onClick={printNotes}>Print</button></div>{savedNotes.length > 0 && <div className="saved-notes"><strong>Saved notes</strong>{savedNotes.map(note => <button key={note.id} className="saved-note" onClick={() => { setDraft(note.text); setGenerated(true); try { localStorage.setItem('skillswap-notes-draft', note.text); } catch {} }}><span>{note.title}</span><small>{note.savedAt}</small></button>)}</div>}</motion.div>}</div>;
}
function Stat({ icon, label, value, change }) { return <div className="stat"><div className="stat-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{change}</small></div>; }
function Detail({ toast, dark, toggleDark }) { const skill = skills[0]; return <Layout dark={dark} toggleDark={toggleDark} {...toast}><main className="page detail-page"><Link to="/explore" className="back-link">← Back to explore</Link><div className="detail-layout"><div><div className="skill-icon blue large">RC</div><div className="eyebrow">{skill.category} <span>•</span> {skill.level}</div><h1>{skill.name}</h1><p className="detail-lead">{skill.description} Learn with a mentor who meets you where you are and helps you build real things.</p><div className="detail-actions"><Button onClick={() => toast.show('Exchange request sent!')} icon>Request exchange</Button><Button variant="outline" onClick={() => toast.show('Message window opened')}>Message teacher</Button></div><div className="learn-box"><h2>What you will learn</h2><div className="learn-list"><p><Check size={16} /> Build component-driven interfaces</p><p><Check size={16} /> Manage state with modern hooks</p><p><Check size={16} /> Ship a responsive project with confidence</p></div></div></div><aside className="teacher-panel"><div className="eyebrow">Your potential mentor</div><Avatar initials="MC" color="blue" /><h2>{skill.teacher}</h2><p>Product engineer · Singapore</p><div className="teacher-rating"><Star size={17} fill="currentColor" /> {skill.rating} <span>128 learners</span></div><hr /><p className="muted">I love helping people turn their first idea into something they are proud to share.</p><Button variant="outline" onClick={() => toast.show('Profile opened')}>View full profile</Button></aside></div></main></Layout>; }
function ProtectedRoute({ children }) { return authToken() ? children : <Navigate to="/login" replace />; }
function VideoMeetingEntry({ toast }) {
  const [searchParams] = useSearchParams();
  const exchangeId = searchParams.get('exchange');
  const request = exchangeId ? loadExchangeData().requests.find(item => item.id === exchangeId) : null;
  const meetingId = request?.session?.meetingId || request?.meeting?.meetingId || request?.meeting?.id;
  return meetingId
    ? <Navigate to={`/meeting/${encodeURIComponent(meetingId)}`} replace />
    : <VideoMeetingPage toast={toast} />;
}
function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('skillswap-theme') === 'dark');
  const [message, setMessage] = useState('');
  useEffect(() => { const onError = event => setMessage(event.detail || 'The change could not be saved to the backend.'); window.addEventListener('skillswap-backend-error', onError); return () => window.removeEventListener('skillswap-backend-error', onError); }, []);
  const toast = { show: setMessage, close: () => setMessage('') };
  const toggleDark = () => {
    setDark(current => {
      const next = !current;
      localStorage.setItem('skillswap-theme', next ? 'dark' : 'light');
      return next;
    });
  };
  const wrap = page => <Layout dark={dark} toggleDark={toggleDark}>{page}</Layout>;
  const protectedPage = page => <ProtectedRoute>{wrap(page)}</ProtectedRoute>;
  return <div className={dark ? 'app dark' : 'app'}>{message && <Toast message={message} close={toast.close} />}<Routes>
    <Route path="/" element={wrap(<HomePage toast={toast} />)} />
    <Route path="/login" element={wrap(<AuthPage toast={toast} dark={dark} toggleDark={toggleDark} />)} />
    <Route path="/register" element={wrap(<AuthPage register toast={toast} dark={dark} toggleDark={toggleDark} />)} />
    <Route path="/explore" element={protectedPage(<SkillPartnersPage toast={toast} />)} />
    <Route path="/people" element={protectedPage(<SkillPartnersPage toast={toast} />)} />
    <Route path="/skill-partners" element={protectedPage(<SkillPartnersPage toast={toast} />)} />
    <Route path="/ai-match" element={protectedPage(<AiSkillMatchPage toast={toast} />)} />
    <Route path="/my-skills" element={protectedPage(<MySkillsPage toast={toast} />)} />
    <Route path="/my-exchanges" element={protectedPage(<MyExchangesPage toast={toast} />)} />
    <Route path="/sessions/:sessionId" element={protectedPage(<SessionDetailsPage toast={toast} />)} />
    <Route path="/programming-videos" element={protectedPage(<ProgrammingVideosPage />)} />
    <Route path="/programming-videos/:videoId" element={protectedPage(<ProgrammingVideosPage />)} />
    <Route path="/video-meeting" element={<VideoMeetingEntry toast={toast} />} />
    <Route path="/meeting/:meetingId" element={<VideoMeetingPage toast={toast} />} />
    <Route path="/dashboard" element={protectedPage(<DashboardPage toast={toast} />)} />
    <Route path="/profile" element={protectedPage(<ProfilePage toast={toast} />)} />
    <Route path="/skill-gap" element={protectedPage(<SkillGapPage />)} />
    <Route path="/about" element={protectedPage(<InfoPage type="about" toast={toast} dark={dark} toggleDark={toggleDark} />)} />
    <Route path="/how-it-works" element={protectedPage(<InfoPage type="how" toast={toast} dark={dark} toggleDark={toggleDark} />)} />
    <Route path="/skills/:id" element={protectedPage(<Detail toast={toast} dark={dark} toggleDark={toggleDark} />)} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></div>;
}
createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
