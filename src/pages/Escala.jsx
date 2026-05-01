import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { SHIFTS, NURSES_DEFAULT } from '../constants/shifts';
import './Escala.css';

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function padDate(n) { return String(n).padStart(2, '0'); }

export default function Escala() {
  const now   = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based

  const [nurses,   setNurses]   = useState(NURSES_DEFAULT);
  const [schedule, setSchedule] = useState({});
  const [loading,  setLoading]  = useState(true);

  const days = daysInMonth(year, month);

  /* Carrega funcionários do Firestore */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'funcionarios'), snap => {
      if (!snap.empty) setNurses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  /* Carrega escala do mês atual com onSnapshot */
  useEffect(() => {
    setLoading(true);
    const monthStr = `${year}-${padDate(month + 1)}`;
    const q = query(collection(db, 'escala'), where('mes', '==', monthStr));
    const unsub = onSnapshot(q, snap => {
      const map = {};
      snap.docs.forEach(d => {
        const { nurseId, dia, turno } = d.data();
        map[`${nurseId}_${dia}`] = turno;
      });
      setSchedule(map);
      setLoading(false);
    });
    return unsub;
  }, [year, month]);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                       'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  return (
    <div className="page page-escala fade-in">
      <div className="page-header">
        <div>
          <h1>Escala</h1>
          <p className="text-secondary">Visualização completa da equipe</p>
        </div>
        <div className="month-nav">
          <button className="btn btn-ghost btn-sm" onClick={prevMonth}>‹</button>
          <span className="month-label">{MONTH_NAMES[month]} {year}</span>
          <button className="btn btn-ghost btn-sm" onClick={nextMonth}>›</button>
        </div>
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding: 60 }}>
          <span className="spinner spinner-lg" />
        </div>
      ) : (
        <div className="escala-wrapper">
          <table className="escala-table">
            <thead>
              <tr>
                <th className="nurse-col">Funcionária</th>
                {Array.from({ length: days }, (_, i) => {
                  const d = new Date(year, month, i + 1);
                  const dow = d.getDay();
                  const isSun = dow === 0;
                  const isSat = dow === 6;
                  return (
                    <th key={i} className={`day-col${isSun ? ' sunday' : isSat ? ' saturday' : ''}`}>
                      <span className="day-num">{i + 1}</span>
                      <span className="day-dow">
                        {['D','S','T','Q','Q','S','S'][dow]}
                      </span>
                    </th>
                  );
                })}
                <th className="total-col">Horas</th>
              </tr>
            </thead>
            <tbody>
              {nurses.map(nurse => {
                let totalHours = 0;
                return (
                  <tr key={nurse.id}>
                    <td className="nurse-name">
                      <span className="nurse-initials">{nurse.initials}</span>
                      {nurse.name}
                    </td>
                    {Array.from({ length: days }, (_, i) => {
                      const code  = schedule[`${nurse.id}_${i + 1}`] ?? 'OFF';
                      const shift = SHIFTS[code] ?? SHIFTS.OFF;
                      totalHours += shift.hours;
                      if (code === 'OFF') return <td key={i} className="cell-off" />;
                      return (
                        <td key={i}>
                          <span
                            className="shift-chip"
                            style={{ background: shift.color, color: shift.text }}
                            title={shift.name}
                          >
                            {code}
                          </span>
                        </td>
                      );
                    })}
                    <td className="total-hours">{totalHours}h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="shifts-legend">
        {Object.entries(SHIFTS).filter(([k]) => k !== 'OFF').map(([code, s]) => (
          <div key={code} className="legend-item">
            <span className="shift-chip" style={{ background: s.color, color: s.text }}>{code}</span>
            <span className="legend-label">{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
