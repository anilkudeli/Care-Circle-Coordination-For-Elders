import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import {
  Activity, AlertTriangle, ArrowUpRight, Bell, CalendarDays, Check,
  ChevronDown, ChevronRight, CircleHelp, Clock3, CreditCard, Eye, EyeOff, Heart,
  HeartPulse, Home, LogOut, MapPin, Menu, Mic, MicOff, Pill, Plus, Shield,
  Phone, PhoneOff, Siren, UserRound, Users, Video, VideoOff, X,
} from 'lucide-react';
import './styles.css';

const API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const SOCKET = (import.meta.env.VITE_SOCKET_URL || (API.startsWith('http') ? API.replace(/\/api$/, '') : window.location.origin)).replace(/\/$/, '');
const titles = {
  alerts: ['Alerts', 'Stay ahead of what needs attention.'],
  medications: ['Medications', 'Medication schedules and current care plans.'],
  medicationEvents: ['Medication activity', 'Record and review medication adherence.'],
  tasks: ['Care tasks', 'Coordinate the small things that make a big difference.'],
  shifts: ['Care schedule', 'Keep caregiver shifts and check-ins in sync.'],
  locations: ['Location', 'Share a location update with the people you trust.'],
  geofences: ['Safe zones', 'Set up a location boundary for a loved one.'],
  checkins: ['Check-ins', 'Stay close, even when you are apart.'],
  healthProfiles: ['Health profile', 'Keep essential health information available to your approved care team.'],
  vitals: ['Vitals', 'Record and review health measurements.'],
  appointments: ['Appointments', 'Coordinate upcoming care visits.'],
  careNotes: ['Care notes', 'Share helpful care observations with the right people.'],
  devices: ['Connected devices', 'Register a device to integrate fall and inactivity events.'],
  alertRules: ['Alert rules', 'Choose severity for incoming monitoring events.'],
  reports: ['Reports', 'A clearer picture of the week in care.'],
  organizations: ['Organization', 'Manage your care organization.'],
  invoices: ['Billing', 'Care service invoices and billing records.'],
  invitations: ['Team access', 'Coordinate trusted care team access.'],
  notifications: ['Notifications', 'Recent updates for your care circle.'],
  notificationPreferences: ['Notification settings', 'Choose which real-time in-app updates you receive.'],
  settings: ['Profile & settings', 'Your account and care preferences.'],
  paymentEvents: ['Payments', 'Record and review billing events.'],
  activity: ['Family activity', 'A shared timeline of care.'],
  contacts: ['Emergency contacts', 'Keep the right people within reach.'],
};
const menu = [
  { label: 'Overview', icon: Home, page: 'dashboard', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Alerts', icon: AlertTriangle, page: 'alerts', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Medications', icon: Pill, page: 'medications', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Medication activity', icon: Check, page: 'medicationEvents', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Health profile', icon: HeartPulse, page: 'healthProfiles', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Vitals', icon: Activity, page: 'vitals', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Appointments', icon: CalendarDays, page: 'appointments', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Care notes', icon: Heart, page: 'careNotes', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Care tasks', icon: Check, page: 'tasks', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Care schedule', icon: CalendarDays, page: 'shifts', roles: ['family', 'caregiver', 'admin'] },
  { label: 'Location & safety', icon: MapPin, page: 'locations', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Safe zones', icon: Shield, page: 'geofences', roles: ['family', 'caregiver', 'admin'] },
  { label: 'Devices', icon: Activity, page: 'devices', roles: ['caregiver', 'admin'] },
  { label: 'Alert rules', icon: AlertTriangle, page: 'alertRules', roles: ['caregiver', 'admin'] },
  { label: 'Check-ins', icon: Video, page: 'checkins', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Family activity', icon: Activity, page: 'activity', roles: ['family', 'caregiver', 'admin'] },
  { label: 'Reports', icon: Activity, page: 'reports', roles: ['family', 'caregiver', 'admin'] },
  { label: 'Notification settings', icon: Bell, page: 'notificationPreferences', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Profile & settings', icon: Users, page: 'settings', roles: ['senior', 'family', 'caregiver', 'admin'] },
  { label: 'Organization', icon: Users, page: 'organizations', roles: ['admin'] },
  { label: 'Team access', icon: Shield, page: 'team', roles: ['admin', 'caregiver', 'family'] },
  { label: 'Billing', icon: CreditCard, page: 'invoices', roles: ['admin'] },
];

async function request(path, token, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Cannot connect to CareCircle. Check that the API and MongoDB are running, then try again.');
    }
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error || (response.status >= 500
      ? 'CareCircle could not complete this request. Check that the API and MongoDB are running.'
      : 'Something went wrong. Please try again.');
    throw new Error(message);
  }
  return body;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('carecircle-token'));
  const [user, setUser] = useState(null);
  const [people, setPeople] = useState([]);
  const [careTeam, setCareTeam] = useState([]);
  const [notificationPreferences, setNotificationPreferences] = useState(null);
  const [selectedSeniorId, setSelectedSeniorId] = useState('');
  const [page, setPage] = useState('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [live, setLive] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const notify = useCallback((message) => { setToast(message); window.setTimeout(() => setToast(''), 3200); }, []);
  const signOut = useCallback(() => {
    localStorage.removeItem('carecircle-token');
    setToken(null);
    setUser(null);
    setPeople([]);
    setCareTeam([]);
    setNotificationPreferences(null);
    setSelectedSeniorId('');
    setPage('dashboard');
    setLive(false);
  }, []);

  useEffect(() => {
    if (!token) return;
    request('/auth/me', token).then((data) => setUser(data.user)).catch(signOut);
  }, [token, signOut]);

  useEffect(() => {
    if (!token || !user) return;
    request('/people', token).then((data) => {
      const seniors = data.people.filter((person) => person.role === 'senior');
      setPeople(seniors);
      setCareTeam(data.people);
      if (user.role === 'senior') setSelectedSeniorId(user.id);
      else if (!seniors.some((person) => person.id === selectedSeniorId)) setSelectedSeniorId(seniors[0]?.id || '');
    }).catch((e) => notify(e.message));
  }, [token, user, selectedSeniorId, refreshKey, notify]);

  useEffect(() => {
    if (!token || !user) return;
    request('/notification-preferences', token)
      .then((result) => setNotificationPreferences(result.preferences))
      .catch((e) => notify(e.message));
  }, [token, user, notify]);

  useEffect(() => {
    if (!token || !user) return;
    const socket = io(SOCKET, { auth: { token } });
    const heartbeat = window.setInterval(() => socket.emit('presence:heartbeat'), 5 * 60 * 1000);
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.on('care:update', (event) => {
      setRefreshKey((n) => n + 1);
      if ((event.resource === 'alerts' || event.event === 'emergency:new') && notificationPreferences?.alerts !== false) notify('A new care alert needs attention.');
      if (event.resource === 'notifications' && event.item?.data?.type === 'reminder' && notificationPreferences?.medicationReminders !== false) notify(event.item.data.message);
      if (event.resource !== 'alerts' && event.resource !== 'notifications' && notificationPreferences?.careUpdates !== false) notify('Your care circle has a new update.');
      if (event.event === 'organization:invited' && notificationPreferences?.invitations !== false) notify(`${event.organizationName} invited you to join its care team.`);
    });
    return () => { window.clearInterval(heartbeat); socket.disconnect(); };
  }, [token, user, notify, notificationPreferences]);

  useEffect(() => {
    const handler = (event) => setPage(event.detail);
    window.addEventListener('navigate-care', handler);
    return () => window.removeEventListener('navigate-care', handler);
  }, []);

  const onLogin = (data) => {
    localStorage.setItem('carecircle-token', data.token);
    setPeople([]);
    setCareTeam([]);
    setNotificationPreferences(null);
    setSelectedSeniorId('');
    setPage('dashboard');
    setToken(data.token);
    setUser(data.user);
  };

  if (!token || !user || window.location.pathname === '/reset-password') return <AuthScreen onLogin={onLogin} />;
  const visibleMenu = menu.filter((item) => item.roles.includes(user.role));
  return (
    <div className={`app-shell role-${user.role}`}>
      {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><HeartPulse size={21} /></div><span>carecircle</span></div>
        <div className="side-label">WORKSPACE</div>
        <div className="workspace-choice"><div className="workspace-avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><strong>{user.name}</strong><span>{roleName(user.role)}</span></div><ChevronDown size={15} /></div>
        <div className="side-label nav-label">MENU</div>
        <nav aria-label="Main navigation">
          {visibleMenu.map((item) => <button className={`nav-item ${page === item.page ? 'selected' : ''}`} key={item.page} onClick={() => { setPage(item.page); setMobileOpen(false); }}><item.icon size={18} strokeWidth={1.9} /><span>{item.label}</span>{item.page === 'alerts' && <i className="nav-dot" />}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="care-help"><div className="help-icon"><CircleHelp size={18} /></div><strong>Here to help</strong><p>Need help quickly? Review your emergency contacts.</p><button onClick={() => setPage('contacts')}>View contacts <ArrowUpRight size={14} /></button></div>
          <button className="nav-item" onClick={signOut}><LogOut size={18} /><span>Sign out</span></button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="breadcrumb">Workspace <ChevronRight size={14} /><strong>{page === 'dashboard' ? 'Overview' : titles[page]?.[0] || page}</strong></div>
          <div className="top-actions">{people.length > 1 && <label className="senior-picker"><span>CARE FOR</span><select value={selectedSeniorId} onChange={(event) => setSelectedSeniorId(event.target.value)} aria-label="Choose senior">{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}<div className="connection"><span className={live ? 'online' : 'offline'} />{live ? 'Live updates on' : 'Connecting'}</div><button className="icon-button notification-button" aria-label="Open notifications" onClick={() => setPage('notifications')}><Bell size={18} /><i /></button><div className="top-avatar">{user.name.slice(0, 1).toUpperCase()}</div></div>
        </header>
        <div className={`page-content page-${page}`} data-page={page}>
          {page === 'dashboard'
            ? <Dashboard user={user} token={token} selectedSeniorId={selectedSeniorId} people={people} refreshKey={refreshKey} onLinked={() => setRefreshKey((n) => n + 1)} setPage={setPage} notify={notify} />
            : page === 'notificationPreferences'
              ? <NotificationPreferencesPage token={token} preferences={notificationPreferences} onChange={setNotificationPreferences} notify={notify} />
            : page === 'settings'
              ? <SettingsPage user={user} token={token} onUserUpdate={setUser} setPage={setPage} signOut={signOut} notify={notify} />
            : page === 'organizations'
              ? <OrganizationPage token={token} notify={notify} />
              : page === 'team'
                ? <TeamPage token={token} user={user} notify={notify} refreshKey={refreshKey} onUpdate={() => setRefreshKey((n) => n + 1)} />
            : page === 'locations'
              ? <LocationPage user={user} token={token} selectedSeniorId={selectedSeniorId} refreshKey={refreshKey} notify={notify} />
              : page === 'reports'
                ? <ReportsPage token={token} user={user} selectedSeniorId={selectedSeniorId} />
                : page === 'checkins'
                  ? <CheckinsPage token={token} user={user} selectedSeniorId={selectedSeniorId} notify={notify} />
                  : <ResourcePage key={page} resource={page} token={token} user={user} careTeam={careTeam} selectedSeniorId={selectedSeniorId} refreshKey={refreshKey} notify={notify} />}
        </div>
      </main>
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}

function roleName(role) { return ({ senior: 'Senior', family: 'Family member', caregiver: 'Caregiver', admin: 'Administrator' })[role] || role; }
function hasStrongPassword(value) { return value.length >= 10 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value); }

function AuthScreen({ onLogin }) {
  const resetParams = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState(window.location.pathname === '/reset-password' ? 'reset' : 'landing');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(window.location.pathname === '/reset-password' && !resetParams.get('token')
    ? 'This reset link is missing its token. Request a new password reset link.'
    : '');
  const [notice, setNotice] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetToken] = useState(resetParams.get('token') || '');

  function changeMode(nextMode) {
    setMode(nextMode);
    setError('');
    setNotice('');
    if (nextMode !== 'reset' && window.location.pathname === '/reset-password') {
      window.history.replaceState({}, '', '/');
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(form.entries());
    if (mode === 'register') {
      if (!hasStrongPassword(data.password)) {
        setError('Use at least 10 characters with an uppercase letter, a lowercase letter, and a number.');
        return;
      }
      if (data.password !== data.confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      delete data.confirmPassword;
    }
    if (mode === 'reset') {
      if (!resetToken) {
        setError('This reset link is missing its token. Request a new password reset link.');
        return;
      }
      if (!hasStrongPassword(data.password)) {
        setError('Use at least 10 characters with an uppercase letter, a lowercase letter, and a number.');
        return;
      }
      if (data.password !== data.confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      data.token = resetToken;
      delete data.confirmPassword;
    }
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const result = await request('/auth/forgot-password', null, { method: 'POST', body: JSON.stringify(data) });
        setNotice(result.message || 'If a reset email could be sent, it is on its way.');
      } else if (mode === 'reset') {
        const result = await request('/auth/reset-password', null, { method: 'POST', body: JSON.stringify(data) });
        setNotice(result.message || 'Password updated. Sign in with your new password.');
        window.history.replaceState({}, '', '/');
        setMode('login');
      } else {
        const result = await request(`/auth/${mode === 'login' ? 'login' : 'register'}`, null, { method: 'POST', body: JSON.stringify(data) });
        onLogin(result);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (mode === 'landing') return <LandingPage onSignIn={() => setMode('login')} onRegister={() => setMode('register')} />;
  const headings = {
    login: ['Welcome back', 'Sign in to your care workspace.'],
    register: ['Create your account', 'Start coordinating care with the people you trust.'],
    forgot: ['Reset your password', 'Enter your account email to request a reset link.'],
    reset: ['Choose a new password', 'Create a new password for your account.'],
  };
  return <div className="auth-page"><div className="auth-panel"><button className="auth-back" type="button" onClick={() => changeMode('landing')}>← Back to CareCircle</button><div className="auth-form-wrap"><div className="mobile-auth-brand"><div className="brand-mark"><HeartPulse size={20} /></div>carecircle</div><div className="eyebrow"><span /> YOUR CARE CIRCLE</div><h2>{headings[mode][0]}</h2><p className="auth-subtitle">{headings[mode][1]}</p>
      <form onSubmit={submit} className="auth-form">
        {mode === 'register' && <>
          <label>Full name<input name="name" autoComplete="name" minLength="2" maxLength="100" placeholder="e.g. Alex Morgan" required /></label>
          <label>Username (optional)<input name="username" autoComplete="username" minLength="3" maxLength="30" pattern="[A-Za-z0-9](?:[A-Za-z0-9._\x2d]*[A-Za-z0-9])?" placeholder="e.g. alex.morgan" /></label>
          <label>Phone number<input name="phone" type="tel" autoComplete="tel" minLength="7" maxLength="24" placeholder="e.g. +1 555 010 1234" required /></label>
        </>}
        {mode !== 'reset' && <label>{mode === 'login' ? 'Email or username' : 'Email address'}<input name="email" type={mode === 'login' ? 'text' : 'email'} autoComplete={mode === 'login' ? 'username' : 'email'} placeholder={mode === 'login' ? 'you@example.com or username' : 'you@example.com'} required /></label>}
        {mode !== 'forgot' && <label>{mode === 'reset' ? 'New password' : 'Password'}<div className="password-field"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' || mode === 'reset' ? 10 : 1} placeholder={mode === 'register' || mode === 'reset' ? 'At least 10 characters' : 'Enter your password'} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
        {(mode === 'register' || mode === 'reset') && <label>Confirm password<div className="password-field"><input name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="10" placeholder="Enter the password again" required /><button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
        {mode === 'register' && <label>Your role<select name="role" defaultValue="family"><option value="senior">Senior</option><option value="family">Family member</option><option value="caregiver">Caregiver</option></select></label>}
        {mode === 'login' && <button className="auth-inline-link" type="button" onClick={() => changeMode('forgot')}>Forgot password?</button>}
        {notice && <div className="auth-notice" role="status">{notice}</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-button full-button" disabled={busy || (mode === 'reset' && !resetToken)}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Request reset link' : 'Update password'} <ArrowUpRight size={16} /></button>
      </form>
      {mode === 'forgot' && <div className="auth-switch">Remembered it? <button onClick={() => changeMode('login')}>Sign in</button></div>}
      {mode === 'reset' && <div className="auth-switch">Need a fresh link? <button onClick={() => changeMode('forgot')}>Request password reset</button></div>}
      {(mode === 'login' || mode === 'register') && <div className="auth-switch">{mode === 'login' ? 'New to CareCircle?' : 'Already have an account?'} <button onClick={() => changeMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></div>}
      <div className="privacy-note"><Shield size={14} /> Your care information is protected and private.</div>
    </div></div></div>;
}

function LandingPage({ onSignIn, onRegister }) {
  const features = [
    { icon: Shield, title: 'Fall & safety alerts', text: 'A shared place for your care circle to review important safety updates.' },
    { icon: Pill, title: 'Medication routines', text: 'Keep schedules and taken, missed, or skipped doses visible to approved members.' },
    { icon: Users, title: 'Care team coordination', text: 'Bring family members and caregivers together around tasks and visits.' },
    { icon: MapPin, title: 'Location by choice', text: 'Share a location update when it is useful, with safe-zone context for your circle.' },
  ];
  return <div className="landing-page">
    <header className="landing-nav">
      <a className="brand landing-brand" href="#home" aria-label="CareCircle home"><span className="brand-mark"><HeartPulse size={21} /></span><span>carecircle</span></a>
      <nav aria-label="Landing page navigation"><a href="#care-tools">Care tools</a><a href="#how-it-works">How it works</a><a href="#safety">Safety</a></nav>
      <div className="landing-nav-actions"><button className="landing-login" onClick={onSignIn}>Sign in</button><button className="primary-button" onClick={onRegister}>Create account <ArrowUpRight size={15} /></button></div>
    </header>
    <main>
      <section className="landing-hero" id="home">
        <div className="landing-hero-copy">
          <div className="eyebrow"><span /> CARE, CONNECTED</div>
          <h1>More peace of mind.<br /><em>Every day.</em></h1>
          <p>Thoughtful tools to help older adults, families, and caregivers stay connected around the care that matters.</p>
          <div className="landing-hero-actions"><button className="primary-button landing-cta" onClick={onRegister}>Build your care circle <ArrowUpRight size={17} /></button><a className="landing-learn" href="#how-it-works">Explore how it works <ChevronDown size={15} /></a></div>
          <div className="landing-trust"><Shield size={16} /><span>Private by design. Access is based on approved care-circle connections.</span></div>
        </div>
        <div className="landing-hero-art" aria-label="An original starfield and nebula illustration representing a connected care circle" role="img">
          <div className="galaxy-scene" aria-hidden="true">
            <div className="galaxy-nebula nebula-back" />
            <div className="galaxy-nebula nebula-front" />
            <div className="galaxy-orbit orbit-wide" />
            <div className="galaxy-orbit orbit-tight" />
            <div className="galaxy-core"><HeartPulse size={32} /></div>
            <span className="galaxy-star star-one" />
            <span className="galaxy-star star-two" />
            <span className="galaxy-star star-three" />
          </div>
          <div className="hero-status-card"><span className="status-indicator" /><div><strong>Your care circle</strong><small>Here when you need us</small></div><Users size={18} /></div>
          <div className="hero-art-caption"><Heart size={15} />Care that feels a little closer</div>
        </div>
      </section>
      <section className="landing-proof" aria-label="CareCircle principles"><div><Shield size={18} /><span><strong>Approved access</strong><small>Care information stays with your circle</small></span></div><div><HeartPulse size={18} /><span><strong>Made for everyday care</strong><small>Practical tools, clear updates</small></span></div><div><Users size={18} /><span><strong>One connected team</strong><small>Family and caregivers in sync</small></span></div></section>
      <section className="landing-section landing-features" id="care-tools">
        <div className="landing-section-heading"><div className="eyebrow"><span /> SUPPORT FOR THE EVERYDAY</div><h2>Care coordination, with room to breathe.</h2><p>Useful information is easier to act on when it is clear, shared, and close at hand.</p></div>
        <div className="feature-grid">{features.map(({ icon: Icon, title, text }, index) => <article className={`landing-feature feature-tone-${index}`} key={title}><div className="landing-feature-icon"><Icon size={21} /></div><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>
      <section className="landing-how" id="how-it-works"><div className="landing-how-copy"><div className="eyebrow"><span /> A SIMPLE WAY TO BEGIN</div><h2>Better care starts with being connected.</h2><p>Create an account, invite the people you trust, and build a shared picture of care at a pace that works for you.</p><button className="secondary-button" onClick={onRegister}>Get started <ArrowUpRight size={15} /></button></div><ol className="landing-steps"><li><span>01</span><div><strong>Create your account</strong><p>Choose the role that describes how you take part in care.</p></div></li><li><span>02</span><div><strong>Approve your care circle</strong><p>Seniors decide who can access their care information.</p></div></li><li><span>03</span><div><strong>Coordinate in one place</strong><p>Share schedules, updates, and safety information with approved members.</p></div></li></ol></section>
      <section className="landing-safety" id="safety"><div className="safety-visual"><div className="safety-orbit orbit-one" /><div className="safety-orbit orbit-two" /><div className="safety-center"><Shield size={34} /><span>Care circle<br />connected</span></div><span className="safety-node node-one"><AlertTriangle size={16} /></span><span className="safety-node node-two"><Pill size={16} /></span><span className="safety-node node-three"><Users size={16} /></span></div><div className="safety-copy"><div className="eyebrow"><span /> SAFETY, WITHOUT THE NOISE</div><h2>Stay in the loop when it matters.</h2><p>Fall and inactivity alerts can be reviewed alongside care tasks, medication activity, and location updates—so trusted members have helpful context.</p><ul><li><Check size={16} /> Clear alert status and follow-up</li><li><Check size={16} /> Medication schedules and adherence events</li><li><Check size={16} /> Caregiver tasks, visits, and check-ins</li></ul><button className="primary-button" onClick={onRegister}>Create your care circle <ArrowUpRight size={15} /></button></div></section>
      <section className="landing-cta-band"><div><div className="eyebrow"><span /> A LITTLE CLOSER, EVERY DAY</div><h2>Make care easier to share.</h2><p>Start a care circle for the people who matter to you.</p></div><button className="primary-button" onClick={onRegister}>Get started <ArrowUpRight size={16} /></button></section>
    </main>
    <footer className="landing-footer"><a className="brand landing-brand" href="#home"><span className="brand-mark"><HeartPulse size={20} /></span><span>carecircle</span></a><p>Care coordination for the moments that matter.</p><span>CareCircle · Information is shared only with approved members.</span><button onClick={onSignIn}>Sign in</button></footer>
  </div>;
}

function SettingsPage({ user, token, onUserUpdate, setPage, signOut, notify }) {
  const [profile, setProfile] = useState({ name: user.name, phone: user.phone || '' });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileNotice, setProfileNotice] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  useEffect(() => setProfile({ name: user.name, phone: user.phone || '' }), [user.name, user.phone]);

  async function saveProfile(event) {
    event.preventDefault();
    setProfileBusy(true);
    setProfileError('');
    setProfileNotice('');
    try {
      const result = await request('/auth/profile', token, { method: 'PATCH', body: JSON.stringify(profile) });
      onUserUpdate(result.user);
      setProfileNotice('Profile details saved.');
      notify('Profile updated.');
    } catch (error) { setProfileError(error.message); }
    finally { setProfileBusy(false); }
  }

  async function changePassword(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPasswordBusy(true);
    setPasswordError('');
    setPasswordNotice('');
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get('currentPassword') || '');
    const newPassword = String(form.get('newPassword') || '');
    const confirmPassword = String(form.get('confirmPassword') || '');
    if (!hasStrongPassword(newPassword)) {
      setPasswordError('Use at least 10 characters with an uppercase letter, a lowercase letter, and a number.');
      setPasswordBusy(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      setPasswordBusy(false);
      return;
    }
    try {
      const result = await request('/auth/change-password', token, {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      formElement.reset();
      setPasswordNotice(result.message);
      notify('Password updated.');
    } catch (error) { setPasswordError(error.message); }
    finally { setPasswordBusy(false); }
  }

  return <div className="resource-page settings-page">
    <div className="resource-heading"><div><div className="eyebrow"><span /> YOUR ACCOUNT</div><h1>Profile & settings</h1><p>Review your account details and care-circle preferences.</p></div></div>
    <div className="settings-layout">
      <section className="panel settings-profile"><div className="settings-avatar">{user.name.slice(0, 1).toUpperCase()}</div><div className="eyebrow"><span /> ACCOUNT PROFILE</div><h2>{user.name}</h2><p>{user.email}</p><span className="role-badge">{roleName(user.role)}</span><div className="settings-separator" /><div className="settings-detail"><span>Phone</span><strong>{user.phone || 'Not provided'}</strong></div><div className="settings-detail"><span>Care-circle connections</span><strong>{user.seniorIds?.length || (user.role === 'senior' ? 1 : 0)}</strong></div><div className="settings-detail"><span>Account access</span><strong>Approved relationships only</strong></div></section>
      <div className="settings-sections">
        <form className="panel settings-edit-form" onSubmit={saveProfile}>
          <div className="settings-form-heading"><div><h2>Personal information</h2><p>Update the name and phone number shown to your care circle.</p></div><UserRound size={18} /></div>
          <div className="settings-form-grid"><label>Full name<input name="name" autoComplete="name" minLength="2" maxLength="100" value={profile.name} onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} required /></label><label>Phone number<input name="phone" type="tel" autoComplete="tel" minLength="7" maxLength="24" value={profile.phone} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} required /></label></div>
          {profileError && <div className="form-error" role="alert">{profileError}</div>}{profileNotice && <div className="auth-notice" role="status">{profileNotice}</div>}
          <div className="settings-form-actions"><button className="primary-button" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save profile'}</button></div>
        </form>
        <form className="panel settings-edit-form" onSubmit={changePassword}>
          <div className="settings-form-heading"><div><h2>Change password</h2><p>Choose a strong password to protect your account.</p></div><Shield size={18} /></div>
          <label>Current password<input name="currentPassword" type={showPasswords ? 'text' : 'password'} autoComplete="current-password" required /></label>
          <div className="settings-form-grid"><label>New password<input name="newPassword" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" minLength="10" required /></label><label>Confirm new password<input name="confirmPassword" type={showPasswords ? 'text' : 'password'} autoComplete="new-password" minLength="10" required /></label></div>
          <label className="settings-show-password"><input type="checkbox" checked={showPasswords} onChange={(event) => setShowPasswords(event.target.checked)} />Show passwords</label>
          {passwordError && <div className="form-error" role="alert">{passwordError}</div>}{passwordNotice && <div className="auth-notice" role="status">{passwordNotice}</div>}
          <div className="settings-form-actions"><button className="primary-button" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : 'Update password'}</button></div>
        </form>
        <section className="panel settings-option"><div className="settings-option-icon"><Phone size={18} /></div><div><h2>Emergency contacts</h2><p>Review the contacts attached to your care-circle records.</p></div><button className="secondary-button" onClick={() => setPage('contacts')}>Manage contacts <ArrowUpRight size={14} /></button></section>
        <section className="panel settings-option"><div className="settings-option-icon"><Bell size={18} /></div><div><h2>Notifications</h2><p>Choose which in-app alerts and care updates you receive.</p></div><button className="secondary-button" onClick={() => setPage('notificationPreferences')}>Manage settings <ArrowUpRight size={14} /></button></section>
        <section className="panel settings-option"><div className="settings-option-icon"><Shield size={18} /></div><div><h2>Privacy & security</h2><p>Your care information is visible only within approved care-circle relationships.</p></div><span className="security-status"><Check size={14} /> Protected</span></section>
        <section className="panel settings-option signout-option"><div className="settings-option-icon"><LogOut size={18} /></div><div><h2>Sign out</h2><p>End this session on this device.</p></div><button className="secondary-button" onClick={signOut}>Sign out</button></section>
      </div>
    </div>
  </div>;
}

function Dashboard({ user, token, selectedSeniorId, people, refreshKey, onLinked, setPage, notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [linkRequests, setLinkRequests] = useState([]);
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  useEffect(() => {
    setLoading(true);
    request(`/dashboard${selectedSeniorId ? `?seniorId=${encodeURIComponent(selectedSeniorId)}` : ''}`, token).then((result) => { setData(result); setError(''); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [token, selectedSeniorId, refreshKey]);
  useEffect(() => {
    if (user.role === 'senior') request('/auth/link-requests', token).then((result) => setLinkRequests(result.items || [])).catch((e) => setError(e.message));
  }, [token, user.role, refreshKey]);
  const stats = [
    { label: 'Active alerts', value: data?.counts?.alerts ?? '—', delta: 'Needs your attention', icon: AlertTriangle, tone: 'coral', page: 'alerts' },
    { label: 'Active medications', value: data?.counts?.medications ?? '—', delta: 'Current medication plans', icon: Pill, tone: 'lilac', page: 'medications' },
    { label: 'Open care tasks', value: data?.counts?.tasks ?? '—', delta: 'Across your care circle', icon: Check, tone: 'mint', page: 'tasks' },
    { label: 'Care team', value: user.role === 'admin' ? data?.counts?.users ?? '—' : user.seniorIds.length || (user.role === 'senior' ? 1 : '—'), delta: 'Connected members', icon: Users, tone: 'blue', page: 'activity' },
  ];
  async function emergency() {
    if (!window.confirm('Send an emergency alert to your connected care circle?')) return;
    setEmergencyBusy(true);
    try { await request('/emergency', token, { method: 'POST', body: JSON.stringify({ seniorId: selectedSeniorId, message: 'Emergency assistance requested.' }) }); notify('Emergency alert sent to your in-app care circle.'); }
    catch (e) { notify(e.message); }
    finally { setEmergencyBusy(false); }
  }
  async function approveLink(id) {
    try {
      const result = await request(`/auth/link-requests/${id}/approve`, token, { method: 'POST', body: '{}' });
      notify(result.message);
      setLinkRequests((current) => current.filter((item) => item._id !== id));
      onLinked();
    } catch (e) { notify(e.message); }
  }
  const records = data?.activity || data?.recent || [];
  if (error) return <div className="inline-error">{error} <button onClick={() => setData(null)}>Try again</button></div>;
  const dashboardTitle = ({ senior: 'Your care, made simple', family: 'A clear view of your loved one’s care', caregiver: 'Your care shift at a glance', admin: 'Care operations overview' })[user.role];
  const dashboardIntro = ({ senior: 'Your safety, schedule, and care team—all in one calm place.', family: 'The latest updates and next steps from your care circle.', caregiver: 'Today’s priorities, visits, and care-team updates.', admin: 'A live snapshot of care activity across your organization.' })[user.role];
  return <div className={`dashboard-page dashboard-${user.role}`}>
    <div className="welcome-row"><div><div className="eyebrow"><span /> {user.role === 'senior' ? 'YOUR WELLBEING' : `${roleName(user.role).toUpperCase()} WORKSPACE`}</div><h1>{dashboardTitle}</h1><p>{dashboardIntro}</p></div><button className="emergency-button" onClick={emergency} disabled={emergencyBusy || !selectedSeniorId} title={!selectedSeniorId ? 'Connect to a senior before sending an emergency alert.' : undefined}><Siren size={17} />{emergencyBusy ? 'Sending…' : 'Emergency'}</button></div>
    <div className="date-strip"><CalendarDays size={15} /><span>{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span><span className="date-divider">·</span><span>Updates shared with your approved care circle</span></div>
    <div className="stat-grid">{stats.map((stat) => <button className={`stat-card stat-${stat.tone}`} key={stat.label} onClick={() => setPage(stat.page)}><div className="stat-top"><div className="stat-icon"><stat.icon size={19} /></div><span className="stat-link">View <ArrowUpRight size={14} /></span></div><div className="stat-value">{stat.value}</div><div className="stat-name">{stat.label}</div><div className="stat-delta">{stat.delta}</div></button>)}</div>
    <div className="content-grid">
      <section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>A little update from your care circle</p></div><button className="text-button" onClick={() => setPage('activity')}>See all <ArrowUpRight size={15} /></button></div>
        {loading ? <div className="empty-state"><div className="loader" /><strong>Loading care updates…</strong></div> : records.length === 0 ? <div className="empty-state"><div className="empty-icon"><Activity size={20} /></div><strong>Your care story starts here</strong><p>Updates from your care circle will appear here.</p></div> : <div className="activity-list">{records.slice(0, 6).map((item) => <ActivityItem key={item._id} item={item} />)}</div>}
      </section>
      <section className="panel right-panel"><div className="panel-heading"><div><h2>Today’s care</h2><p>Small moments, thoughtful care</p></div><button className="circle-action" onClick={() => setPage('tasks')} aria-label="Open care tasks"><ChevronRight size={17} /></button></div>
        <div className="care-today"><div className="today-icon medicine"><Pill size={17} /></div><div><strong>Medication schedule</strong><span>{data?.medications?.length ? `${data.medications.length} active medication${data.medications.length === 1 ? '' : 's'}` : 'No schedule added yet'}</span></div><button onClick={() => setPage('medications')}>View</button></div>
        <div className="care-today"><div className="today-icon caregiver"><Users size={17} /></div><div><strong>Care tasks</strong><span>{data?.tasks?.length ? `${data.tasks.length} tasks to take care of` : 'No open tasks right now'}</span></div><button onClick={() => setPage('tasks')}>View</button></div>
        <div className="care-today"><div className="today-icon location"><MapPin size={17} /></div><div><strong>Location check-in</strong><span>{data?.location ? 'Last location update received' : 'No recent location shared'}</span></div><button onClick={() => setPage('locations')}>View</button></div>
        <button className="quick-add" onClick={() => setPage('checkins')}><span><Video size={17} /></span>Plan a video check-in<ArrowUpRight size={15} /></button>
      </section>
    </div>
    {user.role === 'senior' && linkRequests.map((item) => <div className="panel pending-link" key={item._id}><div className="link-senior-icon"><Users size={19} /></div><div className="link-senior-copy"><strong>{item.data.requesterName} wants to join your care circle</strong><span>Approving gives this {item.data.requesterRole} access to your care information.</span></div><button className="primary-button" onClick={() => approveLink(item._id)}>Approve access</button></div>)}
    {user.role !== 'senior' && people.length === 0 && <LinkSeniorCard token={token} onLinked={onLinked} notify={notify} />}
    <section className="gentle-banner"><div className="banner-icon"><Heart size={20} /></div><div><strong>Care is a team effort.</strong><p>A thoughtful check-in can make someone’s whole day.</p></div><button onClick={() => setPage('checkins')}>Plan a check-in <ArrowUpRight size={14} /></button><div className="banner-decoration">✳</div></section>
  </div>;
}

function ActivityItem({ item }) {
  const resource = item.kind || item.resource || 'care';
  const detail = item.data || {};
  const title = detail.message || detail.name || (resource === 'alerts' ? `${detail.type || 'Care'} alert` : `${humanize(resource)} updated`);
  const Icon = resource === 'alerts' ? AlertTriangle : resource === 'medications' ? Pill : resource === 'tasks' ? Check : Heart;
  return <div className="activity-item"><div className={`activity-dot ${resource === 'alerts' ? 'alert-dot' : ''}`}><Icon size={15} /></div><div className="activity-copy"><strong>{title}</strong><span>{detail.actor || detail.type || humanize(resource)}{detail.status ? ` · ${humanize(detail.status)}` : ''}</span></div><time>{timeAgo(item.createdAt)}</time></div>;
}

function VitalTrends({ token, seniorId }) {
  const [type, setType] = useState('heartRate');
  const [measurements, setMeasurements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!seniorId) { setMeasurements([]); setLoading(false); return; }
    setLoading(true);
    request(`/vitals/trends?seniorId=${encodeURIComponent(seniorId)}&type=${type}&days=30`, token)
      .then((result) => { setMeasurements(result.measurements || []); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, seniorId, type]);
  const points = measurements.slice(-14);
  const maximum = Math.max(1, ...points.map((item) => Number(item.data.value) || 0));
  return <section className="panel vitals-trends"><div className="panel-heading"><div><h2>30-day vital trends</h2><p>Recorded measurements only; this is not a clinical interpretation.</p></div><select value={type} onChange={(event) => setType(event.target.value)} aria-label="Vital type"><option value="heartRate">Heart rate</option><option value="bloodPressure">Blood pressure</option><option value="temperature">Temperature</option><option value="weight">Weight</option><option value="bloodGlucose">Blood glucose</option><option value="oxygenSaturation">Oxygen saturation</option></select></div>{error ? <div className="inline-error">{error}</div> : loading ? <div className="inline-empty">Loading vital trends…</div> : points.length ? <div className="vitals-chart" aria-label={`${points.length} recorded measurements`}>{points.map((item) => <div className="vital-bar-column" key={item._id} title={`${item.data.value} ${item.data.unit} · ${new Date(item.occurredAt).toLocaleString()}`}><span>{item.data.value}{item.data.unit}</span><i style={{ height: `${Math.max(8, Number(item.data.value) / maximum * 100)}%` }} /><time>{new Date(item.occurredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></div>)}</div> : <div className="inline-empty">Record a vital measurement to begin your trend history.</div>}</section>;
}

function LinkSeniorCard({ token, onLinked, notify }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function link(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const email = new FormData(event.currentTarget).get('email');
    try {
      const result = await request('/auth/link-senior', token, { method: 'POST', body: JSON.stringify({ email }) });
      notify(result.message);
      event.currentTarget.reset();
      onLinked();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <form className="panel link-senior-card" onSubmit={link}>
    <div className="link-senior-icon"><Users size={19} /></div>
    <div className="link-senior-copy"><strong>Connect with a senior</strong><span>Enter the email used for their CareCircle account to link your care circles.</span></div>
    <input name="email" type="email" required placeholder="Senior’s account email" aria-label="Senior's account email" />
    <button className="primary-button" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
    {error && <div className="link-senior-error" role="alert">{error}</div>}
  </form>;
}

function ResourcePage({ resource, token, user, careTeam, selectedSeniorId, refreshKey, notify }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageNumber, setPageNumber] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formItem, setFormItem] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [doseBusyId, setDoseBusyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [integrationKey, setIntegrationKey] = useState('');
  const [copyState, setCopyState] = useState('');
  const copy = titles[resource] || [humanize(resource), 'Keep your care circle in sync.'];
  const fields = fieldsFor(resource, careTeam);
  const load = useCallback((requestedPage = pageNumber) => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(requestedPage) });
    if (selectedSeniorId) query.set('seniorId', selectedSeniorId);
    request(`/${resource}?${query}`, token).then((result) => { setItems(result.items || []); setHasMore(Boolean(result.hasMore)); setTotal(result.total || 0); setError(''); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [resource, token, selectedSeniorId, pageNumber]);
  useEffect(() => { load(); }, [load, refreshKey]);
  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      const data = {};
      for (const field of fields) {
        const value = form.get(field.name);
        if (value !== null && value !== '') {
          data[field.name] = field.type === 'number' ? Number(value) : field.name === 'conditions' || field.name === 'allergies'
            ? value.split(',').map((entry) => entry.trim()).filter(Boolean)
            : field.name === 'lineItems' ? JSON.parse(value)
              : value;
        }
      }
      if (resource === 'medications') data.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const defaultStatus = resource === 'tasks' || resource === 'invitations' ? 'pending' : resource === 'appointments' ? 'scheduled' : resource === 'paymentEvents' ? 'requires-provider' : resource === 'medicationEvents' ? data.type : resource === 'invoices' ? 'pending' : 'active';
      const { status = defaultStatus, ...details } = data;
      const result = await request(`/${resource}`, token, { method: 'POST', body: JSON.stringify({ seniorId: selectedSeniorId || undefined, status, data: details }) });
      setFormOpen(false);
      setFormItem(null);
      if (result.integrationKey) setIntegrationKey(result.integrationKey);
      notify(`${copy[0].replace(/s$/, '')} saved.`);
      setPageNumber(1);
      load(1);
    } catch (e) { setError(resource === 'invoices' && e instanceof SyntaxError ? 'Line items must be valid JSON, for example [{"description":"Care visit","quantity":1,"unitAmount":75}].' : e.message); }
    finally { setBusy(false); }
  }
  async function updateRecord(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      const data = {};
      for (const field of fields) {
        const value = form.get(field.name);
        if (value !== null && value !== '') {
          data[field.name] = field.type === 'number' ? Number(value) : field.name === 'conditions' || field.name === 'allergies'
            ? value.split(',').map((entry) => entry.trim()).filter(Boolean)
            : field.name === 'lineItems' ? JSON.parse(value)
              : value;
        }
      }
      if (resource === 'medications') data.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      await request(`/${resource}/${formItem._id}`, token, { method: 'PATCH', body: JSON.stringify({ data }) });
      setFormOpen(false);
      setFormItem(null);
      notify(`${copy[0].replace(/s$/, '')} updated.`);
      load();
    } catch (e) { setError(resource === 'invoices' && e instanceof SyntaxError ? 'Line items must be valid JSON.' : e.message); }
    finally { setBusy(false); }
  }
  async function updateStatus(item, status) {
    let data;
    if (resource === 'invoices' && status === 'paid') {
      const reference = window.prompt('Enter the offline payment reference. This records an offline payment; no payment is processed by CareCircle.');
      if (!reference?.trim()) return;
      data = { paymentMethod: 'offline', paymentReference: reference.trim() };
    }
    setBusyId(item._id);
    try {
      await request(`/${resource}/${item._id}`, token, { method: 'PATCH', body: JSON.stringify({ status, ...(data ? { data } : {}) }) });
      notify(`Updated to ${humanize(status)}.`);
      load();
    } catch (e) { setError(e.message); }
    finally { setBusyId(''); }
  }
  async function remove(item) {
    if (!window.confirm('Remove this record from the care circle?')) return;
    try { await request(`/${resource}/${item._id}`, token, { method: 'DELETE' }); notify('Record removed.'); load(); }
    catch (e) { setError(e.message); }
  }
  async function recordDose(item, type) {
    setDoseBusyId(item._id);
    try {
      await request(`/medications/${item._id}/events`, token, { method: 'POST', body: JSON.stringify({ type }) });
      notify(`${item.data.name}: recorded as ${type}.`);
      load();
    } catch (e) { setError(e.message); }
    finally { setDoseBusyId(''); }
  }
  const canCreate = resource !== 'activity';
  return <div className="resource-page">
    <div className="resource-heading"><div><div className="eyebrow"><span /> CARE COORDINATION</div><h1>{copy[0]}</h1><p>{copy[1]}</p></div>{canCreate && <button className="primary-button" onClick={() => { setFormItem(null); setFormOpen((v) => !v); }}><Plus size={16} />{formOpen ? 'Close form' : `Add ${resource === 'medicationEvents' ? 'activity' : humanize(resource).replace(/s$/, '').toLowerCase()}`}</button>}</div>
    {error && <div className="form-error resource-error">{error}<button onClick={load}>Dismiss</button></div>}
    {integrationKey && <div className="panel integration-key"><div className="link-senior-icon"><Shield size={18} /></div><div><strong>Copy this device key now</strong><p>It is shown once. Store it securely in your device configuration; it cannot be retrieved later.</p><code>{integrationKey}</code></div><button className="secondary-button small" onClick={async () => { try { await navigator.clipboard.writeText(integrationKey); setCopyState('Copied'); } catch { setCopyState('Clipboard unavailable'); } }}>{copyState || 'Copy key'}</button><button className="icon-button" aria-label="Hide key" onClick={() => setIntegrationKey('')}><X size={15} /></button></div>}
    {formOpen && <form key={formItem?._id || 'new'} className="panel record-form" onSubmit={formItem ? updateRecord : create}><h2>{formItem ? `Edit ${copy[0].replace(/s$/, '').toLowerCase()}` : `New ${copy[0].replace(/s$/, '').toLowerCase()}`}</h2><div className="form-grid">{fields.map((field) => { const initial = formItem?.data?.[field.name]; const value = Array.isArray(initial) ? initial.join(', ') : initial ?? ''; return <label key={field.name}>{field.label}{field.type === 'select' ? <select name={field.name} defaultValue={value || field.options[0].value}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === 'textarea' ? <textarea name={field.name} required={field.required} defaultValue={value} placeholder={field.placeholder || ''} rows={4} /> : <input name={field.name} type={field.type || 'text'} required={field.required} min={field.type === 'number' ? 0 : undefined} defaultValue={value} placeholder={field.placeholder || ''} />}</label>; })}</div><div className="form-actions"><button className="secondary-button" type="button" onClick={() => { setFormOpen(false); setFormItem(null); }}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : formItem ? 'Save changes' : 'Save record'}</button></div></form>}
    {resource === 'vitals' && <VitalTrends token={token} seniorId={selectedSeniorId} />}
    <div className="resource-toolbar"><div className="result-count">{loading ? 'Loading records…' : `${total} ${total === 1 ? 'record' : 'records'} · page ${pageNumber}`}</div><button className="filter-button" onClick={() => load()}><Activity size={15} /> Refresh</button></div>
    {loading ? <div className="panel loading-panel"><div className="loader" />Loading your care records…</div> : items.length === 0 ? <div className="panel resource-empty"><div className="empty-icon"><Activity size={20} /></div><h3>No records yet</h3><p>When you add care details, they’ll be safely available to your authorized care circle.</p>{canCreate && <button className="primary-button" onClick={() => setFormOpen(true)}><Plus size={15} />Add the first record</button>}</div> :
      <div className="record-list">{items.map((item) => {
        const nextStatus = resource === 'alerts' ? item.status === 'active' ? 'acknowledged' : 'resolved'
          : resource === 'invoices' ? 'paid'
            : ['devices', 'alertRules', 'geofences'].includes(resource) ? item.status === 'active' ? 'inactive' : 'active'
              : resource === 'appointments' ? item.status === 'confirmed' ? 'completed' : 'confirmed'
                : resource === 'tasks' && item.status === 'pending' ? 'in-progress'
                : 'completed';
        const actionLabel = resource === 'alerts' ? item.status === 'active' ? 'Acknowledge' : 'Resolve'
          : resource === 'invoices' ? 'Record offline payment'
            : ['devices', 'alertRules', 'geofences'].includes(resource) ? item.status === 'active' ? 'Deactivate' : 'Activate'
              : resource === 'appointments' ? item.status === 'confirmed' ? 'Complete appointment' : 'Confirm appointment'
                : resource === 'tasks' && item.status === 'pending' ? 'Start task'
                : 'Mark done';
        const canComplete = ['active', 'pending', 'in-progress', 'acknowledged', 'scheduled', 'confirmed', 'inactive'].includes(item.status);
        return <article className="panel record-card" key={item._id}><div className={`record-icon ${item.kind === 'alerts' ? 'record-alert' : ''}`}>{iconFor(item.kind)}</div><div className="record-main"><div className="record-title-row"><h3>{item.data?.name || item.data?.message || item.data?.title || `${humanize(item.kind)} entry`}</h3><span className={`status-pill status-${item.status}`}>{humanize(item.status)}</span></div><p>{Object.entries(item.data || {}).filter(([key, value]) => !['name', 'message', 'title'].includes(key) && ['string', 'number'].includes(typeof value)).slice(0, 3).map(([key, value]) => `${humanize(key)}: ${value}`).join(' · ') || item.data?.message || 'Care circle record'}</p><div className="record-meta"><Clock3 size={13} />{new Date(item.createdAt).toLocaleString()}{resource === 'invoices' && ` · ID ${item._id}`}</div></div><div className="record-actions">{resource === 'medications' && item.status === 'active' && <><button className="secondary-button small" disabled={doseBusyId === item._id} onClick={() => recordDose(item, 'taken')}>{doseBusyId === item._id ? 'Saving…' : 'Taken'}</button><button className="secondary-button small" disabled={doseBusyId === item._id} onClick={() => recordDose(item, 'missed')}>Missed</button><button className="secondary-button small" disabled={doseBusyId === item._id} onClick={() => recordDose(item, 'skipped')}>Skipped</button></>}{canComplete && <button className="secondary-button small" disabled={busyId === item._id} onClick={() => updateStatus(item, nextStatus)}>{busyId === item._id ? 'Saving…' : actionLabel}</button>}{resource !== 'activity' && <button className="secondary-button small" onClick={() => { setFormItem(item); setFormOpen(true); }}>Edit</button>}{resource !== 'activity' && ['caregiver', 'admin'].includes(user.role) && <button className="icon-button delete-button" aria-label="Remove record" onClick={() => remove(item)}><X size={16} /></button>}</div></article>;
      })}</div>}
    {!loading && total > 50 && <div className="pagination-controls"><button className="secondary-button small" disabled={pageNumber <= 1} onClick={() => setPageNumber((current) => current - 1)}>Previous</button><span>Page {pageNumber} of {Math.ceil(total / 50)}</span><button className="secondary-button small" disabled={!hasMore} onClick={() => setPageNumber((current) => current + 1)}>Next</button></div>}
  </div>;
}

function LocationPage({ user, token, selectedSeniorId, refreshKey, notify }) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [fences, setFences] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const query = selectedSeniorId ? `?seniorId=${encodeURIComponent(selectedSeniorId)}` : '';
    setLoading(true);
    Promise.all([request(`/locations${query}`, token), request(`/geofences${query}`, token)])
      .then(([locations, geofences]) => {
        setItems(locations.items || []);
        setFences((geofences.items || []).filter((item) => item.status === 'active'));
        setError('');
      }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [token, selectedSeniorId, refreshKey]);
  function shareLocation() {
    if (!navigator.geolocation) return setError('Location sharing is not supported by this browser.');
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const point = { latitude: Number(coords.latitude.toFixed(6)), longitude: Number(coords.longitude.toFixed(6)), accuracyMeters: Math.round(coords.accuracy), source: 'browser' };
      setPosition(point);
      try {
        await request('/locations', token, { method: 'POST', body: JSON.stringify({ seniorId: selectedSeniorId || undefined, data: point }) });
        setError('');
        notify('Location shared with your authorized care circle.');
        request(`/locations${selectedSeniorId ? `?seniorId=${encodeURIComponent(selectedSeniorId)}` : ''}`, token).then((data) => setItems(data.items || []));
      } catch (e) { setError(e.message); }
      finally { setBusy(false); }
    }, (e) => { setError(e.code === 1 ? 'Location permission was denied. Allow location access to share your position.' : 'Could not get your current location. Please try again.'); setBusy(false); }, { enableHighAccuracy: true, timeout: 15000 });
  }
  return <div className="resource-page"><div className="resource-heading"><div><div className="eyebrow"><span /> LOCATION SAFETY</div><h1>Location & safety</h1><p>Location is only shared when you choose to share it.</p></div>{user.role !== 'family' && <button className="primary-button" onClick={shareLocation} disabled={busy}><MapPin size={16} />{busy ? 'Getting location…' : 'Share my location'}</button>}</div>
    {error && <div className="form-error resource-error">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    <div className="location-layout"><section className="panel location-map"><div className="map-art"><div className="map-grid" /><div className="map-road road-a" /><div className="map-road road-b" /><div className="map-road road-c" /><div className="map-zone"><span className="zone-ring" /><span className="zone-point"><MapPin size={19} /></span></div><span className="map-tag">{position ? 'Your current location' : 'Location preview'}</span></div><div className="location-detail"><div><strong>{position ? `${position.latitude}, ${position.longitude}` : 'No location shared yet'}</strong><span>{position ? `Accuracy ±${position.accuracyMeters} m · just now` : 'Share your location to see it here'}</span></div>{position && <a href={`https://maps.google.com/?q=${position.latitude},${position.longitude}`} target="_blank" rel="noreferrer">Open map <ArrowUpRight size={13} /></a>}</div></section>
      <section className="panel safety-panel"><div className="panel-heading"><div><h2>Safe zone</h2><p>Geofence boundary status</p></div><div className="safe-status"><span className={!loading && !fences.length ? 'offline' : ''} />{loading ? 'Checking' : fences.length ? 'Monitoring' : 'Not configured'}</div></div><div className="safety-illustration"><div className="safe-ring"><div><Shield size={24} /></div></div></div><h3>{loading ? 'Loading safe zones…' : fences.length ? `${fences.length} active safe zone${fences.length === 1 ? '' : 's'}` : 'No safe zone set up'}</h3><p>Geofence alerts are generated when a shared location falls outside an active safe-zone radius.</p><button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent('navigate-care', { detail: 'geofences' }))}>Manage safe zones <ArrowUpRight size={14} /></button></section></div>
    <div className="panel location-history"><div className="panel-heading"><div><h2>Recent location updates</h2><p>Only visible to your authorized care circle</p></div><span className="privacy-chip"><Shield size={13} /> Private</span></div>{loading ? <div className="inline-empty">Loading location history…</div> : items.length ? items.slice(0, 5).map((item) => <div className="location-row" key={item._id}><div className="today-icon location"><MapPin size={16} /></div><div><strong>{item.data.latitude}, {item.data.longitude}</strong><span>Accuracy ±{item.data.accuracyMeters || '?'} m</span></div><time>{timeAgo(item.createdAt)}</time></div>) : <div className="inline-empty">There are no location updates yet.</div>}</div></div>;
}

function ReportsPage({ token, user, selectedSeniorId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    setLoading(true);
    request(`/reports/summary${selectedSeniorId ? `?seniorId=${encodeURIComponent(selectedSeniorId)}` : ''}`, token)
      .then((result) => { setData(result); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, selectedSeniorId, retry]);
  async function exportReport() {
    setExporting(true);
    try {
      const query = selectedSeniorId ? `?seniorId=${encodeURIComponent(selectedSeniorId)}` : '';
      const response = await fetch(`${API}/reports/export.csv${query}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Could not download this report.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'carecircle-report.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
    finally { setExporting(false); }
  }
  return <div className="resource-page"><div className="resource-heading"><div><div className="eyebrow"><span /> CARE INSIGHTS</div><h1>Weekly reports</h1><p>A simple view of activity from the last seven days.</p></div><div className="report-actions"><span className="period-chip"><CalendarDays size={15} />Last 7 days</span><button className="primary-button" onClick={exportReport} disabled={exporting || !selectedSeniorId}>{exporting ? 'Preparing…' : 'Export CSV'}</button></div></div>{error && <div className="form-error resource-error">{error}<button onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}<div className="report-summary-grid">{['alerts', 'medications', 'medicationEvents', 'vitals', 'tasks', 'appointments', 'checkins'].map((key) => { const row = data?.totals?.[key]; return <div className="panel report-stat" key={key}><span>{humanize(key)}</span><strong>{loading ? '…' : row?.total ?? 0}</strong><div className="report-track"><i style={{ width: `${row?.total ? Math.max(12, Math.round(row.completed / row.total * 100)) : 0}%` }} /></div><small>{loading ? 'Loading report…' : `${row?.completed ?? 0} completed / recorded`}</small></div>; })}</div><div className="panel report-note"><div className="banner-icon"><Activity size={19} /></div><div><strong>Built from your care records</strong><p>Reports reflect information recorded by your care circle. They are not a medical diagnosis. Data is restricted to authorized members.</p></div></div></div>;
}

function CheckinsPage({ token, user, selectedSeniorId, notify }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    request(`/checkins${selectedSeniorId ? `?seniorId=${encodeURIComponent(selectedSeniorId)}` : ''}`, token)
      .then((data) => { setItems(data.items || []); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, selectedSeniorId]);
  async function plan(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    setBusy(true);
    try {
      await request('/checkins', token, { method: 'POST', body: JSON.stringify({ seniorId: selectedSeniorId || undefined, data: { title: form.title, scheduledAt: form.scheduledAt, method: 'video' }, status: 'scheduled' }) });
      const result = await request(`/checkins${selectedSeniorId ? `?seniorId=${encodeURIComponent(selectedSeniorId)}` : ''}`, token);
      setItems(result.items || []);
      event.currentTarget.reset();
      notify('Video check-in added to your care schedule.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="resource-page">
    <div className="resource-heading"><div><div className="eyebrow"><span /> STAY CONNECTED</div><h1>Video check-ins</h1><p>Make time for a face-to-face moment with your care circle.</p></div></div>
    {error && <div className="form-error resource-error">{error}</div>}
    <div className="checkin-layout">
      <form className="panel checkin-form" onSubmit={plan}>
        <div className="video-placeholder"><div className="video-circle"><Video size={25} /></div><span>YOUR NEXT HELLO</span><strong>Make a moment together</strong><p>Schedule a video check-in and let your care circle know when you’ll connect.</p></div>
        <label>Check-in title<input name="title" placeholder="e.g. Sunday catch-up" required maxLength="100" /></label>
        <label>Date and time<input name="scheduledAt" type="datetime-local" required min={new Date().toISOString().slice(0, 16)} /></label>
        <button className="primary-button full-button" disabled={busy}>{busy ? 'Saving…' : 'Schedule check-in'}<ArrowUpRight size={15} /></button>
      </form>
      <section className="panel checkin-list"><div className="panel-heading"><div><h2>Scheduled check-ins</h2><p>Planned moments together</p></div><span className="count-badge">{loading ? '…' : items.length}</span></div>{loading ? <div className="inline-empty">Loading your check-ins…</div> : items.length ? items.map((item) => <div className="checkin-row" key={item._id}><div className="checkin-calendar"><span>{item.data?.scheduledAt ? new Date(item.data.scheduledAt).toLocaleString(undefined, { month: 'short' }) : 'Care'}</span><strong>{item.data?.scheduledAt ? new Date(item.data.scheduledAt).getDate() : '•'}</strong></div><div><strong>{item.data?.title || 'Video check-in'}</strong><span>{item.data?.scheduledAt ? new Date(item.data.scheduledAt).toLocaleString() : 'Time to be arranged'}</span></div><span className={`status-pill status-${item.status}`}>{humanize(item.status)}</span></div>) : <div className="inline-empty">No check-ins scheduled. Plan a hello to get started.</div>}</section>
    </div>
    {selectedSeniorId && <VideoCallPanel token={token} user={user} seniorId={selectedSeniorId} />}
  </div>;
}

function OrganizationPage({ token, notify }) {
  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    request('/organization', token)
      .then((result) => { setOrganization(result.organization); setSetup(false); setError(''); })
      .catch((e) => {
        if (e.message.includes('Set up your organization')) { setSetup(true); setError(''); }
        else setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [token]);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const details = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await request(setup ? '/organization' : '/organization', token, {
        method: setup ? 'POST' : 'PATCH',
        body: JSON.stringify(details),
      });
      setOrganization(result.organization);
      setSetup(false);
      notify(setup ? 'Organization created.' : 'Organization settings saved.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (loading) return <div className="panel loading-panel"><div className="loader" />Loading organization settings…</div>;
  return <div className="resource-page"><div className="resource-heading"><div><div className="eyebrow"><span /> AGENCY ADMINISTRATION</div><h1>Organization</h1><p>Manage your agency profile and default billing currency.</p></div></div>{error && <div className="form-error resource-error">{error}<button onClick={() => setError('')}>Dismiss</button></div>}<form className="panel organization-form" onSubmit={save}><h2>{setup ? 'Set up your organization' : 'Organization settings'}</h2><p className="organization-note">{setup ? 'Create an agency workspace. This does not automatically grant access to senior health records.' : 'Only this organization’s owner can edit its details.'}</p><div className="form-grid"><label>Organization name<input name="name" required minLength="2" maxLength="160" defaultValue={organization?.name || ''} /></label><label>Contact email<input name="contactEmail" type="email" defaultValue={organization?.contactEmail || ''} /></label><label>Address<input name="address" maxLength="250" defaultValue={organization?.address || ''} /></label><label>Billing currency<select name="currency" defaultValue={organization?.currency || 'USD'}><option>USD</option><option>CAD</option><option>GBP</option><option>EUR</option><option>AUD</option></select></label></div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : setup ? 'Create organization' : 'Save changes'}</button></div></form><div className="panel organization-note-card"><div className="banner-icon"><Shield size={18} /></div><div><strong>Care data stays permission-scoped</strong><p>Organization membership provides team workspace access only. Senior health information still requires an approved care-circle relationship.</p></div></div></div>;
}

function TeamPage({ token, user, notify, refreshKey, onUpdate }) {
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const isAdmin = user.role === 'admin';
  useEffect(() => {
    setLoading(true);
    const path = isAdmin ? '/organizations/members' : '/organizations/invitations/mine';
    request(path, token)
      .then((result) => {
        setMembers(result.members || []);
        setInvitations(isAdmin ? result.invitations || [] : result.invitations || []);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, isAdmin, refreshKey, retry]);
  async function invite(event) {
    event.preventDefault();
    setBusy(true);
    const email = new FormData(event.currentTarget).get('email');
    try {
      const result = await request('/organizations/invitations', token, { method: 'POST', body: JSON.stringify({ email }) });
      notify(result.message);
      event.currentTarget.reset();
      onUpdate();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function actOnInvitation(invite, action) {
    try {
      const result = await request(`/organizations/invitations/${invite.id}/${action}`, token, { method: 'POST', body: '{}' });
      notify(result.message);
      onUpdate();
    } catch (e) { setError(e.message); }
  }
  async function removeMember(member) {
    if (!window.confirm(`Remove ${member.name} from this organization?`)) return;
    try {
      const result = await request(`/organizations/members/${member.id}`, token, { method: 'DELETE' });
      notify(result.message);
      onUpdate();
    } catch (e) { setError(e.message); }
  }
  return <div className="resource-page"><div className="resource-heading"><div><div className="eyebrow"><span /> CARE TEAM ACCESS</div><h1>{isAdmin ? 'Team access' : 'Organization invitations'}</h1><p>{isAdmin ? 'Invite registered staff into your agency workspace.' : 'Review pending invitations to join a care organization.'}</p></div></div>{error && <div className="form-error resource-error">{error}<button onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
    {isAdmin && <form className="panel invite-form" onSubmit={invite}><div className="link-senior-icon"><Users size={18} /></div><div className="link-senior-copy"><strong>Invite a registered caregiver or family member</strong><span>They need an existing account. This invitation is delivered in-app.</span></div><input name="email" type="email" required placeholder="Email address" aria-label="Invitee email address" /><button className="primary-button" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</button></form>}
    {loading ? <div className="panel loading-panel"><div className="loader" />Loading team access…</div> : isAdmin ? <div className="team-list">{members.map((member) => <article className="panel team-row" key={member.id}><div className="top-avatar">{member.name.slice(0, 1).toUpperCase()}</div><div className="team-member-copy"><strong>{member.name}</strong><span>{member.email} · {roleName(member.role)}</span></div><span className="status-pill status-completed">Member</span>{member.role !== 'admin' && <button className="secondary-button small" onClick={() => removeMember(member)}>Remove</button>}</article>)}{invitations.map((invite) => <article className="panel team-row" key={invite.id}><div className="top-avatar">…</div><div className="team-member-copy"><strong>{invite.email}</strong><span>Invitation sent · {timeAgo(invite.createdAt)}</span></div><span className="status-pill status-pending">Pending</span></article>)}{!members.length && !invitations.length && <div className="panel resource-empty"><h3>No team members yet</h3><p>Send an in-app invitation to a registered caregiver or family member.</p></div>}</div> : invitations.length ? <div className="team-list">{invitations.map((invite) => <article className="panel team-row" key={invite.id}><div className="link-senior-icon"><Users size={18} /></div><div className="team-member-copy"><strong>{invite.organizationName}</strong><span>Invitation for {invite.email}</span></div><button className="primary-button" onClick={() => actOnInvitation(invite, 'accept')}>Accept</button><button className="secondary-button small" onClick={() => actOnInvitation(invite, 'decline')}>Decline</button></article>)}</div> : <div className="panel resource-empty"><div className="empty-icon"><Shield size={20} /></div><h3>No pending invitations</h3><p>When an organization invites your account, you can review it here.</p></div>}
  </div>;
}

function NotificationPreferencesPage({ token, preferences, onChange, notify }) {
  const [values, setValues] = useState(preferences || { alerts: true, medicationReminders: true, careUpdates: true, invitations: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (preferences) setValues(preferences); }, [preferences]);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await request('/notification-preferences', token, { method: 'PATCH', body: JSON.stringify(values) });
      onChange(result.preferences);
      notify('Notification preferences saved.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const options = [
    ['alerts', 'Safety and care alerts', 'Fall, inactivity, and geofence alerts.'],
    ['medicationReminders', 'Medication reminders', 'In-app reminders for scheduled medications.'],
    ['careUpdates', 'Care-circle activity', 'Updates when an approved care member records care activity.'],
    ['invitations', 'Organization invitations', 'In-app invitations to join an agency team.'],
  ];
  return <div className="resource-page"><div className="resource-heading"><div><div className="eyebrow"><span /> YOUR PREFERENCES</div><h1>Notification settings</h1><p>Manage real-time updates shown in this browser.</p></div></div>{error && <div className="form-error resource-error">{error}</div>}<form className="panel preference-form" onSubmit={save}>{options.map(([key, label, description]) => <label className="preference-row" key={key}><div><strong>{label}</strong><span>{description}</span></div><input type="checkbox" checked={Boolean(values[key])} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.checked }))} /></label>)}<div className="preference-footnote"><Shield size={14} /> These settings control in-app toasts only. External email, SMS, and push delivery are not configured.</div><div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save preferences'}</button></div></form></div>;
}

function VideoCallPanel({ token, user, seniorId }) {
  const [participants, setParticipants] = useState([]);
  const [peerId, setPeerId] = useState('');
  const [callState, setCallState] = useState('idle');
  const [signalingConnected, setSignalingConnected] = useState(false);
  const [callId, setCallId] = useState('');
  const [remoteName, setRemoteName] = useState('');
  const [participantsLoading, setParticipantsLoading] = useState(true);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [localPreviewReady, setLocalPreviewReady] = useState(false);
  const [remoteVideoReady, setRemoteVideoReady] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef(null);
  const connectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const callRef = useRef(null);
  const iceServersRef = useRef(null);
  const queuedCandidates = useRef([]);
  const timersRef = useRef({ ring: null, connection: null, disconnected: null });
  const restartAttemptedRef = useRef(false);

  async function loadIceServers() {
    if (!iceServersRef.current) {
      const result = await request('/video/ice-servers', token);
      if (!Array.isArray(result.iceServers) || !result.iceServers.length) {
        throw new Error('The call service did not return any ICE servers.');
      }
      iceServersRef.current = result.iceServers;
    }
    return iceServersRef.current;
  }

  useEffect(() => {
    let cancelled = false;
    setParticipantsLoading(true);
    request(`/people?seniorId=${encodeURIComponent(seniorId)}`, token).then((result) => {
      const available = (result.people || []).filter((person) => person.id !== user.id);
      if (cancelled) return;
      setParticipants(available);
      setPeerId((selected) => available.some((person) => person.id === selected) ? selected : available[0]?.id || '');
    }).catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setParticipantsLoading(false); });
    return () => { cancelled = true; };
  }, [token, user.id, seniorId]);

  useEffect(() => {
    const socket = io(SOCKET, { auth: { token } });
    socketRef.current = socket;
    let disposed = false;

    function setStatus(next) {
      if (disposed) return;
      setCallState(next);
    }

    function clearTimer(name) {
      window.clearTimeout(timersRef.current[name]);
      timersRef.current[name] = null;
    }

    function stopMedia() {
      connectionRef.current?.close();
      connectionRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      if (!disposed) {
        setLocalPreviewReady(false);
        setRemoteVideoReady(false);
      }
      queuedCandidates.current = [];
      restartAttemptedRef.current = false;
      clearTimer('connection');
      clearTimer('disconnected');
    }

    function sendSignal(call, signal) {
      const activeSocket = socketRef.current;
      if (!activeSocket?.connected) return;
      activeSocket.emit('video:signal', { callId: call.callId, signal }, (result) => {
        if (!result?.ok && callRef.current?.callId === call.callId) setError(result?.error || 'Could not send call media information.');
      });
    }

    function clearCall(nextState, message = '') {
      clearTimer('ring');
      clearTimer('connection');
      clearTimer('disconnected');
      stopMedia();
      callRef.current = null;
      if (!disposed) {
        setCallId('');
        setStatus(nextState);
        setMicrophoneEnabled(true);
        setCameraEnabled(true);
        if (message) setError(message);
      }
    }

    async function endCall(nextState = 'ended', message = '', notifyPeer = true) {
      const currentCall = callRef.current;
      if (!currentCall) {
        if (!disposed) setStatus(nextState);
        return;
      }
      callRef.current = null;
      if (notifyPeer && socket.connected) socket.emit('video:end', { callId: currentCall.callId }, () => {});
      clearCall(nextState, message);
    }

    async function acquireMedia() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera and microphone access requires HTTPS or localhost in this browser.');
      }
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch (mediaError) {
        if (mediaError.name === 'NotAllowedError' || mediaError.name === 'PermissionDeniedError') {
          throw new Error('Camera or microphone access was denied. Allow both permissions in your browser and try again.');
        }
        if (mediaError.name === 'NotFoundError' || mediaError.name === 'DevicesNotFoundError') {
          throw new Error('No camera or microphone was found. Connect a device and try again.');
        }
        throw new Error(mediaError.message || 'Could not access the camera and microphone.');
      }
    }

    async function flushCandidates(connection) {
      if (!connection.remoteDescription) return;
      for (const candidate of queuedCandidates.current.splice(0)) {
        await connection.addIceCandidate(candidate);
      }
    }

    async function restartIce(call, connection) {
      if (restartAttemptedRef.current || !socket.connected || callRef.current?.callId !== call.callId) return;
      restartAttemptedRef.current = true;
      try {
        setStatus('reconnecting');
        connection.restartIce();
        const offer = await connection.createOffer({ iceRestart: true });
        await connection.setLocalDescription(offer);
        sendSignal(call, { type: 'offer', description: connection.localDescription.toJSON() });
        clearTimer('disconnected');
        timersRef.current.disconnected = window.setTimeout(() => {
          if (callRef.current?.callId === call.callId && connection.connectionState !== 'connected') {
            void endCall('failed', 'The call could not reconnect. Check the network and try again.');
          }
        }, 12000);
      } catch (restartError) {
        void endCall('failed', restartError.message || 'The call could not reconnect. Try again.');
      }
    }

    function createConnection(call, stream, iceServers) {
      if (connectionRef.current) return connectionRef.current;
      const connection = new RTCPeerConnection({ iceServers });
      connectionRef.current = connection;
      stream.getTracks().forEach((track) => connection.addTrack(track, stream));
      connection.ontrack = (event) => {
        const remoteStream = event.streams[0] || remoteStreamRef.current || new MediaStream();
        if (!event.streams[0] && !remoteStream.getTracks().some((track) => track.id === event.track.id)) remoteStream.addTrack(event.track);
        remoteStreamRef.current = remoteStream;
        if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStream) {
          remoteVideoRef.current.srcObject = remoteStream;
          setRemoteVideoReady(true);
          remoteVideoRef.current.play().catch(() => setError('The browser blocked remote playback. Use the video play control to start audio and video.'));
        }
      };
      connection.onicecandidate = ({ candidate }) => {
        if (candidate && callRef.current?.callId === call.callId) {
          sendSignal(call, { type: 'candidate', candidate: candidate.toJSON() });
        }
      };
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'connected') {
          clearTimer('connection');
          clearTimer('disconnected');
          restartAttemptedRef.current = false;
          setStatus('connected');
          setError('');
        } else if (connection.connectionState === 'connecting') {
          setStatus('connecting');
        } else if (connection.connectionState === 'disconnected') {
          setStatus('reconnecting');
          clearTimer('disconnected');
          timersRef.current.disconnected = window.setTimeout(() => {
            if (connection.connectionState === 'disconnected') void restartIce(call, connection);
          }, 5000);
        } else if (connection.connectionState === 'failed') {
          void restartIce(call, connection);
        }
      };
      return connection;
    }

    async function handleSignal({ callId: incomingCallId, from, signal }) {
      const call = callRef.current;
      if (!call || call.callId !== incomingCallId || call.peerId !== from) return;
      try {
        if (signal.type === 'offer') {
          const stream = localStreamRef.current || await acquireMedia();
          localStreamRef.current = stream;
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;
          setLocalPreviewReady(true);
          const connection = createConnection(call, stream, await loadIceServers());
          await connection.setRemoteDescription(signal.description);
          await flushCandidates(connection);
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          sendSignal(call, { type: 'answer', description: connection.localDescription.toJSON() });
          setStatus('connecting');
        } else if (signal.type === 'candidate') {
          if (connectionRef.current?.remoteDescription) await connectionRef.current.addIceCandidate(signal.candidate);
          else queuedCandidates.current.push(signal.candidate);
        } else if (signal.type === 'answer' && connectionRef.current) {
          await connectionRef.current.setRemoteDescription(signal.description);
          await flushCandidates(connectionRef.current);
          setStatus('connecting');
        }
      } catch (signalError) {
        await endCall('failed', signalError.message || 'Could not establish the video call.');
      }
    }

    socket.on('connect', () => {
      if (!disposed) setSignalingConnected(true);
      if (callRef.current && callStateRef.current === 'reconnecting') {
        void endCall('failed', 'The signaling connection was restored, but the call session expired. Start a new call.');
      }
      setError('');
    });
    socket.on('connect_error', () => {
      if (!disposed) setError('Could not connect to the secure call signaling service. Check your connection and sign in again.');
    });
    socket.on('disconnect', () => {
      if (!disposed) setSignalingConnected(false);
      if (callRef.current) {
        setStatus('reconnecting');
        clearTimer('disconnected');
        timersRef.current.disconnected = window.setTimeout(() => {
          if (callRef.current) void endCall('failed', 'The signaling connection was lost. Start a new call when you are back online.', false);
        }, 8000);
      }
    });
    socket.on('video:incoming', (invitation) => {
      if (String(invitation.seniorId) !== String(seniorId)) return;
      if (callRef.current || callStateRef.current === 'connecting' || callStateRef.current === 'connected') {
        socket.emit('video:reject', { callId: invitation.callId }, () => {});
        return;
      }
      callRef.current = { callId: invitation.callId, peerId: invitation.from, role: 'callee' };
      setCallId(invitation.callId);
      setPeerId(invitation.from);
      setRemoteName(invitation.name || 'Care-circle member');
      setError('');
      setStatus('incoming');
      clearTimer('ring');
      timersRef.current.ring = window.setTimeout(() => {
        if (callRef.current?.callId === invitation.callId) {
          socket.emit('video:reject', { callId: invitation.callId }, () => {});
          clearCall('ended', 'The incoming call expired before it was answered.');
        }
      }, 40000);
    });
    socket.on('video:accepted', async ({ callId: acceptedCallId, from }) => {
      const call = callRef.current;
      if (!call || call.callId !== acceptedCallId || call.role !== 'caller' || call.peerId !== from) return;
      clearTimer('ring');
      try {
        const stream = await acquireMedia();
        if (callRef.current?.callId !== call.callId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        setLocalPreviewReady(true);
        const connection = createConnection(call, stream, await loadIceServers());
        setStatus('connecting');
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        sendSignal(call, { type: 'offer', description: connection.localDescription.toJSON() });
        clearTimer('connection');
        timersRef.current.connection = window.setTimeout(() => {
          if (callRef.current?.callId === call.callId && connection.connectionState !== 'connected') {
            void endCall('failed', 'The other device did not establish audio/video. Check camera, microphone, and network permissions.');
          }
        }, 30000);
      } catch (mediaError) {
        await endCall('failed', mediaError.message || 'Could not start your camera and microphone.');
      }
    });
    socket.on('video:rejected', ({ callId: rejectedCallId }) => {
      if (callRef.current?.callId === rejectedCallId) clearCall('ended', 'The other person declined the call.');
    });
    socket.on('video:ended', ({ callId: endedCallId, reason }) => {
      if (callRef.current?.callId !== endedCallId) return;
      const message = reason === 'timeout' ? 'The call invitation expired because there was no answer.'
        : reason === 'disconnected' ? 'The other person disconnected from the call.'
          : '';
      clearCall(reason === 'disconnected' ? 'failed' : 'ended', message);
    });
    socket.on('video:signal', handleSignal);
    socket.on('video:error', ({ message }) => setError(message || 'The call signaling service reported an error.'));

    return () => {
      disposed = true;
      const currentCall = callRef.current;
      if (currentCall && socket.connected) socket.emit('video:end', { callId: currentCall.callId }, () => {});
      clearTimer('ring');
      clearTimer('connection');
      clearTimer('disconnected');
      stopMedia();
      callRef.current = null;
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [token, seniorId, user.id]);

  const callStateRef = useRef(callState);
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  async function startCall() {
    if (callRef.current || !peerId) {
      if (!peerId) setError('Choose an approved care-circle member to call.');
      return;
    }
    const participant = participants.find((person) => person.id === peerId);
    const nextCallId = globalThis.crypto?.randomUUID?.()
      || [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map((value) => value.toString(16).padStart(2, '0')).join('');
    const uniqueCallId = nextCallId.length === 32
      ? `${nextCallId.slice(0, 8)}-${nextCallId.slice(8, 12)}-4${nextCallId.slice(13, 16)}-8${nextCallId.slice(17, 20)}-${nextCallId.slice(20)}`
      : nextCallId;
    const currentCall = { callId: uniqueCallId, peerId, role: 'caller' };
    callRef.current = currentCall;
    setCallId(uniqueCallId);
    setRemoteName(participant?.name || 'Care-circle member');
    setError('');
    setCallState('calling');
    try {
      await new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket?.connected) return reject(new Error('Call signaling is offline. Wait for the connection and try again.'));
        socket.timeout(7000).emit('video:invite', { callId: uniqueCallId, seniorId, targetUserId: peerId }, (timeoutError, result) => {
          if (timeoutError) return reject(new Error('The signaling server did not respond. Please try again.'));
          if (!result?.ok) return reject(new Error(result?.error || 'Could not invite this person.'));
          resolve(result);
        });
      });
      if (callRef.current?.callId !== uniqueCallId) return;
      timersRef.current.ring = window.setTimeout(() => {
        if (callRef.current?.callId === uniqueCallId && callStateRef.current === 'calling') {
          socketRef.current?.emit('video:end', { callId: uniqueCallId }, () => {});
          callRef.current = null;
          setCallId('');
          setCallState('ended');
          setError('The call invitation expired because there was no answer.');
        }
      }, 40000);
    } catch (callError) {
      callRef.current = null;
      setCallId('');
      setCallState('failed');
      setError(callError.message);
    }
  }

  async function acceptCall() {
    const currentCall = callRef.current;
    if (!currentCall || currentCall.role !== 'callee' || callState !== 'incoming') return;
    setError('');
    try {
      const stream = await (async () => {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone access requires HTTPS or localhost in this browser.');
        try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); }
        catch (mediaError) {
          if (mediaError.name === 'NotAllowedError' || mediaError.name === 'PermissionDeniedError') throw new Error('Camera or microphone access was denied. Allow both permissions and then accept the call again.');
          if (mediaError.name === 'NotFoundError' || mediaError.name === 'DevicesNotFoundError') throw new Error('No camera or microphone was found. Connect a device and try again.');
          throw new Error(mediaError.message || 'Could not access the camera and microphone.');
        }
      })();
      if (callRef.current?.callId !== currentCall.callId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setLocalPreviewReady(true);
      await new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket?.connected) return reject(new Error('Call signaling is offline. Reconnect before accepting.'));
        socket.timeout(7000).emit('video:accept', { callId: currentCall.callId }, (timeoutError, result) => {
          if (timeoutError) return reject(new Error('The signaling server did not respond. Please try again.'));
          if (!result?.ok) return reject(new Error(result?.error || 'This call is no longer available.'));
          resolve(result);
        });
      });
      setCallState('connecting');
      timersRef.current.connection = window.setTimeout(() => {
        if (callRef.current?.callId === currentCall.callId && connectionRef.current?.connectionState !== 'connected') {
          void finishCall('failed', 'The other device did not establish audio/video. Check camera, microphone, and network permissions.');
        }
      }, 30000);
    } catch (acceptError) {
      socketRef.current?.emit('video:reject', { callId: currentCall.callId }, () => {});
      callRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setCallId('');
      setCallState('failed');
      setError(acceptError.message);
    }
  }

  function rejectCall() {
    const currentCall = callRef.current;
    if (currentCall) socketRef.current?.emit('video:reject', { callId: currentCall.callId }, () => {});
    callRef.current = null;
    setCallId('');
    setCallState('ended');
    setError('You declined the incoming call.');
  }

  function finishCall(nextState = 'ended', message = '') {
    const currentCall = callRef.current;
    if (currentCall) socketRef.current?.emit('video:end', { callId: currentCall.callId }, () => {});
    callRef.current = null;
    clearTimeout(timersRef.current.ring);
    clearTimeout(timersRef.current.connection);
    clearTimeout(timersRef.current.disconnected);
    connectionRef.current?.close();
    connectionRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setLocalPreviewReady(false);
    setRemoteVideoReady(false);
    queuedCandidates.current = [];
    restartAttemptedRef.current = false;
    setCallId('');
    setCallState(nextState);
    setMicrophoneEnabled(true);
    setCameraEnabled(true);
    setError(message);
  }

  function toggleMicrophone() {
    const tracks = localStreamRef.current?.getAudioTracks() || [];
    if (!tracks.length) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach((track) => { track.enabled = enabled; });
    setMicrophoneEnabled(enabled);
  }

  function toggleCamera() {
    const tracks = localStreamRef.current?.getVideoTracks() || [];
    if (!tracks.length) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach((track) => { track.enabled = enabled; });
    setCameraEnabled(enabled);
  }

  return <section className="panel video-call-panel">
    <div className="panel-heading"><div><h2>Video check-in</h2><p>Private browser-to-browser audio and video</p></div><div className="video-status-group"><span className={`signaling-indicator ${signalingConnected ? 'is-connected' : ''}`}>{signalingConnected ? 'Call service connected' : 'Connecting to call service…'}</span><span className={`status-pill status-${callState === 'connected' ? 'completed' : ['failed', 'ended'].includes(callState) ? 'cancelled' : 'scheduled'}`}>{callState === 'calling' ? 'Calling…' : callState === 'incoming' ? 'Incoming call…' : callState === 'connecting' ? 'Connecting…' : callState === 'reconnecting' ? 'Reconnecting…' : callState === 'connected' ? 'Connected' : callState === 'failed' ? 'Connection failed' : callState === 'ended' ? 'Call ended' : 'Idle'}</span></div></div>
    <div className="video-call-grid">
      <div className={`video-feed ${remoteVideoReady ? 'has-video' : ''}`}><video ref={remoteVideoRef} autoPlay playsInline controls /><span>{callState === 'connected' ? remoteName || 'Care-circle member' : callState === 'incoming' ? `${remoteName || 'Care-circle member'} is calling` : callState === 'calling' ? `Calling ${remoteName || 'care-circle member'}…` : callState === 'connecting' || callState === 'reconnecting' ? `${remoteName || 'Care-circle member'} · ${callState === 'reconnecting' ? 'Reconnecting media…' : 'Connecting media…'}` : callState === 'failed' ? 'Connection failed' : callState === 'ended' ? 'Call ended' : 'Your remote video will appear here'}</span></div>
      <div className={`video-feed local-feed ${localPreviewReady ? 'has-video' : ''}`}><video ref={localVideoRef} autoPlay muted playsInline /><span>{localPreviewReady ? 'You' : 'Your camera preview'}</span></div>
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="video-call-actions"><label>Call someone in your care circle<select value={peerId} onChange={(event) => setPeerId(event.target.value)} disabled={Boolean(callRef.current)}><option value="">{participantsLoading ? 'Loading people…' : 'Choose a person'}</option>{participants.map((person) => <option key={person.id} value={person.id}>{person.name} · {roleName(person.role)}</option>)}</select></label>
      {callState === 'incoming' ? <div className="video-call-buttons"><button className="primary-button" onClick={acceptCall}><Video size={16} />Accept call</button><button className="secondary-button" onClick={rejectCall}><PhoneOff size={16} />Decline</button></div>
        : ['idle', 'ended', 'failed'].includes(callState) ? <button className="primary-button" onClick={startCall} disabled={!peerId || participantsLoading || !participants.length}><Video size={16} />Start call</button>
          : <div className="video-call-buttons">{localStreamRef.current && <><button className="secondary-button" onClick={toggleMicrophone} aria-label={microphoneEnabled ? 'Mute microphone' : 'Unmute microphone'}>{microphoneEnabled ? <Mic size={16} /> : <MicOff size={16} />}{microphoneEnabled ? 'Mute' : 'Unmute'}</button><button className="secondary-button" onClick={toggleCamera} aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}>{cameraEnabled ? <Video size={16} /> : <VideoOff size={16} />}{cameraEnabled ? 'Camera off' : 'Camera on'}</button></>}<button className="secondary-button end-call-button" onClick={() => finishCall()}><PhoneOff size={16} />End call</button></div>}
    </div>
    {!participantsLoading && !participants.length && <div className="provider-note"><Users size={14} /> No approved care-circle members are available to call for this senior.</div>}
    <div className="provider-note"><Shield size={14} /> Audio and video are exchanged peer-to-peer and are not stored. A TURN relay may be required on restrictive networks; configure TURN_URLS and TURN_SHARED_SECRET on the API server for short-lived credentials.</div>
  </section>;
}

function fieldsFor(resource, careTeam = []) {
  const select = (name, label, options, required = true) => ({ name, label, type: 'select', options, required });
  if (resource === 'alerts') return [{ name: 'message', label: 'What happened?', required: true, placeholder: 'Describe the alert' }, select('type', 'Alert type', [{ value: 'fall', label: 'Fall detection' }, { value: 'inactivity', label: 'Inactivity' }, { value: 'general', label: 'General care alert' }]), select('severity', 'Severity', [{ value: 'warning', label: 'Needs attention' }, { value: 'critical', label: 'Urgent' }])];
  if (resource === 'medications') return [{ name: 'name', label: 'Medication name', required: true }, { name: 'dose', label: 'Dose / instructions', required: true }, { name: 'schedule', label: 'Schedule', required: true, placeholder: 'e.g. Daily' }, { name: 'reminderTime', label: 'Daily reminder time', type: 'time', required: true }, { name: 'prescriber', label: 'Prescriber (optional)', required: false }];
  if (resource === 'medicationEvents') return [{ name: 'name', label: 'Medication', required: true }, select('type', 'Medication status', [{ value: 'taken', label: 'Taken' }, { value: 'missed', label: 'Missed' }, { value: 'skipped', label: 'Skipped' }]), { name: 'notes', label: 'Notes (optional)', required: false }];
  if (resource === 'tasks') return [{ name: 'title', label: 'Task', required: true }, { name: 'description', label: 'Details (optional)', required: false }, { name: 'dueAt', label: 'Due date and time', type: 'datetime-local', required: false }, select('priority', 'Priority', [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }]), select('assignedTo', 'Assign caregiver (optional)', [{ value: '', label: 'Unassigned' }, ...careTeam.filter((person) => person.role === 'caregiver').map((person) => ({ value: person.id, label: person.name }))], false)];
  if (resource === 'shifts') return [{ name: 'caregiver', label: 'Caregiver name', required: true }, { name: 'startsAt', label: 'Shift starts', type: 'datetime-local', required: true }, { name: 'endsAt', label: 'Shift ends', type: 'datetime-local', required: true }, { name: 'notes', label: 'Notes (optional)', required: false }];
  if (resource === 'geofences') return [{ name: 'name', label: 'Safe zone name', required: true }, { name: 'latitude', label: 'Center latitude', type: 'number', required: true }, { name: 'longitude', label: 'Center longitude', type: 'number', required: true }, { name: 'radiusMeters', label: 'Radius in meters', type: 'number', required: true }];
  if (resource === 'notifications') return [{ name: 'message', label: 'Notification message', required: true }, select('type', 'Type', [{ value: 'reminder', label: 'Reminder' }, { value: 'update', label: 'Care update' }])];
  if (resource === 'contacts') return [{ name: 'name', label: 'Contact name', required: true }, { name: 'phone', label: 'Phone number', required: true }, { name: 'relationship', label: 'Relationship', required: false }];
  if (resource === 'organizations') return [{ name: 'name', label: 'Organization name', required: true }, { name: 'address', label: 'Address', required: false }, { name: 'contactEmail', label: 'Contact email', type: 'email', required: false }];
  if (resource === 'invoices') return [{ name: 'description', label: 'Invoice description', required: true }, { name: 'amount', label: 'Amount', type: 'number', required: true }, { name: 'dueAt', label: 'Due date', type: 'date', required: true }, { name: 'invoiceNumber', label: 'Invoice number (optional)', required: false }, { name: 'lineItems', label: 'Line items (JSON, optional)', type: 'textarea', required: false, placeholder: '[{"description":"Care visit","quantity":1,"unitAmount":75}]' }];
  if (resource === 'vitals') return [select('type', 'Measurement', [{ value: 'bloodPressure', label: 'Blood pressure' }, { value: 'heartRate', label: 'Heart rate' }, { value: 'temperature', label: 'Temperature' }, { value: 'weight', label: 'Weight' }, { value: 'bloodGlucose', label: 'Blood glucose' }, { value: 'oxygenSaturation', label: 'Oxygen saturation' }]), { name: 'value', label: 'Primary value', type: 'number', required: true }, { name: 'unit', label: 'Unit', required: true, placeholder: 'e.g. bpm, kg, °C' }, { name: 'systolic', label: 'Systolic (blood pressure)', type: 'number', required: false }, { name: 'diastolic', label: 'Diastolic (blood pressure)', type: 'number', required: false }, { name: 'notes', label: 'Notes (optional)', required: false }];
  if (resource === 'healthProfiles') return [{ name: 'dateOfBirth', label: 'Date of birth', type: 'date', required: false }, { name: 'bloodType', label: 'Blood type', required: false }, { name: 'conditions', label: 'Conditions (comma separated)', required: false }, { name: 'allergies', label: 'Allergies (comma separated)', required: false }, { name: 'carePreferences', label: 'Care preferences', required: false }, { name: 'clinician', label: 'Primary clinician', required: false }];
  if (resource === 'appointments') return [{ name: 'title', label: 'Appointment', required: true }, { name: 'clinician', label: 'Clinician (optional)', required: false }, { name: 'location', label: 'Location (optional)', required: false }, { name: 'scheduledAt', label: 'Date and time', type: 'datetime-local', required: true }, { name: 'notes', label: 'Notes (optional)', required: false }];
  if (resource === 'careNotes') return [{ name: 'title', label: 'Note title', required: true }, { name: 'body', label: 'Care note', required: true }, select('visibility', 'Visible to', [{ value: 'care-team', label: 'Care team only' }, { value: 'family', label: 'Family and care team' }])];
  if (resource === 'devices') return [{ name: 'name', label: 'Device name', required: true }, select('deviceType', 'Device type', [{ value: 'wearable', label: 'Wearable' }, { value: 'sensor', label: 'Home sensor' }, { value: 'other', label: 'Other' }]), { name: 'provider', label: 'Provider / manufacturer', required: false }];
  if (resource === 'alertRules') return [{ name: 'name', label: 'Rule name', required: true }, select('eventType', 'Event type', [{ value: 'fall', label: 'Fall detection' }, { value: 'inactivity', label: 'Inactivity' }, { value: 'heartRate', label: 'Heart-rate event' }, { value: 'geofence', label: 'Geofence exit' }]), select('severity', 'Severity', [{ value: 'warning', label: 'Needs attention' }, { value: 'critical', label: 'Urgent' }, { value: 'info', label: 'Informational' }]), { name: 'thresholdMinutes', label: 'Inactivity threshold (minutes)', type: 'number', required: false }];
  if (resource === 'paymentEvents') return [{ name: 'invoiceId', label: 'Invoice record ID', required: true }, { name: 'amount', label: 'Amount', type: 'number', required: true }, { name: 'provider', label: 'Provider / offline method', required: true }, { name: 'reference', label: 'Reference (optional)', required: false }];
  if (resource === 'invitations') return [{ name: 'email', label: 'Team member email', type: 'email', required: true }, select('role', 'Role', [{ value: 'family', label: 'Family member' }, { value: 'caregiver', label: 'Caregiver' }])];
  if (resource === 'checkins') return [{ name: 'title', label: 'Check-in title', required: true }, { name: 'scheduledAt', label: 'Date and time', type: 'datetime-local', required: true }];
  return [{ name: 'name', label: 'Name', required: true }, { name: 'notes', label: 'Notes', required: false }];
}

function iconFor(kind) {
  const icons = { alerts: <AlertTriangle size={18} />, medications: <Pill size={18} />, tasks: <Check size={18} />, shifts: <CalendarDays size={18} />, locations: <MapPin size={18} />, checkins: <Video size={18} />, invoices: <CreditCard size={18} />, activity: <Activity size={18} />, geofences: <Shield size={18} /> };
  return icons[kind] || <Heart size={18} />;
}
function humanize(value = '') { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function greeting() { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; }
function timeAgo(date) {
  if (!date) return 'Just now';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}

createRoot(document.getElementById('root')).render(<App />);
