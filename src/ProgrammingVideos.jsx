import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Code2, Play, Search, Video } from 'lucide-react';

export const PROGRAMMING_VIDEOS = [
  { id: 'python', language: 'Python', aliases: ['python'], category: 'Programming', level: 'Beginner', description: 'Start with Python syntax, variables, functions, and the building blocks for useful programs.', title: 'Python for Beginners - Full Course', channel: 'freeCodeCamp.org', duration: '4 hr 26 min', youtubeId: 'rfscVS0vtbw' },
  { id: 'java', language: 'Java', aliases: ['java'], category: 'Programming', level: 'Beginner', description: 'Learn Java fundamentals, object-oriented programming, and how to structure your first applications.', title: 'Java Tutorial for Beginners', channel: 'Programming with Mosh', duration: '2 hr 30 min', youtubeId: 'eIrMbAQSU34' },
  { id: 'c', language: 'C', aliases: ['c programming', 'c language'], category: 'Programming', level: 'Beginner', description: 'Understand C fundamentals, memory, functions, and core programming concepts in a complete course.', title: 'C Programming Tutorial for Beginners', channel: 'freeCodeCamp.org', duration: '4 hr 20 min', youtubeId: 'KJgsSFOSQv0' },
  { id: 'cpp', language: 'C++', aliases: ['c++', 'cpp'], category: 'Programming', level: 'Beginner', description: 'Build a strong C++ foundation with variables, control flow, functions, and object-oriented concepts.', title: 'C++ Tutorial for Beginners - Full Course', channel: 'freeCodeCamp.org', duration: '4 hr 1 min', youtubeId: 'vLnPwxZdW4Y' },
  { id: 'javascript', language: 'JavaScript', aliases: ['javascript', 'js'], category: 'Frontend', level: 'Beginner', description: 'Learn the JavaScript essentials that bring browser interfaces to life, with clear examples throughout.', title: 'JavaScript Course for Beginners - Your First Step to Web Development', channel: 'Programming with Mosh', duration: '1 hr 4 min', youtubeId: 'W6NZfCO5SIk' },
  { id: 'html', language: 'HTML', aliases: ['html5'], category: 'Web Development', level: 'Beginner', description: 'Learn how to structure accessible web pages with semantic HTML elements and practical examples.', title: 'HTML Tutorial for Beginners', channel: 'Programming with Mosh', duration: '1 hr 9 min', youtubeId: 'qz0aGYrrlhU' },
  { id: 'css', language: 'CSS', aliases: ['css3'], category: 'Web Development', level: 'Beginner', description: 'Style web pages with selectors, the box model, layouts, and responsive design fundamentals.', title: 'CSS Tutorial for Beginners', channel: 'Programming with Mosh', duration: '1 hr 25 min', youtubeId: 'yfoY53QXEnI' },
  { id: 'php', language: 'PHP', aliases: ['php programming'], category: 'Backend', level: 'Beginner', description: 'Learn PHP syntax, functions, forms, and server-side programming in a beginner-friendly full course.', title: 'PHP Programming Language Tutorial - Full Course', channel: 'freeCodeCamp.org', duration: '4 hr 36 min', youtubeId: 'OK_JCtrrv-c' },
  { id: 'sql', language: 'SQL', aliases: ['mysql', 'database sql'], category: 'Database', level: 'Beginner', description: 'Query relational databases and practice filtering, joining, and shaping real-world data.', title: 'SQL Tutorial - Full Database Course for Beginners', channel: 'freeCodeCamp.org', duration: '4 hr 20 min', youtubeId: 'HXV3zeQKqGY' },
  { id: 'react', language: 'React.js', aliases: ['react', 'reactjs', 'react development'], category: 'Frontend', level: 'Intermediate', description: 'Build modern interfaces with components, props, state, hooks, and practical React projects.', title: "React Course - Beginner's Tutorial for React JavaScript Library", channel: 'freeCodeCamp.org', duration: '11 hr 55 min', youtubeId: 'bMknfKXIFA8' },
  { id: 'node', language: 'Node.js', aliases: ['node', 'nodejs'], category: 'Backend', level: 'Intermediate', description: 'Use JavaScript on the server with Node.js, modules, npm, and a small practical application.', title: 'Node.js Tutorial for Beginners', channel: 'Programming with Mosh', duration: '1 hr 18 min', youtubeId: 'TlB_eWDSMt4' },
  { id: 'mongodb', language: 'MongoDB', aliases: ['mongo', 'mongodb database'], category: 'Database', level: 'Intermediate', description: 'Get started with MongoDB documents, collections, queries, and database fundamentals.', title: 'MongoDB Tutorial for Beginners', channel: 'Programming with Mosh', duration: '1 hr 18 min', youtubeId: 'c2M-rlkkT5o' }
];

export function findProgrammingVideo(skill) {
  const normalized = String(skill || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return null;
  return PROGRAMMING_VIDEOS.find(video => [video.language, ...video.aliases].some(alias => alias.toLowerCase() === normalized)) || null;
}

export function RecommendedLearningVideo({ skill, compact = false }) {
  const video = findProgrammingVideo(skill);
  if (!video) return null;
  return <article className={`recommended-video ${compact ? 'recommended-video-compact' : ''}`}>
    <img src={`https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`} alt={`${video.title} thumbnail`} loading="lazy" />
    <div className="recommended-video-copy"><span className="exchange-eyebrow">Recommended Learning Video</span><strong>{video.title}</strong><span>{video.language} · {video.channel} · {video.duration}</span><Link className="button button-primary" to={`/programming-videos/${video.id}`}><Play size={14} /> Watch {video.language} Video</Link></div>
  </article>;
}

function VideoCard({ video }) {
  return <article className="programming-video-card">
    <Link className="programming-video-thumbnail" to={`/programming-videos/${video.id}`} aria-label={`Watch ${video.title}`}>
      <img src={`https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`} alt={`${video.title} thumbnail`} loading="lazy" />
      <span className="video-play-mark"><Play size={18} fill="currentColor" /></span>
      <span className="video-duration">{video.duration}</span>
      <span className="video-language-mark"><Code2 size={14} /> {video.language}</span>
    </Link>
    <div className="programming-video-card-body"><div className="programming-video-meta"><span className="video-level">{video.level}</span><span>{video.category}</span></div><h2>{video.title}</h2><p>{video.description}</p><div className="programming-video-card-foot"><span><Video size={14} /> {video.channel}</span><Link className="button button-outline" to={`/programming-videos/${video.id}`}>Watch Video <ArrowRight size={14} /></Link></div></div>
  </article>;
}

export default function ProgrammingVideosPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('skill') || '');
  const [level, setLevel] = useState('All levels');
  const [category, setCategory] = useState('All categories');
  const video = PROGRAMMING_VIDEOS.find(item => item.id === videoId);

  if (videoId) {
    if (!video) return <main className="exchange-page"><Link className="back-link" to="/programming-videos"><ArrowLeft size={15} /> Back to Videos</Link><h1>Video not found</h1></main>;
    return <main className="exchange-page learning-video-page">
      <button className="back-link learning-video-back" onClick={() => navigate('/programming-videos')}><ArrowLeft size={15} /> Back to Videos</button>
      <div className="exchange-eyebrow"><Video size={14} /> Learning Video · YouTube</div>
      <h1>Learning Video</h1>
      <section className="learning-video-panel">
        <div className="learning-video-player"><iframe src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?rel=0`} title={`${video.title} by ${video.channel}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div>
        <div className="learning-video-details"><div className="programming-video-meta"><span className="video-language-mark video-language-mark-static"><Code2 size={14} /> {video.language}</span><span className="video-level">{video.level}</span><span>{video.category}</span><span>{video.duration}</span></div><h2>{video.title}</h2><div className="learning-video-source"><span>Original source: {video.channel}</span><a className="button button-outline" href={`https://www.youtube.com/watch?v=${video.youtubeId}`} target="_blank" rel="noreferrer"><Play size={14} /> Watch on YouTube</a></div><p>{video.description}</p></div>
      </section>
    </main>;
  }

  const filtered = PROGRAMMING_VIDEOS.filter(item => {
    const searchable = `${item.language} ${item.category} ${item.title} ${item.channel} ${item.description}`.toLowerCase();
    return searchable.includes(query.trim().toLowerCase()) && (level === 'All levels' || item.level === level) && (category === 'All categories' || item.category === category);
  });

  return <main className="exchange-page programming-videos-page">
    <div className="exchange-heading programming-videos-heading"><div><div className="exchange-eyebrow"><Code2 size={14} /> Curated from established YouTube educators</div><h1>Programming Videos</h1><p>Keep learning with beginner-friendly programming tutorials, selected from their original YouTube channels.</p></div><span className="video-count">{PROGRAMMING_VIDEOS.length} tutorials</span></div>
    <section className="video-filter-bar" aria-label="Filter programming videos"><label className="video-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by language or topic" aria-label="Search by language or topic" /></label><label><span>Level</span><select className="exchange-input" value={level} onChange={event => setLevel(event.target.value)}><option>All levels</option><option>Beginner</option><option>Intermediate</option></select></label><label><span>Category</span><select className="exchange-input" value={category} onChange={event => setCategory(event.target.value)}><option>All categories</option>{['Programming', 'Web Development', 'Database', 'Backend', 'Frontend'].map(value => <option key={value}>{value}</option>)}</select></label></section>
    <div className="video-results-summary"><span><strong>{filtered.length}</strong> {filtered.length === 1 ? 'video' : 'videos'}</span><span>Videos are hosted by their original YouTube channels.</span></div>
    {filtered.length ? <div className="programming-video-grid">{filtered.map(item => <VideoCard key={item.id} video={item} />)}</div> : <div className="exchange-empty video-empty"><Search size={24} /><strong>No tutorials match those filters</strong><p>Try a different language, level, or category.</p></div>}
  </main>;
}