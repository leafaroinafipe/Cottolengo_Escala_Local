import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Login.css';

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      const msgs = {
        'auth/user-not-found':    'E-mail não encontrado.',
        'auth/wrong-password':    'Senha incorreta.',
        'auth/invalid-credential':'Credenciais inválidas.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um momento.',
      };
      setError(msgs[err.code] || 'Erro ao entrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden="true" />

      <div className="login-card scale-in">
        <div className="login-logo">
          <div className="login-logo-icon">C</div>
          <div>
            <p className="login-logo-title">Cottolengo</p>
            <p className="login-logo-sub">Painel da Coordenadora</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="coordenadora@cottolengo.org"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
            {loading ? <><span className="spinner" />Entrando...</> : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
