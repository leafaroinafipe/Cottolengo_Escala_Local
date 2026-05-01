import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function PrivateRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <span className="spinner spinner-lg" />
        <p>Carregando...</p>
      </div>
    );
  }

  return user ? children : <Navigate to="/login" replace />;
}
