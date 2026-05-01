import { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import './Solicitacoes.css';

const TYPE_LABEL = { swap: 'Troca de turno', folga: 'Folga', ferias: 'Férias' };

export default function Solicitacoes() {
  const [requests, setRequests] = useState([]);
  const [filter,   setFilter]   = useState('pendente');
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState(null);

  useEffect(() => {
    const q = query(collection(db, 'solicitacoes'), orderBy('criadaEm', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  async function updateStatus(id, status) {
    await updateDoc(doc(db, 'solicitacoes', id), {
      status,
      resolvidaEm: serverTimestamp(),
    });
    showToast(status === 'aprovada' ? 'Solicitação aprovada!' : 'Solicitação rejeitada.', status);
  }

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const filtered = requests.filter(r => r.status === filter);

  return (
    <div className="page page-sol fade-in">
      <div className="page-header">
        <div>
          <h1>Solicitações</h1>
          <p className="text-secondary">Central de aprovação</p>
        </div>
      </div>

      <div className="filter-tabs">
        {['pendente','aprovada','rejeitada'].map(s => (
          <button
            key={s}
            className={`filter-tab${filter === s ? ' active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="filter-count">
              {requests.filter(r => r.status === s).length}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding: 60 }}>
          <span className="spinner spinner-lg" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>Nenhuma solicitação {filter}.</p>
        </div>
      ) : (
        <div className="requests-list">
          {filtered.map(r => (
            <RequestCard key={r.id} request={r} onUpdate={updateStatus} />
          ))}
        </div>
      )}

      {toast && (
        <div className={`toast-bar ${toast.type === 'aprovada' ? 'toast-success' : 'toast-danger'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function RequestCard({ request: r, onUpdate }) {
  const [busy, setBusy] = useState(false);

  async function handle(status) {
    setBusy(true);
    await onUpdate(r.id, status);
    setBusy(false);
  }

  const dateStr = r.criadaEm?.toDate?.()?.toLocaleDateString('pt-BR') ?? '—';

  return (
    <div className="request-card card slide-up">
      <div className="request-header">
        <div>
          <p className="request-nurse">{r.nomeFuncionaria ?? r.nurseId}</p>
          <p className="text-secondary" style={{ fontSize: 12 }}>{TYPE_LABEL[r.tipo] ?? r.tipo} · {dateStr}</p>
        </div>
        <span className={`badge badge-${r.status === 'aprovada' ? 'approved' : r.status === 'rejeitada' ? 'rejected' : 'pending'}`}>
          {r.status}
        </span>
      </div>

      {r.tipo === 'swap' && (
        <div className="request-detail">
          <p>Data original: <strong>{r.dataOrigem}</strong> — Turno: <strong>{r.turnoOrigem}</strong></p>
          <p>Trocar com: <strong>{r.nomeTroca ?? r.nurseIdTroca}</strong> em <strong>{r.dataTroca}</strong> — <strong>{r.turnoTroca}</strong></p>
        </div>
      )}

      {r.tipo === 'folga' && (
        <div className="request-detail">
          <p>Data solicitada: <strong>{r.dataFolga}</strong></p>
          {r.motivo && <p>Motivo: {r.motivo}</p>}
        </div>
      )}

      {r.tipo === 'ferias' && (
        <div className="request-detail">
          <p>Período: <strong>{r.dataInicio}</strong> até <strong>{r.dataFim}</strong></p>
        </div>
      )}

      {r.observacao && (
        <p className="request-obs">{r.observacao}</p>
      )}

      {r.status === 'pendente' && (
        <div className="request-actions">
          <button
            className="btn btn-success"
            onClick={() => handle('aprovada')}
            disabled={busy}
          >
            {busy ? <span className="spinner" /> : '✓'} Aprovar
          </button>
          <button
            className="btn btn-danger"
            onClick={() => handle('rejeitada')}
            disabled={busy}
          >
            ✕ Rejeitar
          </button>
        </div>
      )}
    </div>
  );
}
