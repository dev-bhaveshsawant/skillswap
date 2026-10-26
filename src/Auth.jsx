import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { apiRequest, saveAuth } from './api.js';

export default function AuthPage({ register = false, toast, dark, toggleDark }) {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = await apiRequest(register ? '/auth/register' : '/auth/login', {
        method: 'POST', body: JSON.stringify({ fullName, email, password })
      });
      if (!localStorage.getItem('skillswap-local-demo-backup')) {
        const legacyData = localStorage.getItem('skillswap-exchange-data');
        const legacyUser = localStorage.getItem('skillswap-user');
        if (legacyData || legacyUser) localStorage.setItem('skillswap-local-demo-backup', JSON.stringify({ data: legacyData, user: legacyUser, registeredEmail: localStorage.getItem('skillswap-registered-email') }));
      }
      saveAuth(payload);
      window.dispatchEvent(new Event('skillswap-auth-changed'));
      toast?.show(register ? 'Account created. Welcome to SkillSwap!' : 'Welcome back to SkillSwap.');
      navigate('/my-skills');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-page">
    <div className="auth-aside"><Link to="/" className="brand"><span className="brand-mark"><Sparkles size={17} /></span>Skill<span>Swap</span></Link><div><div className="eyebrow">{register ? 'Your learning story starts here' : 'Welcome back'}</div><h1>{register ? <>Make your<br /><em>next move.</em></> : <>Good to see<br /><em>you again.</em></>}</h1><p>Learn openly. Share generously. Build something meaningful.</p></div></div>
    <div className="auth-form"><div className="eyebrow">{register ? 'Create your account' : 'Sign in to continue'}</div><h2>{register ? 'Join the exchange' : 'Welcome back'}</h2><p className="muted">{register ? 'Start learning and sharing in minutes.' : 'Pick up where you left off.'}</p>
      <form onSubmit={submit}>
        {register && <label>Full name<input value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Your name" minLength="2" maxLength="100" required /></label>}
        <label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" maxLength="254" required /></label>
        <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" minLength="8" maxLength="72" autoComplete={register ? 'new-password' : 'current-password'} required /></label>
        {register && <label className="check-label"><input type="checkbox" required /> I agree to the community guidelines</label>}
        {error && <p className="meeting-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Log in'} <ArrowRight size={16} /></button>
      </form>
      <div className="auth-switch">{register ? 'Already a member?' : 'New to SkillSwap?'} <button onClick={() => navigate(register ? '/login' : '/register')}>{register ? 'Log in' : 'Create an account'}</button></div>
    </div>
  </main>;
}
