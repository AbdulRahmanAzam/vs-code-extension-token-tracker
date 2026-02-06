import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function AuthCallback({ onLogin }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = params.get('token');
    const userStr = params.get('user');

    if (token && userStr) {
      try {
        const user = JSON.parse(decodeURIComponent(userStr));
        onLogin(token, user);
        navigate('/', { replace: true });
      } catch {
        navigate('/login?error=parse_error', { replace: true });
      }
    } else {
      navigate('/login?error=missing_token', { replace: true });
    }
  }, [params, onLogin, navigate]);

  return (
    <div className="loading-page">
      <div className="spinner" style={{ width: 32, height: 32 }} />
      <span>Authenticating with GitHub…</span>
    </div>
  );
}
