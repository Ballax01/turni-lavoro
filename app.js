const STORAGE_KEY = 'turni-lavoro:shifts';
const RATE_KEY = 'turni-lavoro:rate';
const LAST_BACKUP_KEY = 'turni-lavoro:lastBackup';

const MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno',
  'luglio','agosto','settembre','ottobre','novembre','dicembre'];
const GIORNI = ['dom','lun','mar','mer','gio','ven','sab'];

function loadShifts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveShifts(shifts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shifts));
}

function loadRate() {
  const r = parseFloat(localStorage.getItem(RATE_KEY));
  return Number.isFinite(r) ? r : 7;
}

function saveRate(rate) {
  localStorage.setItem(RATE_KEY, String(rate));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const toastEl = document.getElementById('toast');
let toastTimer = null;

function showToast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

// --- Time helpers ---

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function durationMinutes(start, end) {
  let d = toMinutes(end) - toMinutes(start);
  if (d <= 0) d += 24 * 60; // turno che passa la mezzanotte
  return d;
}

function formatHours(totalMinutes) {
  const hours = totalMinutes / 60;
  const rounded = Math.round(hours * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0$/, '').replace('.', ',');
}

function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function formatDateLong(dateStr) {
  const dt = new Date(dateStr + 'T00:00:00');
  return `${GIORNI[dt.getDay()]} ${dt.getDate()} ${MESI[dt.getMonth()]}`;
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // YYYY-MM
}

function formatMonthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MESI[m - 1]} ${y}`;
}

function formatCurrency(value) {
  return value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

// Arrotonda all'ora piena o alla mezz'ora: <15 giù, 15-44 a :30, >=45 all'ora dopo.
function roundToHalfHour(date) {
  let hour = date.getHours();
  const minute = date.getMinutes();
  let roundedMinute;
  if (minute < 15) {
    roundedMinute = 0;
  } else if (minute < 45) {
    roundedMinute = 30;
  } else {
    roundedMinute = 0;
    hour = (hour + 1) % 24;
  }
  return `${hour.toString().padStart(2, '0')}:${roundedMinute.toString().padStart(2, '0')}`;
}

function shiftPay(s) {
  if (!s.end) return 0;
  const mins = durationMinutes(s.start, s.end);
  const r = Number.isFinite(s.rate) ? s.rate : rate;
  return (mins / 60) * r;
}

function shiftMinutes(s) {
  return s.end ? durationMinutes(s.start, s.end) : 0;
}

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

// --- State ---
let shifts = loadShifts();
let rate = loadRate();
let editingId = null;

// --- Views / tabs ---

const views = document.querySelectorAll('.view');
const tabButtons = document.querySelectorAll('nav.tabbar button');

function switchView(name) {
  if (name !== 'turni' && selectionMode) exitSelectionMode();
  views.forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'turni') renderTurni();
  if (name === 'riepilogo') renderRiepilogo();
  if (name === 'aggiungi') renderRecent();
}

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// --- Form "Aggiungi" ---

const form = document.getElementById('shift-form');
const inputDate = document.getElementById('input-date');
const inputStart = document.getElementById('input-start');
const inputEnd = document.getElementById('input-end');

function resetForm() {
  inputDate.value = todayISO();
  inputStart.value = '17:30';
  inputEnd.value = '';
}
resetForm();

form.addEventListener('submit', e => {
  e.preventDefault();
  if (!inputDate.value || !inputStart.value) return;
  shifts.push({
    id: uid(),
    date: inputDate.value,
    start: inputStart.value,
    end: inputEnd.value || null,
    rate: rate,
  });
  saveShifts(shifts);
  resetForm();
  renderRecent();
  showToast('Turno salvato ✓');
});

// Turno "in corso": aperto (senza fine) e con data odierna o passata.
// Esclude i turni futuri pre-inseriti (es. "da completare" per i prossimi giorni),
// che altrimenti verrebbero scambiati per il turno appena iniziato/da chiudere.
function findOngoingShift() {
  const todayStr = todayISO();
  return shifts
    .filter(s => !s.end && s.date <= todayStr)
    .sort((a, b) => (a.date + a.start > b.date + b.start ? -1 : 1))[0];
}

document.getElementById('start-now-btn').addEventListener('click', () => {
  const now = new Date();
  const start = roundToHalfHour(now);
  const alreadyOngoing = findOngoingShift();
  shifts.push({
    id: uid(),
    date: todayISO(),
    start,
    end: null,
    rate,
  });
  saveShifts(shifts);
  renderRecent();
  if (alreadyOngoing) {
    showToast(`Turno iniziato ✓ — attenzione: il turno del ${formatDateShort(alreadyOngoing.date)} risulta ancora aperto`);
  } else {
    showToast(`Turno iniziato alle ${start} ✓`);
  }
});

document.getElementById('end-now-btn').addEventListener('click', () => {
  const open = findOngoingShift();
  if (!open) {
    showToast('Nessun turno aperto da terminare');
    return;
  }
  const end = roundToHalfHour(new Date());
  open.end = end;
  saveShifts(shifts);
  renderRecent();
  showToast(`Turno terminato alle ${end} ✓`);
});

function renderRecent() {
  const list = document.getElementById('recent-list');
  const sorted = [...shifts].sort((a, b) => (a.date + a.start < b.date + b.start ? 1 : -1));
  const recent = sorted.slice(0, 5);
  if (recent.length === 0) {
    list.innerHTML = '<div class="empty-state">Nessun turno registrato ancora.</div>';
    return;
  }
  list.innerHTML = recent.map(s => shiftRowHTML(s)).join('');
  list.querySelectorAll('.shift-row').forEach(row => {
    row.addEventListener('click', () => openEdit(row.dataset.id));
  });
}

function shiftRowHTML(s) {
  if (!s.end) {
    return `
      <div class="shift-row" data-id="${s.id}">
        <div>
          <div class="date">${formatDateShort(s.date)}</div>
          <div class="time">${s.start}-?</div>
        </div>
        <div class="hours pending">da completare</div>
      </div>`;
  }
  const mins = durationMinutes(s.start, s.end);
  return `
    <div class="shift-row" data-id="${s.id}">
      <div>
        <div class="date">${formatDateShort(s.date)}</div>
        <div class="time">${s.start}-${s.end}</div>
      </div>
      <div class="hours">${formatHours(mins)} h</div>
    </div>`;
}

// --- Vista "Turni" (per mese) ---

const monthSelect = document.getElementById('month-select');

function availableMonths() {
  const keys = new Set(shifts.map(s => monthKey(s.date)));
  keys.add(monthKey(todayISO()));
  return [...keys].sort().reverse();
}

function renderTurni() {
  const months = availableMonths();
  const prevSelected = monthSelect.value;
  monthSelect.innerHTML = months.map(k => `<option value="${k}">${capitalize(formatMonthLabel(k))}</option>`).join('');
  monthSelect.value = months.includes(prevSelected) ? prevSelected : months[0];
  renderTurniTable();
}

monthSelect.addEventListener('change', () => {
  if (selectionMode) exitSelectionMode();
  renderTurniTable();
});

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderTurniTable() {
  const key = monthSelect.value;
  const monthShifts = shifts
    .filter(s => monthKey(s.date) === key)
    .sort((a, b) => (a.date + a.start > b.date + b.start ? 1 : -1));

  const totalMin = monthShifts.reduce((sum, s) => sum + shiftMinutes(s), 0);
  const totalPay = monthShifts.reduce((sum, s) => sum + shiftPay(s), 0);

  document.getElementById('turni-summary').innerHTML = `
    <div class="summary-bar">
      <div class="item">
        <div class="label">Turni</div>
        <div class="value">${monthShifts.length}</div>
      </div>
      <div class="item">
        <div class="label">Ore totali</div>
        <div class="value">${formatHours(totalMin)}</div>
      </div>
      <div class="item">
        <div class="label">Stipendio</div>
        <div class="value">${formatCurrency(totalPay)}</div>
      </div>
    </div>`;

  const list = document.getElementById('turni-list');
  if (monthShifts.length === 0) {
    list.innerHTML = '<div class="empty-state">Nessun turno in questo mese.</div>';
    return;
  }

  if (selectionMode) {
    list.innerHTML = monthShifts.map(s => `
      <label class="shift-row selectable" data-id="${s.id}">
        <input type="checkbox" class="bulk-checkbox" data-id="${s.id}" ${selectedIds.has(s.id) ? 'checked' : ''}>
        <div style="flex:1">
          <div class="date">${formatDateShort(s.date)}</div>
          <div class="time">${s.start}-${s.end || '?'}</div>
        </div>
        <div class="hours ${!s.end ? 'pending' : ''}">${s.end ? formatHours(durationMinutes(s.start, s.end)) + ' h' : 'da completare'}</div>
      </label>`).join('');
    list.querySelectorAll('.bulk-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(cb.dataset.id);
        else selectedIds.delete(cb.dataset.id);
        updateBulkDeleteLabel();
      });
    });
  } else {
    list.innerHTML = monthShifts.map(s => shiftRowHTML(s)).join('');
    list.querySelectorAll('.shift-row').forEach(row => {
      row.addEventListener('click', () => openEdit(row.dataset.id));
    });
  }
}

// --- Selezione multipla / eliminazione in blocco ---

let selectionMode = false;
let selectedIds = new Set();

const selectModeBtn = document.getElementById('select-mode-btn');
const bulkActions = document.getElementById('bulk-actions');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
const bulkCancelBtn = document.getElementById('bulk-cancel-btn');

function updateBulkDeleteLabel() {
  bulkDeleteBtn.textContent = `Elimina selezionati (${selectedIds.size})`;
  bulkDeleteBtn.disabled = selectedIds.size === 0;
}

function exitSelectionMode() {
  selectionMode = false;
  selectedIds.clear();
  selectModeBtn.textContent = 'Seleziona';
  bulkActions.classList.remove('show');
}

selectModeBtn.addEventListener('click', () => {
  selectionMode = !selectionMode;
  selectedIds.clear();
  selectModeBtn.textContent = selectionMode ? 'Annulla' : 'Seleziona';
  bulkActions.classList.toggle('show', selectionMode);
  updateBulkDeleteLabel();
  renderTurniTable();
});

bulkCancelBtn.addEventListener('click', () => {
  exitSelectionMode();
  renderTurniTable();
});

bulkDeleteBtn.addEventListener('click', () => {
  if (selectedIds.size === 0) return;
  const n = selectedIds.size;
  shifts = shifts.filter(s => !selectedIds.has(s.id));
  saveShifts(shifts);
  exitSelectionMode();
  refreshAll();
  showToast(`${n} turni eliminati`);
});

// --- Vista "Riepilogo" (tutti i mesi) ---

const rateInput = document.getElementById('rate-input');
rateInput.value = rate;
rateInput.addEventListener('change', () => {
  const v = parseFloat(rateInput.value.replace(',', '.'));
  if (Number.isFinite(v) && v > 0) {
    rate = v;
    saveRate(rate);
    renderRiepilogo();
    renderTurniTable();
  }
});

function renderRiepilogo() {
  const byMonth = {};
  for (const s of shifts) {
    const key = monthKey(s.date);
    if (!byMonth[key]) byMonth[key] = { mins: 0, pay: 0 };
    byMonth[key].mins += shiftMinutes(s);
    byMonth[key].pay += shiftPay(s);
  }
  const keys = Object.keys(byMonth).sort().reverse();

  const grandTotalMin = Object.values(byMonth).reduce((a, b) => a + b.mins, 0);
  const grandTotalPay = Object.values(byMonth).reduce((a, b) => a + b.pay, 0);
  document.getElementById('riepilogo-total').innerHTML = `
    <div class="summary-bar">
      <div class="item">
        <div class="label">Ore totali</div>
        <div class="value">${formatHours(grandTotalMin)}</div>
      </div>
      <div class="item">
        <div class="label">Stipendio totale</div>
        <div class="value">${formatCurrency(grandTotalPay)}</div>
      </div>
    </div>`;

  const list = document.getElementById('riepilogo-list');
  if (keys.length === 0) {
    list.innerHTML = '<div class="empty-state">Nessun dato ancora.</div>';
    return;
  }
  list.innerHTML = keys.map(key => {
    const { mins, pay } = byMonth[key];
    return `
      <div class="month-card">
        <div class="month-name">${formatMonthLabel(key)}</div>
        <div class="stats">
          <div>
            <div class="label">Ore</div>
            <div class="value">${formatHours(mins)}</div>
          </div>
          <div>
            <div class="label">Stipendio</div>
            <div class="value pay">${formatCurrency(pay)}</div>
          </div>
        </div>
        <button type="button" class="btn-secondary btn-copy" data-month="${key}">📋 Copia testo turni</button>
        <div class="sim-row">
          <label for="sim-${key}">E se guadagnassi... (simulazione, non modifica i turni)</label>
          <input type="number" id="sim-${key}" class="sim-rate" data-mins="${mins}" data-month="${key}" placeholder="Tariffa da provare (€/h)" step="0.5" min="0">
          <div class="sim-result"></div>
          <button type="button" class="btn-secondary btn-apply-rate" data-month="${key}" style="display:none; margin-top:10px;">Applica questa tariffa a tutti i turni del mese</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => copyMonthText(btn.dataset.month, btn));
  });

  list.querySelectorAll('.sim-rate').forEach(input => {
    input.addEventListener('input', () => {
      const mins = Number(input.dataset.mins);
      const v = parseFloat(String(input.value).replace(',', '.'));
      const resultEl = input.nextElementSibling;
      const applyBtn = resultEl.nextElementSibling;
      if (Number.isFinite(v) && v > 0) {
        resultEl.textContent = `Con ${v}€/h avresti guadagnato: ${formatCurrency((mins / 60) * v)}`;
        resultEl.classList.add('has-value');
        applyBtn.style.display = 'block';
        applyBtn.dataset.rate = v;
      } else {
        resultEl.textContent = '';
        resultEl.classList.remove('has-value');
        applyBtn.style.display = 'none';
        delete applyBtn.dataset.rate;
      }
    });
  });

  list.querySelectorAll('.btn-apply-rate').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.month;
      const newRate = parseFloat(btn.dataset.rate);
      if (!Number.isFinite(newRate) || newRate <= 0) return;
      const monthShifts = shifts.filter(s => monthKey(s.date) === key);
      const label = capitalize(formatMonthLabel(key));
      const ok = confirm(`Applicare ${newRate}€/h a tutti i ${monthShifts.length} turni di ${label}? La tariffa attuale di ciascun turno verrà sovrascritta.`);
      if (!ok) return;
      monthShifts.forEach(s => { s.rate = newRate; });
      saveShifts(shifts);
      refreshAll();
      showToast(`Tariffa applicata a ${monthShifts.length} turni di ${label} ✓`);
    });
  });
}

function buildMonthText(key) {
  const monthShifts = shifts
    .filter(s => monthKey(s.date) === key && s.end)
    .sort((a, b) => (a.date + a.start > b.date + b.start ? 1 : -1));

  const lines = monthShifts.map(s => {
    const mins = durationMinutes(s.start, s.end);
    return `${formatDateShort(s.date)} ${s.start}-${s.end} / ${formatHours(mins)}`;
  });

  const totalMin = monthShifts.reduce((sum, s) => sum + durationMinutes(s.start, s.end), 0);

  return [
    capitalize(formatMonthLabel(key)),
    '',
    ...lines,
    '',
    `Totale ore: ${formatHours(totalMin)}`,
  ].join('\n');
}

async function copyMonthText(key, btn) {
  const text = buildMonthText(key);
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  btn.textContent = '✓ Copiato';
  setTimeout(() => { btn.textContent = original; }, 1500);
}

// --- Backup (esporta / importa) ---

document.getElementById('export-backup-btn').addEventListener('click', () => {
  const backup = {
    app: 'turni-lavoro',
    version: 1,
    exportedAt: new Date().toISOString(),
    rate,
    shifts,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `turni-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  renderIosWarning();
  showToast('Backup esportato ✓');
});

const importBackupBtn = document.getElementById('import-backup-btn');
const importBackupFile = document.getElementById('import-backup-file');

importBackupBtn.addEventListener('click', () => importBackupFile.click());

importBackupFile.addEventListener('change', () => {
  const file = importBackupFile.files[0];
  importBackupFile.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch {
      showToast('File non valido');
      return;
    }
    if (!data || !Array.isArray(data.shifts)) {
      showToast('File non valido');
      return;
    }

    let added = 0, skipped = 0;
    for (const s of data.shifts) {
      if (!s || typeof s.date !== 'string' || typeof s.start !== 'string') continue;
      const exists = shifts.some(x => x.date === s.date && x.start === s.start && x.end === (s.end || null));
      if (exists) { skipped++; continue; }
      shifts.push({
        id: uid(),
        date: s.date,
        start: s.start,
        end: s.end || null,
        rate: Number.isFinite(s.rate) ? s.rate : rate,
      });
      added++;
    }
    if (added > 0) saveShifts(shifts);
    refreshAll();
    showToast(`${added} turni importati dal backup${skipped ? `, ${skipped} già presenti` : ''}`);
  };
  reader.readAsText(file);
});

// --- Modifica / elimina turno ---

const dialog = document.getElementById('edit-dialog');
const editForm = document.getElementById('edit-form');
const editDate = document.getElementById('edit-date');
const editStart = document.getElementById('edit-start');
const editEnd = document.getElementById('edit-end');
const editRate = document.getElementById('edit-rate');

function openEdit(id) {
  const s = shifts.find(x => x.id === id);
  if (!s) return;
  editingId = id;
  editDate.value = s.date;
  editStart.value = s.start;
  editEnd.value = s.end || '';
  editRate.value = Number.isFinite(s.rate) ? s.rate : rate;
  dialog.showModal();
}

editForm.addEventListener('submit', e => {
  e.preventDefault();
  const s = shifts.find(x => x.id === editingId);
  if (s) {
    s.date = editDate.value;
    s.start = editStart.value;
    s.end = editEnd.value || null;
    const r = parseFloat(String(editRate.value).replace(',', '.'));
    s.rate = Number.isFinite(r) && r > 0 ? r : rate;
    saveShifts(shifts);
  }
  dialog.close();
  refreshAll();
  showToast('Turno modificato ✓');
});

document.getElementById('delete-btn').addEventListener('click', () => {
  shifts = shifts.filter(x => x.id !== editingId);
  saveShifts(shifts);
  dialog.close();
  refreshAll();
  showToast('Turno eliminato');
});

document.getElementById('cancel-btn').addEventListener('click', () => dialog.close());

// --- Importa turni da testo ---

const importDialog = document.getElementById('import-dialog');
const importTextarea = document.getElementById('import-textarea');
const importPreview = document.getElementById('import-preview');
const importConfirmBtn = document.getElementById('import-confirm-btn');
let importParsed = [];

document.getElementById('open-import-btn').addEventListener('click', () => {
  importTextarea.value = '';
  importPreview.innerHTML = '';
  importParsed = [];
  importConfirmBtn.disabled = true;
  importDialog.showModal();
  importTextarea.focus();
});

document.getElementById('import-cancel-btn').addEventListener('click', () => importDialog.close());

const MONTH_NAMES = {
  gen: 1, gennaio: 1, feb: 2, febbraio: 2, mar: 3, marzo: 3, apr: 4, aprile: 4,
  mag: 5, maggio: 5, giu: 6, giugno: 6, lug: 7, luglio: 7, ago: 8, agosto: 8,
  set: 9, settembre: 9, ott: 10, ottobre: 10, nov: 11, novembre: 11, dic: 12, dicembre: 12,
};
const MONTH_NAME_RE = new RegExp(`(\\d{1,2})\\s+(${Object.keys(MONTH_NAMES).join('|')})[a-z]*\\.?`, 'i');

// Trova la data in una riga, provando prima il formato numerico (gg/mm/aa).
// Scarta i "falsi positivi" numerici che in realtà sono pezzi di un orario
// (es. "01" in "17:30-01:30"), riconoscibili perché precedute da ':' o da
// un'altra cifra. Se non trova nulla di numerico valido, prova "gg nomemese"
// (es. "15 luglio" o "15 lug") — in quel caso l'anno non viene estratto
// (per evitare di confonderlo con un orario tipo "1730") e si usa quello attuale.
function matchDate(line) {
  const dateRe = /(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2,4}))?/g;
  let m;
  while ((m = dateRe.exec(line))) {
    const before = line[m.index - 1];
    if (before === ':' || (before && /\d/.test(before))) continue;
    return { index: m.index, length: m[0].length, day: m[1], month: m[2], year: m[3] };
  }
  const named = line.match(MONTH_NAME_RE);
  if (named) {
    return { index: named.index, length: named[0].length, day: named[1], month: MONTH_NAMES[named[2].toLowerCase()], year: undefined };
  }
  return null;
}

// Trova gli orari nel resto della riga: prima con separatore (: o .),
// e solo se non ne trova nessuno prova il formato compatto senza separatore (es. "1730").
function findTimes(text) {
  const withSep = [...text.matchAll(/(\d{1,2})[:.](\d{2})/g)];
  if (withSep.length > 0) return withSep;
  return [...text.matchAll(/\b([01]\d|2[0-3])([0-5]\d)\b/g)];
}

// Riconosce righe con una data e almeno l'orario di inizio,
// ignorando il resto (es. "/ 8" o "(8 ore)") perché le ore si ricalcolano da inizio/fine.
function parseShiftLine(line) {
  const dateInfo = matchDate(line);
  if (!dateInfo) return null;
  const rest = line.slice(dateInfo.index + dateInfo.length);
  const timeMatches = findTimes(rest);
  if (timeMatches.length < 1) return null;

  const dNum = Number(dateInfo.day), mNum = Number(dateInfo.month);
  if (dNum < 1 || dNum > 31 || mNum < 1 || mNum > 12) return null;
  let y = dateInfo.year ? String(dateInfo.year) : String(new Date().getFullYear());
  y = y.length === 2 ? '20' + y : y;
  if (y.length !== 4) return null;

  const sh = Number(timeMatches[0][1]), sm = Number(timeMatches[0][2]);
  if (sh > 23 || sm > 59) return null;

  const date = `${y}-${mNum.toString().padStart(2, '0')}-${dNum.toString().padStart(2, '0')}`;
  const start = `${sh.toString().padStart(2, '0')}:${sm.toString().padStart(2, '0')}`;

  let end = null;
  if (timeMatches.length >= 2) {
    const eh = Number(timeMatches[1][1]), em = Number(timeMatches[1][2]);
    if (eh > 23 || em > 59) return null;
    end = `${eh.toString().padStart(2, '0')}:${em.toString().padStart(2, '0')}`;
  }
  return { date, start, end };
}

function isDuplicate(p) {
  return shifts.some(s => s.date === p.date && s.start === p.start && s.end === p.end);
}

function renderImportPreview() {
  const lines = importTextarea.value.split('\n').map(l => l.trim()).filter(Boolean);
  importParsed = [];
  const unrecognized = [];

  for (const line of lines) {
    const p = parseShiftLine(line);
    if (p) {
      p.duplicate = isDuplicate(p);
      importParsed.push(p);
    } else {
      unrecognized.push(line);
    }
  }

  if (importParsed.length === 0) {
    importPreview.innerHTML = unrecognized.length
      ? '<div class="import-unrecognized">Nessuna riga riconosciuta. Assicurati che ogni riga abbia una data e almeno l\'orario di inizio (es. 01/07/26 17:30-01:30 oppure solo 01/07/26 17:30).</div>'
      : '';
    importConfirmBtn.disabled = true;
    return;
  }

  importPreview.innerHTML =
    importParsed.map((p, i) => `
      <label class="import-preview-row">
        <input type="checkbox" data-idx="${i}" ${p.duplicate ? '' : 'checked'}>
        <span>${formatDateShort(p.date)} ${p.start}-${p.end || '?'}${!p.end ? ' <span class="dup">(da completare)</span>' : ''}${p.duplicate ? ' <span class="dup">(già presente)</span>' : ''}</span>
      </label>`).join('') +
    `<div class="import-summary">${importParsed.length} righe riconosciute su ${lines.length} totali.</div>` +
    (unrecognized.length ? `<div class="import-unrecognized">Non riconosciute:\n${unrecognized.join('\n')}</div>` : '');

  importConfirmBtn.disabled = false;
}

importTextarea.addEventListener('input', renderImportPreview);

importConfirmBtn.addEventListener('click', () => {
  const checked = importPreview.querySelectorAll('input[type="checkbox"]:checked');
  let added = 0;
  checked.forEach(cb => {
    const p = importParsed[Number(cb.dataset.idx)];
    if (!p) return;
    shifts.push({ id: uid(), date: p.date, start: p.start, end: p.end, rate });
    added++;
  });
  if (added > 0) saveShifts(shifts);
  importDialog.close();
  refreshAll();
  showToast(added === 1 ? '1 turno importato ✓' : `${added} turni importati ✓`);
});

function refreshAll() {
  renderRecent();
  renderTurni();
  renderRiepilogo();
}

// --- Avviso iOS: lo storage dei siti web su iPhone/iPad non è affidabile
// come quello di un'app nativa, quindi ricordiamo di fare backup spesso. ---

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let iosWarningDismissed = false;

function renderIosWarning() {
  const banner = document.getElementById('ios-warning');
  if (!isIOS || iosWarningDismissed || shifts.length === 0) {
    banner.classList.remove('show');
    return;
  }
  const last = localStorage.getItem(LAST_BACKUP_KEY);
  let daysText;
  if (!last) {
    daysText = 'Non hai ancora fatto un backup.';
  } else {
    const days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
    daysText = days <= 0 ? 'Ultimo backup: oggi.' : `Ultimo backup: ${days} giorno${days === 1 ? '' : 'i'} fa.`;
  }
  banner.innerHTML = `
    <button type="button" class="ios-dismiss" aria-label="Chiudi">✕</button>
    ⚠️ Su iPhone/iPad i dati possono sparire senza preavviso (limite di iOS, non un bug dell'app). ${daysText}
    <button type="button" id="ios-warning-backup-btn">Esporta backup ora</button>`;
  banner.classList.add('show');
  banner.querySelector('.ios-dismiss').addEventListener('click', () => {
    iosWarningDismissed = true;
    banner.classList.remove('show');
  });
  document.getElementById('ios-warning-backup-btn').addEventListener('click', () => {
    document.getElementById('export-backup-btn').click();
  });
}

// --- Init ---
switchView('aggiungi');
renderIosWarning();

// --- Service worker ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// Chiede al browser di proteggere questi dati dalla pulizia automatica
// dello spazio quando il telefono è pieno (best-effort, no prompt visibile).
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then(already => {
    if (!already) navigator.storage.persist().catch(() => {});
  });
}
