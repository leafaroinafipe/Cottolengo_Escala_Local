/* ─────────────────────────────────────────────────────────────────────
 *  scheduleSolver.js
 *  Wrapper que orquestra o Web Worker (public/escala-worker.js).
 *
 *  Conversão de formato:
 *    Firestore (novo):   escalas/{nurseId}_{year}_{monthNum=1-12}
 *                        com campos { d1: 'M1', d2: 'OFF', ... }
 *
 *    Worker (legado):    flat map { `${nurseId}_${m}_${y}_${d}` : code }
 *                        com m em 0-11
 *
 *  Estratégia: ler mês atual + mês anterior do Firestore, converter para
 *  o formato flat, mandar pro worker. O worker devolve a escala gerada
 *  para o mês atual; convertemos de volta para um doc por enfermeira.
 * ───────────────────────────────────────────────────────────────────── */

import {
  collection, doc, getDoc, getDocs, writeBatch, serverTimestamp, query, where,
} from 'firebase/firestore';
import { db, auth } from '../firebase';

/* Converte "YYYY-MM-DD" ou "DD/MM/YYYY" → { year, month, day } | null */
function parseDate(str) {
  if (!str) return null;
  if (str.includes('-')) {
    const [y, m, d] = str.split('-').map(Number);
    return (isNaN(y) || isNaN(m) || isNaN(d)) ? null : { year: y, month: m, day: d };
  }
  if (str.includes('/')) {
    const [d, m, y] = str.split('/').map(Number);
    return (isNaN(y) || isNaN(m) || isNaN(d)) ? null : { year: y, month: m, day: d };
  }
  return null;
}

/* Carrega escala do mês {y, m=0-11} para todas as enfermeiras e devolve
 * no formato flat esperado pelo worker. */
async function loadFlatSchedule(nurses, y, m) {
  const monthNum = m + 1;
  const flat = {};
  await Promise.all(
    nurses.map(async (n) => {
      const snap = await getDoc(doc(db, 'escalas', `${n.id}_${y}_${monthNum}`));
      if (!snap.exists()) return;
      const data = snap.data();
      for (let d = 1; d <= 31; d++) {
        const code = data[`d${d}`];
        if (code) flat[`${n.id}_${m}_${y}_${d}`] = code;
      }
    }),
  );
  return flat;
}


/* Roda o solver no worker. Resolve com { scheduleModel, fitness, emptyShifts, epochs }. */
function runWorker({ NURSES, schedule, hourLimits, m, y, startDay, onProgress }) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      // Vite serve `public/` na raiz (depois do `base` do vite.config).
      // import.meta.env.BASE_URL = '/Cottolengo_Escala_Local/' em produção.
      const url = `${import.meta.env.BASE_URL}escala-worker.js?v=3.0`;
      worker = new Worker(url);
    } catch (e) {
      reject(new Error('Worker não pôde ser criado: ' + e.message));
      return;
    }

    worker.onmessage = (ev) => {
      const data = ev.data || {};
      if (data.progress) {
        onProgress?.({ epoch: data.epoch, fitness: data.bestFitness, emptyShifts: data.emptyShifts });
        return;
      }
      worker.terminate();
      if (!data.ok) {
        reject(new Error(data.error || 'Worker reportou erro'));
        return;
      }
      resolve(data);
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error('Worker onerror: ' + (err.message || 'unknown')));
    };

    worker.postMessage({
      NURSES,
      schedule,
      occurrences: [],
      requests: [],
      hourLimits,
      m, y,
      startDay,
      MAX_EPOCHS: 1200,
    });
  });
}

/* API principal: gera escala para o mês {y, m=0-11} e retorna o resultado
 * em formato pronto pra preview. NÃO grava no Firestore — quem chama decide
 * se aceita o resultado e chama saveGeneratedSchedule(). */
export async function generateSchedule({ nurses, year, month, hourLimits, startDay = 1, onProgress }) {
  // Mescla mês atual + mês anterior (para contexto dos últimos 4 dias)
  const [curr, prev] = await Promise.all([
    loadFlatSchedule(nurses, year, month),
    loadFlatSchedule(nurses, month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1),
  ]);
  const incoming = { ...prev, ...curr };

  const result = await runWorker({
    NURSES: nurses,
    schedule: incoming,
    hourLimits,
    m: month,
    y: year,
    startDay,
    onProgress,
  });

  // Converte saída flat de volta para per-nurse map { [nurseId]: { d1: 'M1', ... } }
  const days = new Date(year, month + 1, 0).getDate();
  const perNurse = Object.fromEntries(nurses.map(n => [n.id, {}]));
  for (const key in result.scheduleModel) {
    // chave: `${nurseId}_${m}_${y}_${d}`
    const idx2 = key.lastIndexOf('_');
    const idx3 = key.lastIndexOf('_', idx2 - 1);
    const idx4 = key.lastIndexOf('_', idx3 - 1);
    const nurseId = key.slice(0, idx4);
    const d = parseInt(key.slice(idx2 + 1), 10);
    if (d < startDay || d > days) continue;
    if (!perNurse[nurseId]) perNurse[nurseId] = {};
    perNurse[nurseId][`d${d}`] = result.scheduleModel[key];
  }

  // Re-aplica aprovações do Firestore para proteger folgas/férias já aprovadas.
  // O worker pode sobrescrever esses dias — aqui garantimos que ficam intactos.
  const approvedSnap = await getDocs(query(
    collection(db, 'solicitacoes'),
    where('status', '==', 'aprovada'),
  ));
  const targetMonthNum = month + 1;
  approvedSnap.forEach(docSnap => {
    const r = docSnap.data();
    if (r.tipo === 'folga') {
      const p = parseDate(r.dataFolga);
      if (!p || p.year !== year || p.month !== targetMonthNum) return;
      if (perNurse[r.nurseId]) perNurse[r.nurseId][`d${p.day}`] = 'OFF';
    } else if (r.tipo === 'ferias') {
      const start = parseDate(r.dataInicio);
      const end   = parseDate(r.dataFim);
      if (!start || !end) return;
      const cur = new Date(start.year, start.month - 1, start.day);
      const endDate = new Date(end.year, end.month - 1, end.day);
      while (cur <= endDate) {
        if (cur.getFullYear() === year && cur.getMonth() + 1 === targetMonthNum) {
          if (perNurse[r.nurseId]) perNurse[r.nurseId][`d${cur.getDate()}`] = 'FE';
        }
        cur.setDate(cur.getDate() + 1);
      }
    }
    // Swaps já foram materializados no Firestore via runTransaction e estão em `incoming`.
    // O worker os recebe como estado pré-existente e os preserva na saída.
  });

  return {
    schedule: perNurse,
    fitness: result.fitness,
    emptyShifts: result.emptyShifts,
    epochs: result.epochs,
  };
}

/* Persiste a escala gerada no Firestore. O mapa `schedule` já vem com chaves
 * apenas para os dias gerados (>= startDay), então o merge preserva o passado. */
export async function saveGeneratedSchedule({ schedule, year, month }) {
  const monthNum = month + 1;
  const decidedBy = auth.currentUser?.uid ?? null;
  const batch = writeBatch(db);

  for (const [nurseId, days] of Object.entries(schedule)) {
    const ref = doc(db, 'escalas', `${nurseId}_${year}_${monthNum}`);
    const payload = { ...days, atualizadaEm: serverTimestamp(), atualizadaPor: decidedBy };
    batch.set(ref, payload, { merge: true });
  }

  await batch.commit();
  return { ok: true };
}
