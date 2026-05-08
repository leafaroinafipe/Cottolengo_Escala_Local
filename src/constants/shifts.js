export const SHIFTS = {
  M1:  { name: 'Mattina 1',           hours: 7.0, color: '#f59e0b', text: '#1a1a00', period: 'morning' },
  M2:  { name: 'Mattina 2',           hours: 4.5, color: '#fcd34d', text: '#1a1a00', period: 'morning' },
  MF:  { name: 'Mattina Festivo',     hours: 7.5, color: '#f97316', text: '#fff',    period: 'morning' },
  G:   { name: 'Giornata Intera',     hours: 8.0, color: '#0ea5e9', text: '#fff',    period: 'morning' },
  P:   { name: 'Pomeriggio',          hours: 8.0, color: '#8b5cf6', text: '#fff',    period: 'afternoon' },
  PF:  { name: 'Pomeriggio Festivo',  hours: 7.5, color: '#a78bfa', text: '#fff',    period: 'afternoon' },
  N:   { name: 'Notte',               hours: 9.0, color: '#1e1b4b', text: '#fff',    period: 'night' },
  OFF: { name: 'Riposo',              hours: 0,   color: 'transparent', text: 'rgba(255,255,255,0.3)', period: 'off' },
  FE:  { name: 'Ferie',               hours: 0,   color: '#10b981', text: '#fff',    period: 'off' },
  AT:  { name: 'Certificato/Licenza', hours: 0,   color: '#ef4444', text: '#fff',    period: 'off' },
};

export const SHIFT_START = {
  M1: 7, M2: 7.5, MF: 7, G: 7.5, P: 14, PF: 14.5, N: 22, OFF: 0, FE: 0, AT: 0,
};

export const NURSES_DEFAULT = [
  { id: 'n1', name: 'Balla Sabina',        initials: 'BS', nightQuota: 5 },
  { id: 'n2', name: 'Batista Bianca',      initials: 'BB', nightQuota: 5 },
  { id: 'n3', name: 'De Carvalho Eduarda', initials: 'CE', nightQuota: 5 },
  { id: 'n4', name: 'Alves Festa Melissa', initials: 'AM', nightQuota: 5 },
  { id: 'n5', name: 'Delizzeti Sirlene',   initials: 'DS', nightQuota: 5 },
  { id: 'n6', name: 'Moslih Miriam',       initials: 'MM', nightQuota: 5 },
  { id: 'n7', name: 'Kocevska Kristina',   initials: 'KK', nightQuota: 5 },
];
