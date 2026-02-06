import { useState } from 'react';
import { api } from '../api';
import { ThemeToggle } from '../App';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.login(username, password);
      onLogin(res.token);
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-theme-toggle">
          <ThemeToggle />
        </div>
        <div className="login-logo">⚡</div>
        <h1>Token Tracker</h1>
        <p>// admin_dashboard — authenticate</p>

        {error && <div className="login-error">✕ {error}</div>}

        <div className="form-group">
          <label className="form-label">→ Username</label>
          <input
            type="text"
            className="form-input"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="admin"
            autoFocus
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">→ Password</label>
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
          style={{ width: '100%', justifyContent: 'center', padding: '13px', marginTop: '8px', fontSize: '14px' }}
        >
          {loading ? <span className="spinner" /> : '⚡ Authenticate'}
        </button>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Centralized Token Management System v1.0
        </div>
      </form>
    </div>
  );
}
