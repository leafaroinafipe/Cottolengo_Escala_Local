import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, doc, getDoc, setDoc, deleteField, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { SHIFTS, NURSES_DEFAULT } from '../constants/shifts';
import { generateSchedule, saveGeneratedSchedule } from '../lib/scheduleSolver';
import './Escala.css';

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DOW_LETTERS = ['D','S','T','Q','Q','S','S'];
const SHIFT_CODES = Object.keys(SHIFTS).filter(k => k !== 'OFF');
const DOW_LABELS  = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const DOW_INDICES = [1, 2, 3, 4, 5, 6, 0];

const HOUR_LIMIT_KEY = 'cottolengo:hourLimits';

function loadHourLimits(nurses) {
  try {
    const raw = localStorage.getItem(HOUR_LIMIT_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.fromEntries(nurses.map(n => [n.id, parsed[n.id] ?? 130]));
  } catch {
    return Object.fromEntries(nurses.map(n => [n.id, 130]));
  }
}

export default function Escala() {
  const now   = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [nurses,   setNurses]   = useState(NURSES_DEFAULT);
  const [schedule, setSchedule] = useState({});
  const [loading,  setLoading]  = useState(true);

  /* ─── Geração ─── */
  const [genModal,      setGenModal]      = useState(false);
  const [genHourLimits, setGenHourLimits] = useState({});
  const [genStartDay,   setGenStartDay]   = useState(1);
  const [genRunning,    setGenRunning]    = useState(false);
  const [genProgress,   setGenProgress]   = useState(null);
  const [genResult,     setGenResult]     = useState(null);
  const [genError,      setGenError]      = useState('');
  const [saving,        setSaving]        = useState(false);

  /* ─── Edição de célula ─── */
  const [cellEdit,   setCellEdit]   = useState(null);
  const [cellSaving, setCellSaving] = useState(false);

  /* ─── Menu de ações ─── */
  const [actionsOpen,  setActionsOpen]  = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const menuRef = useRef(null);

  /* ─── Publicação para enfermeiras ─── */
  const [isPublished, setIsPublished] = useState(false);
  const [pubLoading,  setPubLoading]  = useState(false);

  const [toast, setToast] = useState(null);

  const days = daysInMonth(year, month);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'funcionarios'), snap => {
      if (!snap.empty) setNurses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!nurses.length) return;
    let cancelled = false;
    setLoading(true);
    setSchedule({});
    const monthNum = month + 1;
    const ids = nurses.map(n => `${n.id}_${year}_${monthNum}`);
    Promise.all(ids.map(id => getDoc(doc(db, 'escalas', id))))
      .then(snaps => {
        if (cancelled) return;
        const map = {};
        snaps.forEach((snap, i) => {
          if (!snap.exists()) return;
          const nurseId = nurses[i].id;
          const data = snap.data();
          for (let d = 1; d <= 31; d++) {
            if (data[`d${d}`]) map[`${nurseId}_${d}`] = data[`d${d}`];
          }
        });
        setSchedule(map);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, month, nurses]);

  /* Carrega status de publicação ao trocar de mês */
  useEffect(() => {
    const monthNum = month + 1;
    getDoc(doc(db, 'publicacoes', `${year}_${monthNum}`))
      .then(snap => setIsPublished(snap.exists() && snap.data().publicado === true))
      .catch(() => setIsPublished(false));
  }, [year, month]);

  const displaySchedule = useMemo(() => {
    if (!genResult) return schedule;
    const merged = { ...schedule };
    for (const [nurseId, fields] of Object.entries(genResult.schedule)) {
      for (const [dKey, code] of Object.entries(fields)) {
        const d = parseInt(dKey.slice(1), 10);
        merged[`${nurseId}_${d}`] = code;
      }
    }
    return merged;
  }, [schedule, genResult]);

  const stats = useMemo(() => nurses.map(nurse => {
    const shiftCounts = {};
    let totalHours = 0;
    const dowCounts = [0, 0, 0, 0, 0, 0, 0];
    for (let d = 1; d <= days; d++) {
      const code  = displaySchedule[`${nurse.id}_${d}`];
      if (!code || code === 'OFF') continue;
      const shift = SHIFTS[code];
      if (!shift) continue;
      shiftCounts[code] = (shiftCounts[code] ?? 0) + 1;
      totalHours += shift.hours;
      dowCounts[new Date(year, month, d).getDay()]++;
    }
    return { nurse, shiftCounts, totalHours, dowCounts };
  }), [displaySchedule, nurses, days, year, month]);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  /* Fecha menu de ações ao clicar fora */
  useEffect(() => {
    if (!actionsOpen) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setActionsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [actionsOpen]);

  /* ── Limpar escala do mês ── */
  async function clearSchedule() {
    setClearConfirm(false);
    setLoading(true);
    try {
      const monthNum = month + 1;
      const batch = writeBatch(db);
      nurses.forEach(nurse => {
        batch.delete(doc(db, 'escalas', `${nurse.id}_${year}_${monthNum}`));
      });
      await batch.commit();
      setSchedule({});
      setGenResult(null);
      showToast('Escala do mês limpa.', 'success');
    } catch (err) {
      console.error('[Escala] clear failed:', err);
      showToast('Erro ao limpar escala.', 'danger');
    } finally {
      setLoading(false);
    }
  }

  /* ── Imprimir ── */
  function printSchedule() {
    window.print();
  }

  /* ── Edição manual de célula ── */
  function openCellEdit(nurse, day) {
    const currentCode = displaySchedule[`${nurse.id}_${day}`] ?? 'OFF';
    setCellEdit({ nurseId: nurse.id, nurseName: nurse.name, day, currentCode });
  }

  async function handleCellEdit(code) {
    const { nurseId, day } = cellEdit;
    setCellSaving(true);
    const monthNum = month + 1;
    const ref = doc(db, 'escalas', `${nurseId}_${year}_${monthNum}`);
    try {
      if (code === 'OFF') {
        await setDoc(ref, { [`d${day}`]: deleteField() }, { merge: true });
      } else {
        await setDoc(ref, { [`d${day}`]: code }, { merge: true });
      }
      setSchedule(prev => {
        const next = { ...prev };
        if (code === 'OFF') delete next[`${nurseId}_${day}`];
        else next[`${nurseId}_${day}`] = code;
        return next;
      });
      showToast('Escala atualizada.', 'success');
    } catch (err) {
      console.error('[Escala] cell update failed:', err);
      showToast('Erro ao atualizar. Tente novamente.', 'danger');
    } finally {
      setCellSaving(false);
      setCellEdit(null);
    }
  }

  /* ── Geração automática ── */
  function openGenModal() {
    setGenHourLimits(loadHourLimits(nurses));
    setGenStartDay(1);
    setGenError('');
    setGenResult(null);
    setGenProgress(null);
    setGenModal(true);
  }

  async function runGenerate() {
    setGenRunning(true);
    setGenError('');
    setGenProgress({ epoch: 0, fitness: 0, emptyShifts: 0 });
    try {
      localStorage.setItem(HOUR_LIMIT_KEY, JSON.stringify(genHourLimits));
      const result = await generateSchedule({
        nurses, year, month,
        hourLimits: genHourLimits,
        startDay: genStartDay,
        onProgress: (p) => setGenProgress(p),
      });
      setGenResult(result);
      setGenModal(false);
      showToast(
        result.emptyShifts > 0
          ? `Gerada com ${result.emptyShifts} turno(s) vazio(s) — revise antes de publicar.`
          : `Escala gerada (${result.epochs} epochs). Revise e publique.`,
        result.emptyShifts > 0 ? 'warn' : 'success',
      );
    } catch (err) {
      console.error('[Escala] generate failed:', err);
      setGenError(err.message ?? String(err));
    } finally {
      setGenRunning(false);
    }
  }

  function discardPreview() {
    setGenResult(null);
    setGenProgress(null);
    showToast('Pré-visualização descartada.', 'warn');
  }

  async function publishPreview() {
    if (!genResult) return;
    setSaving(true);
    try {
      await saveGeneratedSchedule({ schedule: genResult.schedule, year, month, startDay: genStartDay });
      setGenResult(null);
      const monthNum = month + 1;
      const ids = nurses.map(n => `${n.id}_${year}_${monthNum}`);
      const snaps = await Promise.all(ids.map(id => getDoc(doc(db, 'escalas', id))));
      const map = {};
      snaps.forEach((snap, i) => {
        if (!snap.exists()) return;
        const nurseId = nurses[i].id;
        const data = snap.data();
        for (let d = 1; d <= 31; d++) {
          if (data[`d${d}`]) map[`${nurseId}_${d}`] = data[`d${d}`];
        }
      });
      setSchedule(map);
      showToast('Escala publicada com sucesso!', 'success');
    } catch (err) {
      console.error('[Escala] publish failed:', err);
      showToast('Erro ao publicar: ' + (err.message ?? err), 'danger');
    } finally {
      setSaving(false);
    }
  }

  /* ── Publicar escala para as enfermeiras ── */
  async function publishToNurses() {
    setPubLoading(true);
    const monthNum = month + 1;
    try {
      await setDoc(
        doc(db, 'publicacoes', `${year}_${monthNum}`),
        { publicado: true, publishedAt: serverTimestamp() },
        { merge: true },
      );
      setIsPublished(true);
      showToast(`Escala de ${MONTH_NAMES[month]} publicada para as enfermeiras!`, 'success');
    } catch (err) {
      console.error('[Escala] publish to nurses failed:', err);
      showToast('Erro ao publicar. Tente novamente.', 'danger');
    } finally {
      setPubLoading(false);
    }
  }

  /* ── Revogar publicação ── */
  async function revokePublication() {
    setPubLoading(true);
    const monthNum = month + 1;
    try {
      await setDoc(
        doc(db, 'publicacoes', `${year}_${monthNum}`),
        { publicado: false },
        { merge: true },
      );
      setIsPublished(false);
      showToast('Publicação revogada. Escala oculta das enfermeiras.', 'warn');
    } catch (err) {
      console.error('[Escala] revoke failed:', err);
      showToast('Erro ao revogar. Tente novamente.', 'danger');
    } finally {
      setPubLoading(false);
    }
  }

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  return (
    <div className="page page-escala fade-in">

      {/* Header com navegação e botão de gerar */}
      <div className="page-header">
        <div>
          <h1>Escala</h1>
          <p className="text-secondary">Visualização completa da equipe</p>
        </div>
        <div className="escala-header-actions">
          {/* Status de publicação + botão */}
          {!genResult && (
            isPublished ? (
              <span className="pub-badge pub-badge--on">● Publicada</span>
            ) : (
              <span className="pub-badge pub-badge--off">○ Não publicada</span>
            )
          )}
          {!genResult && (
            isPublished ? (
              <button className="btn btn-ghost btn-sm" onClick={revokePublication} disabled={pubLoading}>
                {pubLoading ? <span className="spinner" /> : 'Revogar'}
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={publishToNurses} disabled={pubLoading || loading}>
                {pubLoading ? <><span className="spinner" /> Publicando...</> : '🔓 Publicar'}
              </button>
            )
          )}

          {/* Botões de preview */}
          {genResult && (
            <>
              <button className="btn btn-success btn-sm" onClick={publishPreview} disabled={saving}>
                {saving ? <><span className="spinner" /> Salvando...</> : '✓ Salvar escala'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={discardPreview} disabled={saving}>
                Descartar
              </button>
            </>
          )}

          {/* Menu de ações */}
          <div className="escala-action-menu" ref={menuRef}>
            <button
              className={`escala-menu-trigger${actionsOpen ? ' open' : ''}`}
              onClick={() => setActionsOpen(o => !o)}
              title="Ações da escala"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="12" cy="5"  r="1.2" fill="currentColor" stroke="none"/>
                <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
                <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none"/>
              </svg>
            </button>
            {actionsOpen && (
              <div className="escala-action-dropdown">
                <button
                  className="escala-action-item"
                  onClick={() => { setActionsOpen(false); openGenModal(); }}
                  disabled={loading || !nurses.length}
                >
                  <span className="escala-action-icon">✨</span>
                  <span>Gerar escala</span>
                </button>
                <button
                  className="escala-action-item escala-action-item--danger"
                  onClick={() => { setActionsOpen(false); setClearConfirm(true); }}
                  disabled={loading || !nurses.length}
                >
                  <span className="escala-action-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                    </svg>
                  </span>
                  <span>Limpar escala</span>
                </button>
                {isPublished && (
                  <button
                    className="escala-action-item escala-action-item--danger"
                    onClick={() => { setActionsOpen(false); revokePublication(); }}
                    disabled={pubLoading}
                  >
                    <span className="escala-action-icon">🔒</span>
                    <span>Revogar publicação</span>
                  </button>
                )}
                <div className="escala-action-divider" />
                <button
                  className="escala-action-item"
                  onClick={() => { setActionsOpen(false); printSchedule(); }}
                >
                  <span className="escala-action-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
                    </svg>
                  </span>
                  <span>Imprimir escala</span>
                </button>
              </div>
            )}
          </div>

          <div className="month-nav">
            <button className="btn btn-ghost btn-sm" onClick={prevMonth}>‹</button>
            <span className="month-label">{MONTH_NAMES[month]} {year}</span>
            <button className="btn btn-ghost btn-sm" onClick={nextMonth}>›</button>
          </div>
        </div>
      </div>

      {/* Banner de preview */}
      {genResult && (
        <div className="preview-banner" style={{ marginBottom: 'var(--sp-4)' }}>
          ⚠ Pré-visualização não publicada — revise e publique ou descarte.
        </div>
      )}

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding: 60 }}>
          <span className="spinner spinner-lg" />
        </div>
      ) : (
        <>
          {/* Calendário */}
          <div className="escala-wrapper">
            <table className="escala-table">
              <thead>
                <tr>
                  <th className="nurse-col">Funcionária</th>
                  {Array.from({ length: days }, (_, i) => {
                    const d   = new Date(year, month, i + 1);
                    const dow = d.getDay();
                    const isSun   = dow === 0;
                    const isSat   = dow === 6;
                    const isToday = now.getMonth() === month && now.getFullYear() === year && now.getDate() === i + 1;
                    return (
                      <th
                        key={`h-${i}`}
                        className={`day-col${isSun ? ' sunday' : isSat ? ' saturday' : ''}${isToday ? ' today' : ''}`}
                      >
                        <span className="day-num">{i + 1}</span>
                        <span className="day-dow">{DOW_LETTERS[dow]}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {nurses.map(nurse => (
                  <tr key={nurse.id}>
                    <td className="nurse-name">
                      <span className="nurse-initials">{nurse.initials}</span>
                      {nurse.name}
                    </td>
                    {Array.from({ length: days }, (_, i) => {
                      const day     = i + 1;
                      const code    = displaySchedule[`${nurse.id}_${day}`] ?? 'OFF';
                      const shift   = SHIFTS[code] ?? SHIFTS.OFF;
                      const cellKey = `${nurse.id}-${year}-${month}-${day}`;
                      const isToday = now.getMonth() === month && now.getFullYear() === year && now.getDate() === day;
                      const isPreview = genResult
                        && genResult.schedule[nurse.id]?.[`d${day}`] !== undefined
                        && schedule[`${nurse.id}_${day}`] !== code;
                      const tdClass = [
                        isToday ? 'day-cell--today' : '',
                        code === 'OFF' ? 'cell-off' : '',
                      ].filter(Boolean).join(' ') || undefined;

                      return (
                        <td
                          key={cellKey}
                          className={tdClass}
                          style={isPreview ? { outline: '2px dashed var(--warning, #f59e0b)' } : undefined}
                          onClick={() => !genResult && openCellEdit(nurse, day)}
                          title={genResult ? undefined : `Editar ${nurse.name} — dia ${day}`}
                        >
                          {code !== 'OFF' && (
                            <span
                              className="shift-chip"
                              style={{ background: shift.color, color: shift.text }}
                              title={shift.name + (isPreview ? ' (preview)' : '')}
                            >
                              {code}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Matriz de estatísticas */}
          <div className="stats-matrix">
            <h3 className="stats-title">Resumo do mês — {MONTH_NAMES[month]} {year}</h3>
            <div className="stats-wrapper">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="stats-nurse-col">Funcionária</th>
                    {SHIFT_CODES.map(code => (
                      <th key={code} className="stats-shift-col">
                        <span className="shift-chip" style={{ background: SHIFTS[code].color, color: SHIFTS[code].text }}>
                          {code}
                        </span>
                      </th>
                    ))}
                    <th className="stats-sep" />
                    {DOW_LABELS.map(d => <th key={d} className="stats-dow-col">{d}</th>)}
                    <th className="stats-sep" />
                    <th className="stats-total-col">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map(({ nurse, shiftCounts, totalHours, dowCounts }) => (
                    <tr key={nurse.id}>
                      <td className="stats-nurse-name">
                        <span className="nurse-initials">{nurse.initials}</span>
                        {nurse.name}
                      </td>
                      {SHIFT_CODES.map(code => (
                        <td key={code} className="stats-val">
                          {shiftCounts[code] ?? <span className="stats-zero">—</span>}
                        </td>
                      ))}
                      <td className="stats-sep" />
                      {DOW_INDICES.map((dow, i) => (
                        <td key={i} className="stats-val">
                          {dowCounts[dow] || <span className="stats-zero">—</span>}
                        </td>
                      ))}
                      <td className="stats-sep" />
                      <td className="stats-total">{totalHours}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Legenda */}
      <div className="shifts-legend">
        {Object.entries(SHIFTS).filter(([k]) => k !== 'OFF').map(([code, s]) => (
          <div key={code} className="legend-item">
            <span className="shift-chip" style={{ background: s.color, color: s.text }}>{code}</span>
            <span className="legend-label">{s.name}</span>
          </div>
        ))}
      </div>

      {/* Modal de confirmação — Limpar escala */}
      {clearConfirm && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setClearConfirm(false)}>
          <div className="modal scale-in" style={{ maxWidth: 420 }}>
            <h3 style={{ marginBottom: 8 }}>Limpar escala</h3>
            <p className="text-secondary" style={{ fontSize: 14, marginBottom: 20 }}>
              Isso vai apagar <strong>todos os turnos</strong> de <strong>{MONTH_NAMES[month]} {year}</strong> para todas as enfermeiras. Essa ação não pode ser desfeita.
            </p>
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setClearConfirm(false)}>Cancelar</button>
              <button className="btn btn-danger" onClick={clearSchedule}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/>
                </svg>
                Limpar tudo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de geração */}
      {genModal && (
        <div className="modal-backdrop" onClick={e => !genRunning && e.target === e.currentTarget && setGenModal(false)}>
          <div className="modal scale-in" style={{ maxWidth: 520 }}>
            <h3 style={{ marginBottom: 4 }}>Gerar escala — {MONTH_NAMES[month]} {year}</h3>
            <p className="text-secondary" style={{ fontSize: 13, marginBottom: 16 }}>
              Defina o limite mensal de horas por enfermeira. Solver Monte Carlo (1200 epochs).
            </p>
            <div className="form-field" style={{ marginBottom: 12 }}>
              <label>Gerar a partir do dia</label>
              <input
                type="number" min={1} max={days}
                value={genStartDay}
                onChange={e => setGenStartDay(Math.max(1, Math.min(days, Number(e.target.value) || 1)))}
                disabled={genRunning}
              />
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Dias anteriores são preservados.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8, alignItems: 'center', marginBottom: 16 }}>
              {nurses.map(n => (
                <Fragment key={n.id}>
                  <label htmlFor={`hl-${n.id}`} style={{ fontSize: 14 }}>{n.name}</label>
                  <input
                    id={`hl-${n.id}`}
                    type="number" min={0} max={300} step={0.5}
                    value={genHourLimits[n.id] ?? 130}
                    onChange={e => setGenHourLimits(prev => ({ ...prev, [n.id]: Number(e.target.value) }))}
                    disabled={genRunning}
                    style={{ width: '100%' }}
                  />
                </Fragment>
              ))}
            </div>
            {genRunning && genProgress && (
              <div style={{ marginBottom: 12, padding: 12, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                <p style={{ fontSize: 13, marginBottom: 6 }}>Epoch <strong>{genProgress.epoch ?? 0}</strong> / 1200</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Fitness: {Math.round(genProgress.fitness ?? 0).toLocaleString('pt-BR')} · Vagas: {genProgress.emptyShifts ?? 0}
                </p>
              </div>
            )}
            {genError && <div className="alert alert-error" style={{ marginBottom: 12 }}>{genError}</div>}
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setGenModal(false)} disabled={genRunning}>Cancelar</button>
              <button className="btn btn-primary" onClick={runGenerate} disabled={genRunning}>
                {genRunning ? <><span className="spinner" /> Gerando...</> : '✨ Gerar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de edição de célula */}
      {cellEdit && (
        <div className="modal-backdrop" onClick={e => !cellSaving && e.target === e.currentTarget && setCellEdit(null)}>
          <div className="modal scale-in cell-edit-modal">
            <div className="cell-edit-header">
              <div>
                <h3>{cellEdit.nurseName}</h3>
                <p className="text-secondary" style={{ fontSize: 13 }}>
                  {cellEdit.day} de {MONTH_NAMES[month]} {year}
                </p>
              </div>
            </div>
            <div className="cell-edit-options">
              {Object.entries(SHIFTS).filter(([k]) => k !== 'OFF').map(([code, s]) => (
                <button
                  key={code}
                  className={`cell-edit-btn${cellEdit.currentCode === code ? ' cell-edit-btn--active' : ''}`}
                  onClick={() => handleCellEdit(code)}
                  disabled={cellSaving}
                >
                  <span className="shift-chip" style={{ background: s.color, color: s.text }}>{code}</span>
                  <span className="cell-edit-name">{s.name}</span>
                  <span className="cell-edit-hours">{s.hours}h</span>
                </button>
              ))}
              <button
                className={`cell-edit-btn cell-edit-btn--off${!cellEdit.currentCode || cellEdit.currentCode === 'OFF' ? ' cell-edit-btn--active' : ''}`}
                onClick={() => handleCellEdit('OFF')}
                disabled={cellSaving}
              >
                <span className="shift-chip" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>—</span>
                <span className="cell-edit-name">Folga / Dia off</span>
                <span className="cell-edit-hours">0h</span>
              </button>
            </div>
            <button
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setCellEdit(null)}
              disabled={cellSaving}
            >
              {cellSaving ? <><span className="spinner" /> Salvando...</> : 'Cancelar'}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast-bar ${toast.type === 'success' ? 'toast-success' : toast.type === 'danger' ? 'toast-danger' : ''}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
