import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import './AppShell.css';

/* AppShell — auto-hide pattern.
 * Sidebar fica em rail estreito (var --sidebar-w-rail). Ao hover, expande
 * como overlay (var --sidebar-w-expanded) sem empurrar o conteúdo. Margin
 * lateral do <main> e' sempre = rail (nao reflow). Sem state, sem botão. */
export default function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
