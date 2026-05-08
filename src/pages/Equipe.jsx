import { useEffect, useState } from 'react';
import {
  collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword,
  signOut as firebaseSignOut, sendPasswordResetEmail,
} from 'firebase/auth';
import { db, firebaseConfig } from '../firebase';
import { NURSES_DEFAULT } from '../constants/shifts';
import './Equipe.css';

/* ── Cria conta Firebase Auth usando instância secundária (não desloga a coordenadora) ── */
async function createAuthAccount(email, password) {
  const appName = `nurse-create-${Date.now()}`;
  const secondaryApp  = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await sendPasswordResetEmail(secondaryAuth, email);
    return cred.user.uid;
  } finally {
    await firebaseSignOut(secondaryAuth);
    await deleteApp(secondaryApp);
  }
}

export default function Equipe() {
  const [nurses,    setNurses]    = useState([]);
  const [loading,   setLoading]   = useState(true);

  /* modal editar / nova funcionária */
  const [modal,     setModal]     = useState(false);
  const [form,      setForm]      = useState({ name: '', initials: '', nightQuota: 5, email: '' });
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState('');

  /* modal confirmar remoção */
  const [deleteTarget, setDeleteTarget] = useState(null);

  /* modal criar login */
  const [loginModal,    setLoginModal]    = useState(false);
  const [loginNurse,    setLoginNurse]    = useState(null);
  const [loginForm,     setLoginForm]     = useState({ email: '', password: '' });
  const [loginSaving,   setLoginSaving]   = useState(false);
  const [loginError,    setLoginError]    = useState('');
  const [loginSuccess,  setLoginSuccess]  = useState('');
  const [showPassword,  setShowPassword]  = useState(false);

  useEffect(() => {
    let cancelled = false;
    const unsub = onSnapshot(collection(db, 'funcionarios'), async snap => {
      if (cancelled) return;
      if (snap.empty) {
        const batch = writeBatch(db);
        NURSES_DEFAULT.forEach(n => {
          batch.set(doc(db, 'funcionarios', n.id), {
            name: n.name,
            initials: n.initials,
            nightQuota: n.nightQuota,
            email: '',
            atualizadaEm: serverTimestamp(),
          });
        });
        try {
          await batch.commit();
        } catch (err) {
          console.error('[equipe] seed default failed:', err);
        }
        // listener vai disparar de novo após o commit; mantemos loading=true
        // até a coleção popular para evitar flash de tela vazia.
      } else {
        setNurses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
      setLoading(false);
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  /* ── Salvar funcionária (criar / editar) ── */
  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const id = form.id ?? `n${Date.now()}`;
      await setDoc(doc(db, 'funcionarios', id), {
        name:        form.name,
        initials:    form.initials.toUpperCase(),
        nightQuota:  Number(form.nightQuota),
        email:       form.email,
        atualizadaEm: serverTimestamp(),
      });
      setModal(false);
      setForm({ name: '', initials: '', nightQuota: 5, email: '' });
    } catch (err) {
      setSaveError(`Erro ao salvar: ${err.code ?? err.message}`);
    } finally {
      setSaving(false);
    }
  }

  function openEdit(nurse) {
    setForm({ ...nurse });
    setSaveError('');
    setModal(true);
  }

  function openNew() {
    setForm({ name: '', initials: '', nightQuota: 5, email: '' });
    setSaveError('');
    setModal(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await deleteDoc(doc(db, 'funcionarios', deleteTarget.id));
    setDeleteTarget(null);
  }

  /* ── Criar login ── */
  function openLoginModal(nurse) {
    setLoginNurse(nurse);
    setLoginForm({ email: nurse.email ?? '', password: '' });
    setLoginError('');
    setLoginSuccess('');
    setShowPassword(false);
    setLoginModal(true);
  }

  async function handleCreateLogin(e) {
    e.preventDefault();
    setLoginSaving(true);
    setLoginError('');
    setLoginSuccess('');
    try {
      const uid = await createAuthAccount(loginForm.email, loginForm.password);

      /* Cria doc usuarios/{uid} com role + nurseId */
      await setDoc(doc(db, 'usuarios', uid), {
        role:    'nurse',
        nurseId: loginNurse.id,
        name:    loginNurse.name,
        email:   loginForm.email,
      });

      /* Marca hasLogin na funcionária e atualiza e-mail se mudou */
      await updateDoc(doc(db, 'funcionarios', loginNurse.id), {
        hasLogin:    true,
        email:       loginForm.email,
        atualizadaEm: serverTimestamp(),
      });

      setLoginSuccess(`Conta criada! E-mail de redefinição de senha enviado para ${loginForm.email}.`);
    } catch (err) {
      const msgs = {
        'auth/email-already-in-use': 'Já existe uma conta com esse e-mail. Use "Enviar reset de senha" no app Mobile.',
        'auth/invalid-email':        'E-mail inválido.',
        'auth/weak-password':        'Senha fraca. Use pelo menos 6 caracteres.',
      };
      setLoginError(msgs[err.code] ?? `Erro: ${err.code ?? err.message}`);
    } finally {
      setLoginSaving(false);
    }
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
        <div style={{ display:'flex', justifyContent:'center', padding:60 }}>
          <span className="spinner spinner-lg" />
        </div>
      ) : (
        <div className="nurses-grid">
          {nurses.map(nurse => (
            <div key={nurse.id} className="nurse-card card">
              <div className="nurse-card-header">
                <div className="nurse-avatar-lg">{nurse.initials}</div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <p className="nurse-card-name">{nurse.name}</p>
                    {nurse.hasLogin && (
                      <span className="badge badge-approved" style={{ fontSize: 10, padding: '2px 6px' }}>✓ Login</span>
                    )}
                  </div>
                  {nurse.email && <p className="text-secondary" style={{ fontSize: 12 }}>{nurse.email}</p>}
                </div>
              </div>
              <div className="nurse-card-info">
                <span>Quota noturna: <strong>{nurse.nightQuota}</strong></span>
              </div>
              <div className="nurse-card-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(nurse)}>Editar</button>
                <button className="btn btn-primary btn-sm" onClick={() => openLoginModal(nurse)}>
                  {nurse.hasLogin ? '🔑 Recriar' : '🔑 Criar login'}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(nurse)}>Remover</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal editar / nova funcionária ── */}
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
              {saveError && <p style={{ color: 'var(--error)', fontSize: 13 }}>{saveError}</p>}
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

      {/* ── Modal criar login ── */}
      {loginModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setLoginModal(false)}>
          <div className="modal scale-in">
            <h3 style={{ marginBottom: 4 }}>Criar login — {loginNurse?.name}</h3>
            <p className="text-secondary" style={{ fontSize: 13, marginBottom: 20 }}>
              Uma conta de acesso será criada e um e-mail de redefinição de senha será enviado automaticamente.
            </p>

            {loginSuccess ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="alert" style={{ background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 'var(--radius-md)', padding: '12px 14px', fontSize: 14 }}>
                  ✓ {loginSuccess}
                </div>
                <button className="btn btn-ghost" onClick={() => setLoginModal(false)}>Fechar</button>
              </div>
            ) : (
              <form onSubmit={handleCreateLogin} className="form-grid">
                <div className="form-field">
                  <label>E-mail de acesso</label>
                  <input
                    type="email"
                    required
                    value={loginForm.email}
                    onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="enfermeira@email.com"
                  />
                </div>
                <div className="form-field">
                  <label>Senha temporária</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={loginForm.password}
                      onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="Mínimo 6 caracteres"
                      style={{ paddingRight: 44 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, opacity: 0.6 }}
                    >
                      {showPassword ? '🙈' : '👁'}
                    </button>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    A enfermeira receberá um e-mail para criar a própria senha.
                  </p>
                </div>

                {loginError && (
                  <p style={{ color: 'var(--error)', fontSize: 13 }}>{loginError}</p>
                )}

                <div className="form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setLoginModal(false)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary" disabled={loginSaving}>
                    {loginSaving ? <><span className="spinner" />Criando...</> : 'Criar conta'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Modal confirmar remoção ── */}
      {deleteTarget && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setDeleteTarget(null)}>
          <div className="modal scale-in" style={{ maxWidth: 360 }}>
            <h3 style={{ marginBottom: 10 }}>Remover funcionária?</h3>
            <p className="text-secondary" style={{ fontSize: 14, marginBottom: 24 }}>
              <strong>{deleteTarget.name}</strong> será removida permanentemente. Esta ação não pode ser desfeita.
            </p>
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={confirmDelete}>Remover</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
