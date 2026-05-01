import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import './Dashboard.css';

export default function Dashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState({ pendentes: 0, aprovadas: 0, funcionarios: 0 });
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    const qPendentes = query(collection(db, 'solicitacoes'), where('status', '==', 'pendente'));
    const unsubPendentes = onSnapshot(qPendentes, snap => {
      setStats(s => ({ ...s, pendentes: snap.size }));
    });

    const qAprovadas = query(collection(db, 'solicitacoes'), where('status', '==', 'aprovada'));
    const unsubAprovadas = onSnapshot(qAprovadas, snap => {
      setStats(s => ({ ...s, aprovadas: snap.size }));
    });

    getDocs(collection(db, 'funcionarios')).then(snap => {
      setStats(s => ({ ...s, funcionarios: snap.size }));
    });

    const qRecent = query(collection(db, 'solicitacoes'), where('status', '==', 'pendente'));
    const unsubRecent = onSnapshot(qRecent, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.criadaEm?.toMillis?.() ?? 0) - (a.criadaEm?.toMillis?.() ?? 0))
        .slice(0, 5);
      setRecent(items);
    });

    return () => { unsubPendentes(); unsubAprovadas(); unsubRecent(); };
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="page dashboard fade-in">
      <div className="page-header">
        <div>
          <h1>{greeting}, {profile?.name?.split(' ')[0] ?? 'Coordenadora'}</h1>
          <p className="text-secondary">Resumo do dia</p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          icon="⏳"
          label="Pendentes"
          value={stats.pendentes}
          color="warning"
          link="/solicitacoes"
        />
        <StatCard
          icon="✅"
          label="Aprovadas este mês"
          value={stats.aprovadas}
          color="success"
        />
        <StatCard
          icon="👥"
          label="Funcionárias"
          value={stats.funcionarios}
          color="info"
          link="/equipe"
        />
      </div>

      {recent.length > 0 && (
        <div className="card slide-up">
          <div className="card-header">
            <h3>Solicitações pendentes</h3>
            <a href="/solicitacoes" className="btn btn-ghost btn-sm">Ver todas →</a>
          </div>
          <div className="recent-list">
            {recent.map(r => (
              <div key={r.id} className="recent-item">
                <div className="recent-info">
                  <p className="recent-name">{r.nomeFuncionaria ?? r.nurseId}</p>
                  <p className="text-secondary" style={{ fontSize: 12 }}>
                    {TYPE_LABEL[r.tipo] ?? r.tipo}
                    {r.dataOrigem && ` · ${r.dataOrigem}`}
                  </p>
                </div>
                <span className="badge badge-pending">Pendente</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const TYPE_LABEL = {
  swap:  'Troca de turno',
  folga: 'Folga',
  ferias:'Férias',
};

function StatCard({ icon, label, value, color, link }) {
  const content = (
    <div className={`stat-card stat-card--${color}`}>
      <span className="stat-icon">{icon}</span>
      <div>
        <p className="stat-value">{value}</p>
        <p className="stat-label">{label}</p>
      </div>
    </div>
  );
  return link ? <a href={link}>{content}</a> : content;
}
