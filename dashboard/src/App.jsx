import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AuthCallback from './pages/AuthCallback';
import { ToastProvider } from './components/Toast';

// Theme context
const ThemeContext = createContext();

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle theme"
    >
      <div className={`toggle-knob ${theme === 'light' ? 'light' : ''}`}>
        {theme === 'dark' ? '🌙' : '☀️'}
      </div>
    </button>
  );
}

export default function App() {
  const [isAuth, setIsAuth] = useState(api.isAuthenticated());
  const [theme, setTheme] = useState(() => localStorage.getItem('tt-theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('tt-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const handleLogin = (token, user) => {
    api.setAuth(token, user);
    setIsAuth(true);
  };

  const handleLogout = () => {
    api.clearAuth();
    setIsAuth(false);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <ToastProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route
              path="/login"
              element={
                isAuth ? <Navigate to="/" replace /> : <Login onLogin={handleLogin} />
              }
            />
            <Route
              path="/auth/callback"
              element={<AuthCallback onLogin={handleLogin} />}
            />
            <Route
              path="/*"
              element={
                isAuth ? <Dashboard onLogout={handleLogout} /> : <Navigate to="/login" replace />
              }
            />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ThemeContext.Provider>
  );
}
