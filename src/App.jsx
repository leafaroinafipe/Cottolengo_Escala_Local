import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import AppShell from './components/AppShell';

/* Code splitting por rota — bundle inicial fica enxuto.
 * Login não é lazy: é a primeira tela e adiantar 1 round-trip melhora o LCP. */
import Login from './pages/Login';

const Dashboard    = lazy(() => import('./pages/Dashboard'));
const Escala       = lazy(() => import('./pages/Escala'));
const Solicitacoes = lazy(() => import('./pages/Solicitacoes'));
const Equipe       = lazy(() => import('./pages/Equipe'));

function PageFallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
      <span className="spinner spinner-lg" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <PrivateRoute>
                  <AppShell />
                </PrivateRoute>
              }
            >
              <Route index         element={<Dashboard />} />
              <Route path="escala" element={<Escala />} />
              <Route path="solicitacoes" element={<Solicitacoes />} />
              <Route path="equipe" element={<Equipe />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
