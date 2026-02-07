import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ThemeToggle } from '../App';

const ERROR_MESSAGES = {
  no_code: 'GitHub authorization was cancelled.',
  token_exchange_failed: 'GitHub login failed. Try again.',
  account_deactivated: 'Your account has been deactivated. Contact admin.',
  registration_disabled: 'Public registration is currently disabled.',
  creation_failed: 'Account creation failed. Try again.',
  server_error: 'Server error. Please try again later.',
  parse_error: 'Authentication data corrupted. Try again.',
  missing_token: 'Authentication failed. Try again.',
};

export default function Login({ onLogin }) {
  const [searchParams] = useSearchParams();
  const urlError = searchParams.get('error');

  const [mode, setMode] = useState('github'); // 'github' | 'email-login' | 'email-register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(urlError ? (ERROR_MESSAGES[urlError] || 'Login failed.') : '');
  const [loading, setLoading] = useState(false);

  const handleGitHubLogin = () => {
    window.location.href = api.getGitHubLoginUrl();
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login(email, password);
      onLogin(res.token, res.user);
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.register(email, password, displayName);
      onLogin(res.token, res.user);
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div className="login-theme-toggle">
          <ThemeToggle />
        </div>
        <div className="login-logo">⚡</div>
        <h1>Token Tracker</h1>
        <p>// global copilot token management</p>

        {error && <div className="login-error">✕ {error}</div>}

        {/* GitHub OAuth — Primary */}
        {mode === 'github' && (
          <>
            <button
              className="btn btn-github"
              onClick={handleGitHubLogin}
              style={{ width: '100%', justifyContent: 'center', padding: '12px', fontWeight: 600 }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              Continue with GitHub
            </button>

            <div className="login-divider">
              <span>or</span>
            </div>

            <button
              className="btn"
              onClick={() => setMode('email-login')}
              style={{ width: '100%', justifyContent: 'center', marginBottom: '8px' }}
            >
              📧 Sign in with Email
            </button>
            <button
              className="btn"
              onClick={() => setMode('email-register')}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              ✨ Create Account
            </button>
          </>
        )}

        {/* Email Login */}
        {mode === 'email-login' && (
          <form onSubmit={handleEmailLogin}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
            >
              {loading ? <span className="spinner" /> : '⚡ Sign In'}
            </button>
            <div className="login-switch">
              <button type="button" onClick={() => { setMode('github'); setError(''); }}>← Back</button>
              <button type="button" onClick={() => { setMode('email-register'); setError(''); }}>Create account →</button>
            </div>
          </form>
        )}

        {/* Email Registration */}
        {mode === 'email-register' && (
          <form onSubmit={handleEmailRegister}>
            <div className="form-group">
              <label className="form-label">Display Name</label>
              <input
                type="text"
                className="form-input"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Your Name"
                autoFocus
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password (min 6 chars)</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
            >
              {loading ? <span className="spinner" /> : '✨ Create Account'}
            </button>
            <div className="login-switch">
              <button type="button" onClick={() => { setMode('github'); setError(''); }}>← Back</button>
              <button type="button" onClick={() => { setMode('email-login'); setError(''); }}>Sign in instead →</button>
            </div>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: '32px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Token Tracker v2.0 · Global Copilot Management
        </div>
      </div>
    </div>
  );
}
