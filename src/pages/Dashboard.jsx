import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { SHIFTS, NURSES_DEFAULT } from '../constants/shifts';
import './Dashboard.css';

/* ─── Constantes ─── */
const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTH_ABR   = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const DOW_LETTERS = ['D','S','T','Q','Q','S','S'];
const SHIFT_CODES = ['M1','M2','MF','G','P','PF','N','OFF','FE','AT'];
const ACTIVE      = ['M1','M2','MF','G','P','PF','N'];
const NIGHT_ANNUAL_TARGET = 60;

/* ─── Helpers ─── */
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

function getHolidays(year) {
  const fixed = [[0,1],[0,6],[3,25],[4,1],[5,2],[7,15],[10,1],[11,8],[11,25],[11,26]];
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,
        f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,
        i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,mz=Math.floor((a+11*h+22*l)/451),
        em=Math.floor((h+l-7*mz+114)/31)-1,ed=((h+l-7*mz+114)%31)+1;
  const em2=new Date(year,em,ed+1);
  fixed.push([em,ed],[em2.getMonth(),em2.getDate()]);
  return fixed;
}
function isFestivo(date) {
  const dow=date.getDay();
  if(dow===0||dow===6) return true;
  return getHolidays(date.getFullYear()).some(([m,d])=>m===date.getMonth()&&d===date.getDate());
}
function fmt1(n) { return Number.isInteger(n) ? n.toString() : n.toFixed(1); }

/* ════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const now = new Date();
  const [mode,   setMode]   = useState('monthly');
  const [year,   setYear]   = useState(now.getFullYear());
  const [month,  setMonth]  = useState(now.getMonth());
  const [nurses, setNurses] = useState(NURSES_DEFAULT);

  const [scheduleMap,  setScheduleMap]  = useState({});
  const [annualMap,    setAnnualMap]    = useState({});
  const [reqStats,     setReqStats]     = useState({ pending:0, approved:0, rejected:0, ferie:0, certif:0 });
  const [loading,      setLoading]      = useState(true);
  const [annualLoading,setAnnualLoading]= useState(false);

  /* Nurses */
  useEffect(() => onSnapshot(collection(db,'funcionarios'), snap => {
    if (!snap.empty) setNurses(snap.docs.map(d=>({id:d.id,...d.data()})));
  }), []);

  /* Monthly schedule */
  useEffect(() => {
    if (!nurses.length || mode !== 'monthly') return;
    let cancelled = false;
    setLoading(true);
    const mn = month + 1;
    Promise.all(nurses.map(n => getDoc(doc(db,'escalas',`${n.id}_${year}_${mn}`))))
      .then(snaps => {
        if (cancelled) return;
        const map = {};
        snaps.forEach((snap, i) => {
          const nid = nurses[i].id;
          map[nid] = {};
          if (snap.exists()) {
            const data = snap.data();
            for (let d=1;d<=31;d++) if(data[`d${d}`]) map[nid][d]=data[`d${d}`];
          }
        });
        setScheduleMap(map);
        setLoading(false);
      })
      .catch(() => { if(!cancelled) setLoading(false); });
    return () => { cancelled=true; };
  }, [nurses, year, month, mode]);

  /* Annual schedule */
  useEffect(() => {
    if (!nurses.length || mode !== 'annual') return;
    let cancelled = false;
    setAnnualLoading(true);
    const allIds = [];
    for (let m=1;m<=12;m++) nurses.forEach(n => allIds.push({nurseId:n.id,m}));
    Promise.all(allIds.map(({nurseId,m}) => getDoc(doc(db,'escalas',`${nurseId}_${year}_${m}`))))
      .then(snaps => {
        if (cancelled) return;
        const amap = {};
        nurses.forEach(n => { amap[n.id]={}; for(let m=1;m<=12;m++) amap[n.id][m]={}; });
        snaps.forEach((snap,idx) => {
          const {nurseId,m} = allIds[idx];
          if(snap.exists()) {
            const data=snap.data();
            for(let d=1;d<=31;d++) if(data[`d${d}`]) amap[nurseId][m][d]=data[`d${d}`];
          }
        });
        setAnnualMap(amap);
        setAnnualLoading(false);
      })
      .catch(() => { if(!cancelled) setAnnualLoading(false); });
    return () => { cancelled=true; };
  }, [nurses, year, mode]);

  /* Request stats */
  useEffect(() => onSnapshot(collection(db,'solicitacoes'), snap => {
    let pending=0,approved=0,rejected=0,ferie=0,certif=0;
    snap.docs.forEach(d=>{
      const r=d.data();
      if(r.status==='pendente')   pending++;
      else if(r.status==='aprovada')  approved++;
      else if(r.status==='rejeitada') rejected++;
      if(r.tipo==='ferias') ferie += (r.dataFim&&r.dataInicio) ? 1 : 0;
      if(r.tipo==='folga'&&r.status==='aprovada') certif++;
    });
    setReqStats({pending,approved,rejected,ferie,certif});
  }), []);

  /* ── Monthly Stats ── */
  const days = daysInMonth(year, month);

  const monthStats = useMemo(() => nurses.map(nurse => {
    const sched = scheduleMap[nurse.id] ?? {};
    const counts = Object.fromEntries(SHIFT_CODES.map(c=>[c,0]));
    let hours=0, festivi=0, diurneFer=0, diurneFest=0, notFer=0, notFest=0;
    for (let d=1;d<=days;d++) {
      const code = sched[d] ?? 'OFF';
      counts[code]=(counts[code]??0)+1;
      const shift=SHIFTS[code]; if(!shift) continue;
      hours += shift.hours;
      const fest = isFestivo(new Date(year,month,d));
      if (ACTIVE.includes(code)) {
        if(code==='N') { if(fest) notFest+=shift.hours; else notFer+=shift.hours; }
        else { if(fest) diurneFest+=shift.hours; else diurneFer+=shift.hours; }
        if(fest) festivi++;
      }
    }
    const worked = ACTIVE.reduce((s,c)=>s+(counts[c]??0),0);
    return { nurse, hours, worked, off:counts.OFF??0, nights:counts.N??0,
             ferie:counts.FE??0, certif:counts.AT??0, festivi, counts,
             diurneFer, diurneFest, notFer, notFest };
  }), [scheduleMap, nurses, year, month, days]);

  const monthAgg = useMemo(() => {
    const totalHours  = monthStats.reduce((s,n)=>s+n.hours,0);
    const totalNights = monthStats.reduce((s,n)=>s+n.nights,0);
    const totalFerie  = monthStats.reduce((s,n)=>s+n.ferie,0);
    const totalCertif = monthStats.reduce((s,n)=>s+n.certif,0);

    const dailyCoverage = Array.from({length:days},(_,i)=>{
      let cnt=0;
      nurses.forEach(n=>{ const c=(scheduleMap[n.id]??{})[i+1]??'OFF'; if(ACTIVE.includes(c)) cnt++; });
      return cnt;
    });

    let coveredDays=0;
    for(let d=1;d<=days;d++){
      const target=isFestivo(new Date(year,month,d))?3:4;
      if(dailyCoverage[d-1]>=target) coveredDays++;
    }
    const coveragePct = days>0 ? Math.round(coveredDays/days*100) : 0;

    const hrs = monthStats.map(n=>n.hours);
    const dispersion = hrs.length>1 ? Math.max(...hrs)-Math.min(...hrs) : 0;

    const absenceDays = totalFerie+totalCertif;
    const absenceRate = nurses.length>0 ? absenceDays/(nurses.length*days)*100 : 0;

    let workdays=0;
    for(let d=1;d<=days;d++) if(!isFestivo(new Date(year,month,d))) workdays++;
    const oreStandard = workdays*7.5;

    const sorted=[...monthStats].sort((a,b)=>b.hours-a.hours);
    return { totalHours, totalNights, totalFerie, totalCertif, dailyCoverage,
             coveragePct, nightTarget:days, dispersion, absenceDays, absenceRate,
             workdays, oreStandard, coveredDays,
             maxNurse:sorted[0], minNurse:sorted[sorted.length-1] };
  }, [monthStats, nurses, days, year, month, scheduleMap]);

  /* ── Annual Stats ── */
  const annualStats = useMemo(() => {
    if(mode!=='annual'||!nurses.length) return [];
    return nurses.map(nurse=>{
      const nurseAnnual = annualMap[nurse.id]??{};
      let totalHours=0,worked=0,nights=0,ferie=0,certif=0,festivi=0;
      const counts = Object.fromEntries(SHIFT_CODES.map(c=>[c,0]));
      const monthlyHours = {};
      for(let m=1;m<=12;m++){
        const sched=nurseAnnual[m]??{};
        const mdays=daysInMonth(year,m-1);
        let mH=0;
        for(let d=1;d<=mdays;d++){
          const code=sched[d]??'OFF'; counts[code]=(counts[code]??0)+1;
          const shift=SHIFTS[code]; if(!shift) continue;
          mH+=shift.hours;
          if(ACTIVE.includes(code)){
            worked++;
            if(code==='N') nights++;
            if(isFestivo(new Date(year,m-1,d))) festivi++;
          }
          if(code==='FE') ferie++;
          if(code==='AT') certif++;
        }
        totalHours+=mH;
        if(mH>0) monthlyHours[m]=mH;
      }
      return { nurse, hours:totalHours, worked, nights, ferie, certif, festivi, counts, monthlyHours };
    });
  }, [annualMap, nurses, year, mode]);

  const annualAgg = useMemo(()=>{
    if(!annualStats.length) return null;
    const totalHours=annualStats.reduce((s,n)=>s+n.hours,0);
    const totalWorked=annualStats.reduce((s,n)=>s+n.worked,0);
    const totalNights=annualStats.reduce((s,n)=>s+n.nights,0);
    const hrs=annualStats.map(n=>n.hours);
    const dispersion=hrs.length>1?Math.max(...hrs)-Math.min(...hrs):0;
    const restoDays=annualStats.reduce((s,n)=>s+(n.counts.OFF??0),0);
    return { totalHours, totalWorked, totalNights, dispersion, restoDays };
  }, [annualStats]);

  function prevPeriod() {
    if(mode==='monthly') { if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }
    else setYear(y=>y-1);
  }
  function nextPeriod() {
    if(mode==='monthly') { if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }
    else setYear(y=>y+1);
  }

  const isLoading = mode==='monthly' ? loading : annualLoading;

  return (
    <div className="page page-report fade-in">
      {/* ── Header ── */}
      <div className="report-header">
        <h1 className="report-title">
          <span>📊</span>
          {mode==='monthly' ? 'Relatório Operacional' : 'Dashboard Anual'}
        </h1>
        <div className="report-controls">
          <div className="mode-toggle">
            <button className={`mode-btn${mode==='monthly'?' active':''}`} onClick={()=>setMode('monthly')}>Mensal</button>
            <button className={`mode-btn${mode==='annual'?' active':''}`}  onClick={()=>setMode('annual')}>Anual</button>
          </div>
          <div className="period-nav">
            <button className="period-nav-btn" onClick={prevPeriod}>◀</button>
            <span className="period-label">
              {mode==='monthly'?`${MONTH_NAMES[month]} ${year}`:`Ano ${year}`}
            </span>
            <button className="period-nav-btn" onClick={nextPeriod}>▶</button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div style={{display:'flex',justifyContent:'center',padding:80}}>
          <span className="spinner spinner-lg"/>
        </div>
      ) : mode==='monthly' ? (
        <MonthlyReport
          year={year} month={month} days={days}
          nurses={nurses} monthStats={monthStats} monthAgg={monthAgg}
          reqStats={reqStats}
        />
      ) : (
        <AnnualReport
          year={year} nurses={nurses}
          annualStats={annualStats} annualAgg={annualAgg}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   RELATÓRIO MENSAL
   ════════════════════════════════════════════════════════════ */
function MonthlyReport({ year, month, days, nurses, monthStats, monthAgg, reqStats }) {
  const { totalHours, totalNights, totalFerie, totalCertif, dailyCoverage,
          coveragePct, nightTarget, dispersion, absenceRate, oreStandard,
          maxNurse, minNurse } = monthAgg;

  const rankSorted = [...monthStats].sort((a,b)=>b.hours-a.hours);

  /* Executive summary */
  const avgHours = nurses.length > 0 ? totalHours / nurses.length : 0;
  const uncovered = dailyCoverage.filter(c=>c===0).length;
  const loadOk = dispersion < 20;

  return (
    <>
      {/* Síntese Executiva */}
      <div className="exec-summary">
        <p className="exec-summary-title">📋 Síntese Executiva</p>
        <p>
          No mês de <strong>{MONTH_NAMES[month]} {year}</strong>, a equipe de{' '}
          <strong>{nurses.length} enfermeiras</strong> totalizou{' '}
          <strong>{fmt1(totalHours)}h</strong> de serviço (média{' '}
          <strong>{fmt1(avgHours)}h/pessoa</strong>) com{' '}
          <strong>{totalNights} turnos noturnos</strong>.{' '}
          A cobertura diária é{' '}
          {uncovered === 0
            ? <span style={{color:'#22c55e'}}>✅ completa</span>
            : <span style={{color:'#f59e0b'}}>⚠ {uncovered} dias descobertos</span>
          }.{' '}
          A distribuição de carga é{' '}
          {loadOk
            ? <span style={{color:'#22c55e'}}>✅ equilibrada</span>
            : <span style={{color:'#f59e0b'}}>⚠ desigual</span>
          }{' '}
          (dispersão {fmt1(dispersion)}h).{' '}
          {maxNurse && minNurse && maxNurse.nurse.id !== minNurse.nurse.id && (
            <>A enfermeira com mais horas é <strong>{maxNurse.nurse.name}</strong> ({fmt1(maxNurse.hours)}h)
            {' '}e com menos é <strong>{minNurse.nurse.name}</strong> ({fmt1(minNurse.hours)}h). </>
          )}
          Férias usufruídas: <strong>{totalFerie} dias</strong>.{' '}
          Taxa de absenteísmo: <strong>{absenceRate.toFixed(1)}%</strong>.
          {reqStats.pending > 0 && (
            <> ⏳ <span style={{color:'var(--warning)'}}>
              <strong>{reqStats.pending}</strong> solicitaç{reqStats.pending>1?'ões':'ão'} aguardando aprovação.
            </span></>
          )}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="report-kpi-grid">
        <KpiCard label="HORAS TOTAIS EQUIPE" value={`${fmt1(totalHours)}h`}
          sub={`Média: ${fmt1(avgHours)}h/pessoa`} color="purple" />
        <KpiCard label="DIAS TRABALHADOS" value={monthStats.reduce((s,n)=>s+n.worked,0)}
          sub={`Folgas: ${monthStats.reduce((s,n)=>s+n.off,0)}`} color="green" />
        <KpiCard label="TURNOS NOTURNOS" value={totalNights}
          sub={`${nightTarget} noites necessárias`} color="navy" />
        <KpiCard label="ABSENTEÍSMO" value={`${absenceRate.toFixed(1)}%`}
          sub={`${totalFerie+totalCertif} dias`} color="amber"
          warn={absenceRate > 5} />
        <KpiCard label="COBERTURA" value={`${coveragePct}%`}
          sub={`${days - monthAgg.coveredDays} descobertos`} color="dark"
          warn={coveragePct < 80} />
        <KpiCard label="EQUILÍBRIO" value={`${fmt1(dispersion)}h`}
          sub="dispersão max-min" color="dark2"
          warn={dispersion > 20} />
      </div>

      {/* HR Indicators */}
      <div className="hr-indicators">
        <HrCard value={reqStats.pending}  label="Solicitações Pendentes" color="amber" />
        <HrCard value={reqStats.approved} label="Solicitações Aprovadas"  color="green" />
        <HrCard value={reqStats.rejected} label="Solicitações Rejeitadas" color="red"   />
        <HrCard value={totalFerie}        label="Dias Férias (FE)"        color="teal"  />
        <HrCard value={totalCertif}       label="Certificados (AT)"       color="rose"  />
      </div>

      {/* Ranking */}
      <Section title="⏱ Ranking Horas por Enfermeira">
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr>
              <th className="col-name">ENFERMEIRA</th>
              <th>HORAS TOT.</th><th>TRAB.</th><th>FOLGA</th>
              <th>NOITES</th><th>FÉRIAS</th><th>CERTIF.</th><th>FESTIVOS</th>
              <th className="col-bar">CARGA</th>
            </tr></thead>
            <tbody>
              {rankSorted.map((s,idx)=>{
                const maxH = rankSorted[0]?.hours ?? 1;
                const pct  = maxH > 0 ? (s.hours/maxH)*100 : 0;
                return (
                  <tr key={s.nurse.id}>
                    <td className="col-name">
                      <span className="rank-pos">{idx+1}.</span>
                      <span className="nurse-initials">{s.nurse.initials}</span>
                      {s.nurse.name}
                    </td>
                    <td><strong>{fmt1(s.hours)}h</strong></td>
                    <td>{s.worked}</td><td>{s.off}</td>
                    <td>{s.nights}</td><td>{s.ferie}</td><td>{s.certif}</td><td>{s.festivi}</td>
                    <td className="col-bar">
                      <div className="bar-track">
                        <div className="bar-fill" style={{width:`${pct}%`,background:idx===0?'#ef4444':'var(--accent)'}}/>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Distribuição de turnos */}
      <Section title="🔄 Distribuição de Turnos por Enfermeira">
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr>
              <th className="col-name">ENFERMEIRA</th>
              {['M1','M2','MF','G','P','PF','N'].map(c=>(
                <th key={c}>
                  <span className="shift-dot" style={{background:SHIFTS[c].color}}/>
                  {c}
                </th>
              ))}
              <th>OFF</th>
              <th><span className="shift-dot" style={{background:'#10b981'}}/>FE</th>
              <th><span className="shift-dot" style={{background:'#ef4444'}}/>AT</th>
            </tr></thead>
            <tbody>
              {monthStats.map(s=>(
                <tr key={s.nurse.id}>
                  <td className="col-name">
                    <span className="nurse-initials">{s.nurse.initials}</span>
                    {s.nurse.name}
                  </td>
                  {['M1','M2','MF','G','P','PF','N'].map(c=>(
                    <td key={c}>{s.counts[c]>0?<strong>{s.counts[c]}</strong>:<span className="dim">0</span>}</td>
                  ))}
                  <td><strong>{s.counts.OFF}</strong></td>
                  <td>{s.counts.FE>0?<strong style={{color:'#10b981'}}>{s.counts.FE}</strong>:<span className="dim">0</span>}</td>
                  <td>{s.counts.AT>0?<strong style={{color:'#ef4444'}}>{s.counts.AT}</strong>:<span className="dim">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Balanço de Horas */}
      <Section title="⚖ Balanço de Horas: Devidas vs Efetivas"
               sub={`Horas devidas calculadas em ${monthAgg.workdays} dias úteis × 7.5h = ${oreStandard}h padrão`}>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr>
              <th className="col-name">ENFERMEIRA</th>
              <th>HORAS DEVIDAS</th><th>HORAS EFETIVAS</th>
              <th>DIFERENÇA</th><th>HORAS FÉRIAS</th><th>HORAS ATESTADO</th>
            </tr></thead>
            <tbody>
              {monthStats.map(s=>{
                const diff = s.hours - oreStandard;
                return (
                  <tr key={s.nurse.id}>
                    <td className="col-name">
                      <span className="nurse-initials">{s.nurse.initials}</span>
                      {s.nurse.name}
                    </td>
                    <td>{oreStandard}h</td>
                    <td><strong>{fmt1(s.hours)}h</strong></td>
                    <td style={{color:diff>=0?'#22c55e':'#ef4444',fontWeight:700}}>
                      {diff>=0?'+':''}{fmt1(diff)}h
                    </td>
                    <td>{fmt1(s.ferie*7.5)}h</td>
                    <td>{fmt1(s.certif*7.5)}h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Repartição Diurna/Noturna */}
      <Section title="🌓 Repartição de Horas Diurnas/Noturnas">
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr>
              <th className="col-name">ENFERMEIRA</th>
              <th>DIURNAS ÚTEIS</th><th>DIURNAS FESTIVAS</th>
              <th>NOTURNAS ÚTEIS</th><th>NOTURNAS FESTIVAS</th><th>TOTAL</th>
            </tr></thead>
            <tbody>
              {monthStats.map(s=>(
                <tr key={s.nurse.id}>
                  <td className="col-name">
                    <span className="nurse-initials">{s.nurse.initials}</span>
                    {s.nurse.name}
                  </td>
                  <td>{fmt1(s.diurneFer)}h</td>
                  <td>{fmt1(s.diurneFest)}h</td>
                  <td>{fmt1(s.notFer)}h</td>
                  <td>{fmt1(s.notFest)}h</td>
                  <td><strong>{fmt1(s.hours)}h</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Cobertura Diária */}
      <Section title="📅 Cobertura Diária"
               sub="Turnos ativos por dia. Úteis: 4 esperados | Festivos: 3 esperados">
        <div className="coverage-grid">
          {dailyCoverage.map((cnt,i)=>{
            const d  = i+1;
            const date = new Date(year,month,d);
            const dow  = date.getDay();
            const fest = isFestivo(date);
            const target = fest ? 3 : 4;
            const ok = cnt >= target;
            return (
              <div key={d} className={`cov-cell${ok?' cov-ok':' cov-warn'}${fest?' cov-fest':''}`}>
                <span className="cov-dow">{DOW_LETTERS[dow]}</span>
                <span className={`cov-count${ok?'':' cov-count--red'}`}>{cnt}</span>
                <span className="cov-day">{d}</span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Quota Turnos Noturnos */}
      <Section title="🌙 Quota de Turnos Noturnos">
        {monthStats.map(s=>{
          const quota = s.nurse.nightQuota ?? 5;
          const pct   = quota > 0 ? Math.min(s.nights/quota,1)*100 : 0;
          const over  = s.nights > quota;
          return (
            <div key={s.nurse.id} className="night-row">
              <span className="night-name">{s.nurse.name}</span>
              <div className="night-track">
                <div className="night-bar" style={{width:`${pct}%`,background:over?'#ef4444':undefined}}/>
              </div>
              <span className={`night-label${over?' night-over':''}`}>{s.nights}/{quota}</span>
            </div>
          );
        })}
      </Section>
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   RELATÓRIO ANUAL
   ════════════════════════════════════════════════════════════ */
function AnnualReport({ year, nurses, annualStats, annualAgg }) {
  if (!annualAgg) return <div className="empty-state">Sem dados para {year}.</div>;

  const rankSorted = [...annualStats].sort((a,b)=>b.hours-a.hours);

  return (
    <>
      {/* KPI */}
      <div className="report-kpi-grid report-kpi-grid--4">
        <KpiCard label="HORAS TOTAIS ANO" value={`${fmt1(annualAgg.totalHours)}h`}
          sub={`Média: ${fmt1(annualStats.length>0?annualAgg.totalHours/annualStats.length:0)}h/pessoa`} color="purple"/>
        <KpiCard label="DIAS TRABALHADOS" value={annualAgg.totalWorked}
          sub={`Folgas: ${annualAgg.restoDays}`} color="green"/>
        <KpiCard label="TURNOS NOTURNOS" value={annualAgg.totalNights} sub="total no ano" color="navy"/>
        <KpiCard label="DISPERSÃO HORAS" value={`${fmt1(annualAgg.dispersion)}h`}
          sub="Max-Min anual" color="amber" warn={annualAgg.dispersion>80}/>
      </div>

      {/* Ranking anual */}
      <Section title="⏱ Ranking Horas Anual por Enfermeira">
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr>
              <th className="col-name">ENFERMEIRA</th>
              <th>HORAS ANO</th><th>TRAB.</th><th>FOLGA</th>
              <th>NOITES</th><th>FÉRIAS</th><th>CERTIF.</th><th>FESTIVOS</th>
              <th className="col-bar">CARGA</th>
            </tr></thead>
            <tbody>
              {rankSorted.map((s,idx)=>{
                const maxH=rankSorted[0]?.hours??1;
                const pct=maxH>0?(s.hours/maxH)*100:0;
                const offDays = s.counts.OFF??0;
                return (
                  <tr key={s.nurse.id}>
                    <td className="col-name">
                      <span className="rank-pos">{idx+1}.</span>
                      <span className="nurse-initials">{s.nurse.initials}</span>
                      {s.nurse.name}
                    </td>
                    <td><strong>{fmt1(s.hours)}h</strong></td>
                    <td>{s.worked}</td><td>{offDays}</td>
                    <td>{s.nights}</td><td>{s.ferie}</td><td>{s.certif}</td><td>{s.festivi}</td>
                    <td className="col-bar">
                      <div className="bar-track">
                        <div className="bar-fill" style={{width:`${pct}%`,background:idx===0?'#ef4444':'var(--accent)'}}/>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Tendência mensal */}
      <Section title="📈 Horas por Mês — Tendência Anual">
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr>
              <th className="col-name">ENFERMEIRA</th>
              {Array.from({length:12},(_,i)=><th key={i}>{MONTH_ABR[i]}</th>)}
              <th>TOT</th>
            </tr></thead>
            <tbody>
              {rankSorted.map(s=>(
                <tr key={s.nurse.id}>
                  <td className="col-name">
                    <span className="nurse-initials">{s.nurse.initials}</span>
                    {s.nurse.name}
                  </td>
                  {Array.from({length:12},(_,i)=>{
                    const mH=s.monthlyHours[i+1];
                    return <td key={i}>{mH?<strong>{Math.round(mH)}</strong>:<span className="dim">—</span>}</td>;
                  })}
                  <td><strong>{Math.round(s.hours)}h</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Distribuição de turnos anual */}
      <Section title="🔄 Distribuição de Turnos Anual">
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr>
              <th className="col-name">ENFERMEIRA</th>
              {['M1','M2','MF','G','P','PF','N'].map(c=>(
                <th key={c}><span className="shift-dot" style={{background:SHIFTS[c].color}}/>{c}</th>
              ))}
              <th>OFF</th>
              <th><span className="shift-dot" style={{background:'#10b981'}}/>FE</th>
              <th><span className="shift-dot" style={{background:'#ef4444'}}/>AT</th>
            </tr></thead>
            <tbody>
              {rankSorted.map(s=>(
                <tr key={s.nurse.id}>
                  <td className="col-name">
                    <span className="nurse-initials">{s.nurse.initials}</span>
                    {s.nurse.name}
                  </td>
                  {['M1','M2','MF','G','P','PF','N'].map(c=>(
                    <td key={c}>{s.counts[c]>0?<strong>{s.counts[c]}</strong>:<span className="dim">0</span>}</td>
                  ))}
                  <td><strong>{s.counts.OFF??0}</strong></td>
                  <td>{(s.counts.FE??0)>0?<strong style={{color:'#10b981'}}>{s.counts.FE}</strong>:<span className="dim">0</span>}</td>
                  <td>{(s.counts.AT??0)>0?<strong style={{color:'#ef4444'}}>{s.counts.AT}</strong>:<span className="dim">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Quota noturna anual */}
      <Section title="🌙 Quota Noturna Anual">
        {rankSorted.map(s=>{
          const pct = Math.min(s.nights/NIGHT_ANNUAL_TARGET,1)*100;
          const over = s.nights > NIGHT_ANNUAL_TARGET;
          return (
            <div key={s.nurse.id} className="night-row">
              <span className="night-name">{s.nurse.name}</span>
              <div className="night-track">
                <div className="night-bar" style={{width:`${pct}%`,background:over?'#ef4444':undefined}}/>
              </div>
              <span className={`night-label${over?' night-over':''}`}>{s.nights}/{NIGHT_ANNUAL_TARGET}</span>
            </div>
          );
        })}
      </Section>
    </>
  );
}

/* ── Sub-components ── */
function Section({ title, sub, children }) {
  return (
    <div className="report-section">
      <div className="section-header">
        <p className="section-title">{title}</p>
        {sub && <p className="section-sub">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function KpiCard({ label, value, sub, color, warn }) {
  return (
    <div className={`rep-kpi rep-kpi--${color}${warn?' rep-kpi--warn':''}`}>
      <p className="rep-kpi-label">{label}</p>
      <p className="rep-kpi-value">{value}</p>
      {sub && <p className="rep-kpi-sub">{sub}</p>}
    </div>
  );
}

function HrCard({ value, label, color }) {
  return (
    <div className={`hr-card hr-card--${color}`}>
      <p className="hr-card-value">{value}</p>
      <p className="hr-card-label">{label}</p>
    </div>
  );
}
