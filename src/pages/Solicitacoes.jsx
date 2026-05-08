import { useEffect, useMemo, useState } from 'react';
import {
  collection, onSnapshot, doc, writeBatch, runTransaction,
  serverTimestamp, query, orderBy, deleteDoc, updateDoc, getDocs,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { SHIFTS } from '../constants/shifts';
import './Solicitacoes.css';

/* ───────── Constantes ───────── */
const TYPE_LABEL  = { swap: 'Troca de turno', folga: 'Folga', ferias: 'Férias' };
const TYPE_ICON   = { swap: '🔄', folga: '🏖️', ferias: '✈️' };
const TYPE_ACCENT = { swap: 'accent', folga: 'info', ferias: 'success' };

const PERIOD_OPTS = [
  { id: 'all',   label: 'Todos' },
  { id: '7',     label: 'Últimos 7 dias' },
  { id: '30',    label: 'Últimos 30 dias' },
  { id: '90',    label: 'Últimos 90 dias' },
  { id: 'today', label: 'Hoje' },
];

/* ───────── Helpers ───────── */
function normalizeRequest(id, d) {
  const statusMap = { pending: 'pendente', approved: 'aprovada', rejected: 'rejeitada' };
  return {
    id,
    ...d,
    tipo:            d.tipo            ?? d.type,
    status:          statusMap[d.status] ?? d.status,
    nomeFuncionaria: d.nomeFuncionaria  ?? d.nurseName,
    nurseIdTroca:    d.nurseIdTroca    ?? d.nurseIdcambio,
    nomeTroca:       d.nomeTroca       ?? d.nursecambio,
    turnoOrigem:     d.turnoOrigem     ?? d.turnoRichiedente,
    turnoTroca:      d.turnoTroca      ?? d.turnoCambio,
    dataOrigem:      d.dataOrigem      ?? d.dataRichiedente?.toDate?.()?.toLocaleDateString('pt-BR'),
    dataTroca:       d.dataTroca       ?? d.dataCambio?.toDate?.()?.toLocaleDateString('pt-BR'),
    dataInicio:      d.dataInicio      ?? d.startDate?.toDate?.()?.toLocaleDateString('pt-BR'),
    dataFim:         d.dataFim         ?? d.endDate?.toDate?.()?.toLocaleDateString('pt-BR'),
  };
}

function parseDate(str) {
  if (!str) return null;
  if (str.includes('-')) {
    const [y, m, d] = str.split('-').map(Number);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return { year: y, month: m, day: d };
  }
  if (str.includes('/')) {
    const [d, m, y] = str.split('/').map(Number);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return { year: y, month: m, day: d };
  }
  return null;
}

function toIso(str) {
  if (!str) return '';
  if (str.includes('-')) return str;
  const [d, m, y] = str.split('/');
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function timeAgo(ts) {
  const date = ts?.toDate?.() ?? null;
  if (!date) return '—';
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1)  return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7)    return `há ${d}d`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function fmtDateBR(str) {
  const p = parseDate(str);
  if (!p) return str ?? '—';
  const d = new Date(p.year, p.month - 1, p.day);
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
          .replace('.', '');
}

function shortDate(str) {
  const p = parseDate(str);
  if (!p) return str ?? '';
  return `${String(p.day).padStart(2,'0')}/${String(p.month).padStart(2,'0')}`;
}

function buildPreview(r) {
  if (r.tipo === 'swap') {
    const a = r.dataOrigem ? `${shortDate(r.dataOrigem)}${r.turnoOrigem ? ` (${r.turnoOrigem})` : ''}` : '';
    const b = r.dataTroca  ? `${shortDate(r.dataTroca)}${r.turnoTroca   ? ` (${r.turnoTroca})`  : ''}` : '';
    if (!a && !b) return null;
    const swap = [a, b].filter(Boolean).join(' ↔ ');
    return r.nomeTroca ? `${swap} · ${r.nomeTroca.split(' ')[0]}` : swap;
  }
  if (r.tipo === 'folga') return r.dataFolga ? shortDate(r.dataFolga) : null;
  if (r.tipo === 'ferias') {
    if (r.dataInicio && r.dataFim) return `${shortDate(r.dataInicio)} → ${shortDate(r.dataFim)}`;
    if (r.dataInicio) return `a partir de ${shortDate(r.dataInicio)}`;
    return null;
  }
  return null;
}

function fmtTs(ts) {
  const d = ts?.toDate?.();
  if (!d) return null;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' • ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/* ── Escritas de folga/férias em batch ── */
function addScheduleWrites(batch, r) {
  if (r.tipo === 'folga') {
    const p = parseDate(r.dataFolga);
    if (!p) return;
    batch.set(
      doc(db, 'escalas', `${r.nurseId}_${p.year}_${p.month}`),
      { [`d${p.day}`]: 'OFF' },
      { merge: true },
    );
  } else if (r.tipo === 'ferias') {
    const start = parseDate(r.dataInicio);
    const end   = parseDate(r.dataFim);
    if (!start || !end) return;
    const monthMap = {};
    const cur = new Date(start.year, start.month - 1, start.day);
    const endDate = new Date(end.year, end.month - 1, end.day);
    while (cur <= endDate) {
      const y = cur.getFullYear(), m = cur.getMonth() + 1, d = cur.getDate();
      const key = `${r.nurseId}_${y}_${m}`;
      if (!monthMap[key]) monthMap[key] = {};
      monthMap[key][`d${d}`] = 'FE';
      cur.setDate(cur.getDate() + 1);
    }
    Object.entries(monthMap).forEach(([docId, fields]) => {
      batch.set(doc(db, 'escalas', docId), fields, { merge: true });
    });
  }
}

/* ── Aprovação de swap em transação ── */
async function approveSwap(request, decidedBy) {
  const a = parseDate(request.dataOrigem);
  const b = parseDate(request.dataTroca);
  if (!a || !b || !request.nurseId || !request.nurseIdTroca
      || !request.turnoTroca || !request.turnoOrigem) {
    throw new Error('SWAP_INVALID');
  }
  const aRef = doc(db, 'escalas', `${request.nurseId}_${a.year}_${a.month}`);
  const bRef = doc(db, 'escalas', `${request.nurseIdTroca}_${b.year}_${b.month}`);
  const sRef = doc(db, 'solicitacoes', request.id);

  await runTransaction(db, async (txn) => {
    const [aSnap, bSnap] = await Promise.all([txn.get(aRef), txn.get(bRef)]);
    const currentA = aSnap.exists() ? aSnap.data()[`d${a.day}`] ?? 'OFF' : 'OFF';
    const currentB = bSnap.exists() ? bSnap.data()[`d${b.day}`] ?? 'OFF' : 'OFF';
    if (currentA !== request.turnoOrigem || currentB !== request.turnoTroca) {
      const e = new Error('SWAP_CONFLICT');
      e.detail = { currentA, currentB, expectedA: request.turnoOrigem, expectedB: request.turnoTroca };
      throw e;
    }
    txn.set(aRef, { [`d${a.day}`]: request.turnoTroca }, { merge: true });
    txn.set(bRef, { [`d${b.day}`]: request.turnoOrigem }, { merge: true });
    txn.update(sRef, { status: 'aprovada', approvedAt: serverTimestamp(), decidedBy });
  });
}

/* ───────── Página ───────── */
export default function Solicitacoes() {
  const [requests,       setRequests]       = useState([]);
  const [filter,         setFilter]         = useState('pendente');
  const [period,         setPeriod]         = useState('all');
  const [search,         setSearch]         = useState('');
  const [loading,        setLoading]        = useState(true);
  const [toast,          setToast]          = useState(null);
  const [editingRequest, setEditingRequest] = useState(null);

  useEffect(() => {
    const q = query(collection(db, 'solicitacoes'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setRequests(snap.docs.map(d => normalizeRequest(d.id, d.data())));
      setLoading(false);
    });
    return unsub;
  }, []);

  async function updateStatus(id, status) {
    const decidedBy = auth.currentUser?.uid ?? null;
    const request = requests.find(r => r.id === id);

    if (status === 'aprovada' && request?.tipo === 'swap') {
      try {
        await approveSwap(request, decidedBy);
        showToast('Aprovada! Escala atualizada.', 'aprovada');
      } catch (err) {
        if (err.message === 'SWAP_CONFLICT') {
          const { currentA, currentB, expectedA, expectedB } = err.detail;
          showToast(
            `Conflito: escala mudou (atual ${currentA}/${currentB}, esperado ${expectedA}/${expectedB}). Reavalie.`,
            'rejeitada',
          );
        } else {
          showToast('Erro ao aprovar troca. Tente novamente.', 'rejeitada');
        }
      }
      return;
    }

    const batch = writeBatch(db);
    batch.update(
      doc(db, 'solicitacoes', id),
      status === 'aprovada'
        ? { status, approvedAt: serverTimestamp(), decidedBy }
        : { status, rejectedAt: serverTimestamp(), decidedBy },
    );
    if (status === 'aprovada' && request) addScheduleWrites(batch, request);

    try {
      await batch.commit();
      showToast(
        status === 'aprovada' ? 'Aprovada! Escala atualizada.' : 'Solicitação rejeitada.',
        status,
      );
    } catch (err) {
      showToast('Erro ao processar solicitação. Tente novamente.', 'rejeitada');
    }
  }

  async function deleteRequest(id) {
    try {
      await deleteDoc(doc(db, 'solicitacoes', id));
      showToast('Solicitação eliminada.', 'rejeitada');
    } catch {
      showToast('Erro ao eliminar. Tente novamente.', 'rejeitada');
    }
  }

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const filtered = useMemo(() => {
    const now = Date.now();
    const periodMs = period === 'all' ? Infinity : Number(period) * 86400000;
    const term = search.trim().toLowerCase();

    return requests.filter(r => {
      if (r.status !== filter) return false;
      if (period !== 'all') {
        const ts = (r.createdAt ?? r.criadaEm)?.toMillis?.() ?? 0;
        if (period === 'today') {
          if (new Date(ts).toDateString() !== new Date().toDateString()) return false;
        } else if (now - ts > periodMs) return false;
      }
      if (term) {
        const haystack = [r.nomeFuncionaria, r.nurseId, r.nomeTroca, r.nurseIdTroca,
          r.motivo, r.observacao, r.observacaoCoord, TYPE_LABEL[r.tipo]]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [requests, filter, period, search]);

  const counts = useMemo(() => {
    const c = { pendente: 0, aprovada: 0, rejeitada: 0 };
    for (const r of requests) if (c[r.status] !== undefined) c[r.status]++;
    return c;
  }, [requests]);

  return (
    <div className="page page-sol fade-in">
      <header className="page-header">
        <div>
          <h1>Solicitações</h1>
          <p className="text-secondary">Central de aprovação · {filtered.length} resultado{filtered.length === 1 ? '' : 's'}</p>
        </div>
      </header>

      <div className="sol-toolbar">
        <div className="sol-search">
          <svg className="sol-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search"
            placeholder="Buscar por funcionária, motivo ou observação…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="sol-search-clear" onClick={() => setSearch('')} aria-label="Limpar busca">×</button>
          )}
        </div>
        <select
          className="sol-period-select"
          value={period}
          onChange={e => setPeriod(e.target.value)}
        >
          {PERIOD_OPTS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>

      <div className="filter-tabs">
        {['pendente','aprovada','rejeitada'].map(s => (
          <button
            key={s}
            className={`filter-tab${filter === s ? ' active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="filter-count">{counts[s]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding: 60 }}>
          <span className="spinner spinner-lg" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 28, marginBottom: 4 }}>📋</p>
          <p>Nenhuma solicitação {filter}{search ? ` para "${search}"` : ''}.</p>
          {(search || period !== 'all') && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setPeriod('all'); }} style={{ marginTop: 12 }}>
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="requests-list">
          {filtered.map(r => (
            <RequestCard
              key={r.id}
              request={r}
              onUpdate={updateStatus}
              onDelete={deleteRequest}
              onEdit={req => setEditingRequest(req)}
            />
          ))}
        </div>
      )}

      {toast && (
        <div className={`toast-bar ${toast.type === 'aprovada' ? 'toast-success' : 'toast-danger'}`}>
          {toast.msg}
        </div>
      )}

      {editingRequest && (
        <EditModal
          request={editingRequest}
          onClose={() => setEditingRequest(null)}
          onSaved={() => { setEditingRequest(null); showToast('Solicitação atualizada.', 'aprovada'); }}
        />
      )}
    </div>
  );
}

/* ───────── Card com expand/collapse ───────── */
function RequestCard({ request: r, onUpdate, onDelete, onEdit }) {
  const [expanded,      setExpanded]      = useState(false);
  const [busy,          setBusy]          = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function toggle() { setExpanded(p => !p); setConfirmDelete(false); }

  async function handle(status) {
    setBusy(true);
    await onUpdate(r.id, status);
    setBusy(false);
  }

  const created = r.createdAt ?? r.criadaEm;
  const decided = r.status === 'aprovada' ? r.approvedAt
                : r.status === 'rejeitada' ? r.rejectedAt
                : null;

  const statusBadge = r.status === 'aprovada' ? 'badge-approved'
                    : r.status === 'rejeitada' ? 'badge-rejected'
                    : 'badge-pending';

  const preview = buildPreview(r);

  /* Bloco de datas expandido */
  let dateBlock = null;
  if (r.tipo === 'swap') {
    dateBlock = (
      <div className="req-dates">
        <div className="req-date-pair">
          <span className="req-date-label">Data de {r.nomeFuncionaria?.split(' ')[0] ?? 'solicitante'}</span>
          <span className="req-date-value">{fmtDateBR(r.dataOrigem)}</span>
          <span className="req-shift-tag">{r.turnoOrigem}</span>
        </div>
        <span className="req-date-arrow" aria-hidden>↔</span>
        <div className="req-date-pair">
          <span className="req-date-label">{r.nomeTroca ?? r.nurseIdTroca ?? 'colega'}</span>
          <span className="req-date-value">{fmtDateBR(r.dataTroca)}</span>
          <span className="req-shift-tag">{r.turnoTroca}</span>
        </div>
      </div>
    );
  } else if (r.tipo === 'folga') {
    dateBlock = (
      <div className="req-dates">
        <div className="req-date-pair">
          <span className="req-date-label">Folga em</span>
          <span className="req-date-value">{fmtDateBR(r.dataFolga)}</span>
        </div>
        {r.motivo && (
          <div className="req-motivo">
            <span className="req-motivo-label">Motivo:</span> {r.motivo}
          </div>
        )}
      </div>
    );
  } else if (r.tipo === 'ferias') {
    dateBlock = (
      <div className="req-dates">
        <div className="req-date-pair">
          <span className="req-date-label">Início</span>
          <span className="req-date-value">{fmtDateBR(r.dataInicio)}</span>
        </div>
        <span className="req-date-arrow" aria-hidden>→</span>
        <div className="req-date-pair">
          <span className="req-date-label">Fim</span>
          <span className="req-date-value">{fmtDateBR(r.dataFim)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`req-card req-card--${TYPE_ACCENT[r.tipo] ?? 'accent'}${expanded ? ' req-card--open' : ''}`}>

      {/* ── Cabeçalho clicável ── */}
      <button className="req-header" onClick={toggle} aria-expanded={expanded}>
        <div className="req-header-main">
          <div className="req-header-left">
            <span className="req-type-icon" aria-hidden>{TYPE_ICON[r.tipo] ?? '📋'}</span>
            <span className="req-type-label">{TYPE_LABEL[r.tipo] ?? r.tipo}</span>
          </div>
          <div className="req-header-right">
            <span className={`badge ${statusBadge}`}>{r.status}</span>
            <svg
              className={`req-chevron${expanded ? ' req-chevron--up' : ''}`}
              width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
        </div>
        <div className="req-header-sub">
          <div className="req-header-nurse">
            <div className="req-avatar-sm">{getInitials(r.nomeFuncionaria ?? r.nurseId)}</div>
            <span className="req-nurse-name">{r.nomeFuncionaria ?? r.nurseId}</span>
          </div>
          {preview && <span className="req-preview">{preview}</span>}
        </div>
      </button>

      {/* ── Corpo colapsável ── */}
      {expanded && (
        <div className="req-body-expanded">
          {dateBlock}

          {/* Timestamps */}
          <div className="req-footer">
            <span className="req-meta">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              {fmtTs(created) ?? `Criada ${timeAgo(created)}`}
            </span>
            {decided && (
              <span className="req-meta">
                {r.status === 'aprovada' ? '✓ Aprovada' : '✕ Rejeitada'} · {fmtTs(decided) ?? timeAgo(decided)}
              </span>
            )}
            {r.observacao && (
              <span className="req-meta req-obs" title={r.observacao}>💬 {r.observacao}</span>
            )}
            {r.observacaoCoord && (
              <span className="req-meta req-obs-coord" title={r.observacaoCoord}>📝 {r.observacaoCoord}</span>
            )}
          </div>

          {/* Ações — apenas para pendentes */}
          {r.status === 'pendente' && (
            <div className="req-actions-row">
              <div className="req-actions-secondary">
                <button
                  className="req-btn req-btn--edit"
                  onClick={() => onEdit(r)}
                  disabled={busy}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  Modificar
                </button>

                {confirmDelete ? (
                  <button
                    className="req-btn req-btn--confirm-del"
                    onClick={async () => { setBusy(true); await onDelete(r.id); }}
                    disabled={busy}
                  >
                    {busy
                      ? <span className="spinner" />
                      : <>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                          Confirmar exclusão
                        </>
                    }
                  </button>
                ) : (
                  <button
                    className="req-btn req-btn--delete"
                    onClick={() => setConfirmDelete(true)}
                    disabled={busy}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                    Eliminar
                  </button>
                )}
              </div>

              <div className="req-actions-primary">
                <button
                  className="req-btn req-btn--reject"
                  onClick={() => handle('rejeitada')}
                  disabled={busy}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                  Rejeitar
                </button>
                <button
                  className="req-btn req-btn--approve"
                  onClick={() => handle('aprovada')}
                  disabled={busy}
                >
                  {busy
                    ? <span className="spinner" />
                    : <>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Aprovar
                      </>
                  }
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────── Modal de edição ───────── */
function EditModal({ request: r, onClose, onSaved }) {
  const [form,    setForm]    = useState({
    dataOrigem:  toIso(r.dataOrigem)  ?? '',
    turnoOrigem: r.turnoOrigem        ?? '',
    nurseIdTroca:r.nurseIdTroca       ?? '',
    nomeTroca:   r.nomeTroca          ?? '',
    dataTroca:   toIso(r.dataTroca)   ?? '',
    turnoTroca:  r.turnoTroca         ?? '',
    dataFolga:   toIso(r.dataFolga)   ?? '',
    motivo:      r.motivo             ?? '',
    dataInicio:  toIso(r.dataInicio)  ?? '',
    dataFim:     toIso(r.dataFim)     ?? '',
    observacao:  r.observacao         ?? '',
  });
  const [nurses,  setNurses]  = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (r.tipo !== 'swap') return;
    getDocs(collection(db, 'funcionarios')).then(snap => {
      setNurses(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(n => n.id !== r.nurseId));
    });
  }, [r.nurseId, r.tipo]);

  function f(k, v) { setForm(prev => ({ ...prev, [k]: v })); setError(''); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const updates = {};
      if (r.tipo === 'swap') {
        updates.dataOrigem   = form.dataOrigem;
        updates.turnoOrigem  = form.turnoOrigem;
        updates.nurseIdTroca = form.nurseIdTroca;
        updates.nomeTroca    = form.nomeTroca;
        updates.dataTroca    = form.dataTroca;
        updates.turnoTroca   = form.turnoTroca;
      } else if (r.tipo === 'folga') {
        updates.dataFolga = form.dataFolga;
        updates.motivo    = form.motivo;
      } else if (r.tipo === 'ferias') {
        updates.dataInicio = form.dataInicio;
        updates.dataFim    = form.dataFim;
      }
      updates.observacao = form.observacao;
      await updateDoc(doc(db, 'solicitacoes', r.id), updates);
      onSaved();
    } catch {
      setError('Erro ao salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  const SHIFT_OPTS = Object.entries(SHIFTS).filter(([k]) => k !== 'OFF' && k !== 'FE' && k !== 'AT');

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 520 }}>
        <div className="modal-header-row">
          <h3>{TYPE_ICON[r.tipo]} Modificar — {TYPE_LABEL[r.tipo]}</h3>
          <button className="modal-close-btn" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <p className="modal-nurse-label">{r.nomeFuncionaria}</p>

        <form onSubmit={handleSave} className="modal-form">
          {r.tipo === 'swap' && (
            <>
              <div className="form-row-2">
                <div className="form-field">
                  <label>Sua data</label>
                  <input type="date" required value={form.dataOrigem} onChange={e => f('dataOrigem', e.target.value)} />
                </div>
                <div className="form-field">
                  <label>Seu turno</label>
                  <select required value={form.turnoOrigem} onChange={e => f('turnoOrigem', e.target.value)}>
                    <option value="">Selecionar...</option>
                    {SHIFT_OPTS.map(([k, s]) => <option key={k} value={k}>{k} — {s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-field">
                <label>Trocar com</label>
                <select required value={form.nurseIdTroca} onChange={e => {
                  const n = nurses.find(x => x.id === e.target.value);
                  f('nurseIdTroca', e.target.value);
                  f('nomeTroca', n?.name ?? '');
                }}>
                  <option value="">Selecionar colega...</option>
                  {nurses.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </div>
              <div className="form-row-2">
                <div className="form-field">
                  <label>Data da colega</label>
                  <input type="date" required value={form.dataTroca} onChange={e => f('dataTroca', e.target.value)} />
                </div>
                <div className="form-field">
                  <label>Turno da colega</label>
                  <select required value={form.turnoTroca} onChange={e => f('turnoTroca', e.target.value)}>
                    <option value="">Selecionar...</option>
                    {SHIFT_OPTS.map(([k, s]) => <option key={k} value={k}>{k} — {s.name}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {r.tipo === 'folga' && (
            <>
              <div className="form-field">
                <label>Data da folga</label>
                <input type="date" required value={form.dataFolga} onChange={e => f('dataFolga', e.target.value)} />
              </div>
              <div className="form-field">
                <label>Motivo (opcional)</label>
                <input type="text" value={form.motivo} onChange={e => f('motivo', e.target.value)} />
              </div>
            </>
          )}

          {r.tipo === 'ferias' && (
            <div className="form-row-2">
              <div className="form-field">
                <label>Data de início</label>
                <input type="date" required value={form.dataInicio} onChange={e => f('dataInicio', e.target.value)} />
              </div>
              <div className="form-field">
                <label>Data de fim</label>
                <input type="date" required value={form.dataFim} onChange={e => f('dataFim', e.target.value)} />
              </div>
            </div>
          )}

          <div className="form-field">
            <label>Observação (opcional)</label>
            <textarea rows={2} value={form.observacao} onChange={e => f('observacao', e.target.value)} />
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="modal-footer-row">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" /> Salvando…</> : 'Salvar alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
