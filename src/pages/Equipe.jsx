import { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { NURSES_DEFAULT } from '../constants/shifts';
import './Equipe.css';

export default function Equipe() {
  const [nurses,  setNurses]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [form,    setForm]    = useState({ name: '', initials: '', nightQuota: 5, email: '' });
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'funcionarios'), snap => {
      if (snap.empty) setNurses(NURSES_DEFAULT);
      else setNurses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    const id = form.id ?? `n${Date.now()}`;
    await setDoc(doc(db, 'funcionarios', id), {
      name: form.name,
      initials: form.initials.toUpperCase(),
      nightQuota: Number(form.nightQuota),
      email: form.email,
      atualizadaEm: serverTimestamp(),
    });
    setSaving(false);
    setModal(false);
    setForm({ name: '', initials: '', nightQuota: 5, email: '' });
  }

  function openEdit(nurse) {
    setForm({ ...nurse });
    setModal(true);
  }

  function openNew() {
    setForm({ name: '', initials: '', nightQuota: 5, email: '' });
    setModal(true);
  }

  async function handleDelete(id) {
    if (!confirm('Remover funcionária?')) return;
    await deleteDoc(doc(db, 'funcionarios', id));
  }

  return (
    <div className="page page-equipe fade-in">
      <div className="page-header">
        <div>
          <h1>Equipe</h1>
          <p className="text-secondary">{nurses.length} funcionária{nurses.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Adicionar</button>
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:60 }}><span className="spinner spinner-lg" /></div>
      ) : (
        <div className="nurses-grid">
          {nurses.map(nurse => (
            <div key={nurse.id} className="nurse-card card">
              <div className="nurse-card-header">
                <div className="nurse-avatar-lg">{nurse.initials}</div>
                <div>
                  <p className="nurse-card-name">{nurse.name}</p>
                  {nurse.email && <p className="text-secondary" style={{ fontSize: 12 }}>{nurse.email}</p>}
                </div>
              </div>
              <div className="nurse-card-info">
                <span>Quota noturna: <strong>{nurse.nightQuota}</strong></span>
              </div>
              <div className="nurse-card-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(nurse)}>Editar</button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(nurse.id)}>Remover</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="modal scale-in">
            <h3 style={{ marginBottom: 20 }}>{form.id ? 'Editar' : 'Nova'} funcionária</h3>
            <form onSubmit={handleSave} className="form-grid">
              <div className="form-field">
                <label>Nome completo</label>
                <input value={form.name} onChange={e => setForm(f=>({...f, name: e.target.value}))} required />
              </div>
              <div className="form-field">
                <label>Iniciais (ex: BS)</label>
                <input value={form.initials} onChange={e => setForm(f=>({...f, initials: e.target.value}))} maxLength={3} required />
              </div>
              <div className="form-field">
                <label>E-mail</label>
                <input type="email" value={form.email} onChange={e => setForm(f=>({...f, email: e.target.value}))} />
              </div>
              <div className="form-field">
                <label>Quota de noites/mês</label>
                <input type="number" min={0} max={20} value={form.nightQuota} onChange={e => setForm(f=>({...f, nightQuota: e.target.value}))} required />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" />Salvando...</> : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
