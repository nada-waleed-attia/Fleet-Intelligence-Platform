// EDIT BY NADA — preview-only controls; original page files and production behavior remain untouched.
(() => {
  const P = globalThis.ObserverPreview, page = location.pathname.split('/').pop(), $ = id => document.getElementById(id);
  // EDIT BY NADA — identify the current page for preview-only visual styling.
  document.body.dataset.previewPage = page;
  // EDIT BY NADA — temporarily hide in-page Wialon Reports shortcuts; preserve the page and Wialon Hosting link.
  document.querySelectorAll('[href="/wialon-reports.html"], [data-url="/wialon-reports.html"], [onclick*="wialon-reports.html"]').forEach(node => node.style.setProperty('display', 'none', 'important'));
  // Use the same local Lucide vectors as lucide-react, while preserving the report actions.
  if (page === 'observer-reports.html') {
    const icon = (node, name, label) => {
      if (!node) return;
      node.innerHTML = ObserverIcons.svg(name);
      if (label) { const text = document.createElement('span'); text.textContent = label; node.append(text); }
    };
    document.querySelector('.card.soon')?.remove();
    document.querySelector('.footer')?.remove();
    document.querySelector('.brand-text p')?.remove();
    document.querySelector('.badge-new')?.remove();
    const reports = [['all', 'chart-column'], ['battery0', 'battery'], ['offline', 'wifi-off']];
    document.querySelectorAll('.cards > .card:not(.featured)').forEach((card, index) => {
      card.dataset.report = reports[index][0];
      icon(card.querySelector('.card-icon'), reports[index][1]);
      if (reports[index][0] === 'battery0') { card.querySelector('h3').textContent = 'Battery'; card.querySelector('p').textContent = 'Units reporting 0 V or a battery reading below 8000 V. Choose the reading range to review.'; }
      if (reports[index][0] === 'offline') card.querySelector('p').textContent = 'Units that have not sent a message for more than 12 hours, including last-seen information, location and offline duration.';
    });
    icon(document.querySelector('.sensor-icon'), 'fuel');
    icon(document.querySelector('.back-btn'), 'arrow-left', 'Back to Dashboard');
    document.querySelectorAll('.btn-view').forEach(button => icon(button, 'eye', 'Unit view'));
    document.querySelectorAll('.btn-excel').forEach(button => icon(button, 'table-2', button.closest('.featured') ? 'Export Excel' : 'Excel'));
    document.querySelectorAll('.btn-pdf').forEach(button => icon(button, 'file-text', button.closest('.featured') ? 'Export PDF' : 'PDF'));
    icon(document.querySelector('.btn-sensor-view'), 'eye', 'Sensor Report');
    const sensorCard = document.querySelector('.card.featured'), sensorActions = sensorCard.querySelector('.featured-actions');
    sensorCard.querySelector('.featured-heading p').textContent = 'Show all sensor values across all units';
    sensorCard.querySelector('.sensor-tags')?.remove();
    // EDIT BY NADA — filters belong only on Sensor Report, not the overview card.
    sensorActions.querySelectorAll('button').forEach(button => button.disabled = false);
    window.viewSensors = () => P.open('/api/reports/view-sensors');
    // EDIT BY NADA — both Sensor Overview export buttons open Sensor Report before an explicit download inside it.
    window.downloadSensors = format => ['xlsx', 'pdf'].includes(format) ? window.viewSensors() : undefined;
    window.updateViewLabel = (button, mode) => icon(button, 'eye', mode === 'group' ? 'Group view' : 'Unit view');
    const batteryCard = document.querySelector('[data-report="battery0"]'), batteryField = document.createElement('label'), batteryRange = document.createElement('select');
    batteryField.className = 'observer-battery-filter'; batteryField.textContent = 'Battery reading'; batteryRange.id = 'observer-battery-filter'; batteryField.htmlFor = batteryRange.id;
    [['down', 'Battery Down · 0 V or below 8000 V'], ['zero', 'Zero only · 0 V'], ['low', 'Low only · above 0 V and below 8000 V']].forEach(([value, title]) => batteryRange.add(new Option(title, value)));
    batteryField.append(batteryRange); batteryCard.querySelector('.actions').before(batteryField);
    // EDIT BY NADA — Observer Reports card actions open the report first; downloads stay inside its viewer.
    const fleetPath = (filter, button) => { const params = new URLSearchParams({ filter: filter === 'battery0' ? 'battery' : filter, view: getMode(button) }); if (filter === 'battery0') params.set('battery', batteryRange.value); return `/api/reports/view?${params}`; };
    // EDIT BY NADA — preserve the existing Unit/Group toggle and selected battery range.
    const oldFleetView = window.viewReport;
    window.viewReport = (filter, button) => { if (filter !== 'battery0') return oldFleetView(filter, button); const result = P.open(fleetPath(filter, button)); window.updateViewLabel(button, toggleMode(button)); return result; };
    // EDIT BY NADA — scope this view-first behavior to All Units, Battery and Offline cards, independently of Units exports.
    const openFleetReport = (filter, button) => ['all', 'battery0', 'offline'].includes(filter) ? P.open(fleetPath(filter, button)) : undefined;
    window.downloadExcel = openFleetReport;
    window.downloadPdf = openFleetReport;
  }
  const note = text => { const node = document.createElement('p'); node.className = 'preview-note'; node.textContent = text; document.body.prepend(node); return node; };
  const controls = () => { const node = document.createElement('div'); node.className = 'preview-controls'; document.body.prepend(node); return node; };
  const button = (parent, text, action) => { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.addEventListener('click', async () => { node.disabled = true; try { await action(); } catch (error) { P.alert(error.message); } finally { node.disabled = false; } }); parent.append(node); return node; };
  const request = async (url, method = 'GET', body) => { const response = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined }); const data = await response.json(); if (!data.success) throw new Error(data.error); return data; };
  if (['login.html', 'login-standalone.html'].includes(page)) {
    const bar = controls();
    note('Demo entry only. Choose a persona above or a demo username below. No real password is accepted or stored. Wialon login is simulated locally.');
    const picker = document.createElement('select'); picker.setAttribute('aria-label', 'Demo login username');
    request('/__preview/state').then(({ state }) => { for (const user of state.users.filter(u => u.isActive)) picker.add(new Option(user.username, user.username)); if ($('username')) $('username').value = picker.value; }).catch(error => P.alert(error.message));
    const password = $('password') || document.querySelector('input[type="password"]'); if (password) { password.value = 'DEMO_ONLY'; password.readOnly = true; password.required = false; password.autocomplete = 'off'; }
    bar.append(picker); picker.addEventListener('change', () => { const field = $('username') || document.querySelector('input[type="text"]'); if (field) field.value = picker.value; });
    button(bar, 'Enter selected demo persona', async () => { await request('/api/login', 'POST', { username: picker.value }); P.navigate('/index.html'); });
  }
  if (page === 'wialon-callback.html') {
    const bar = controls(); note('Simulated Wialon callback. No real token is read, accepted or sent. The original callback script is not executed in preview.');
    button(bar, 'Simulate successful callback', () => P.navigate('/index.html'));
    button(bar, 'Simulate callback error', () => P.alert('Simulated callback error. No external authentication was attempted.'));
    for (const node of document.querySelectorAll('.loader')) node.hidden = true;
  }
  if (page.includes('reports.html') && !['observer-reports.html', 'wialon-reports.html'].includes(page)) note('All results are synthetic. Excel actions download labelled CSV; PDF actions open printable demo HTML. No backend report service is contacted.');
  if (page === 'index.html') {
    // EDIT BY NADA — dashboard-only visual treatment stays inside the isolated preview frame.
    document.body.classList.add('preview-dashboard');
    // EDIT BY NADA — shorten only the dashboard card labels in the preview.
    const offlineTitle = document.querySelector('.card.danger h3'), batteryTitle = document.querySelector('.card.warn h3');
    if (offlineTitle) offlineTitle.textContent = 'Offline';
    if (batteryTitle) batteryTitle.textContent = 'Battery';
    // EDIT BY NADA — retain the existing reports actions while exposing expanded state and Escape to keyboard users.
    const reportsButton = $('reports-toggle-btn'), reportsMenu = $('reports-menu');
    if (reportsButton && reportsMenu) {
      reportsButton.setAttribute('aria-controls', 'reports-menu');
      const syncReports = () => reportsButton.setAttribute('aria-expanded', String(reportsMenu.classList.contains('open')));
      new MutationObserver(syncReports).observe(reportsMenu, { attributes: true, attributeFilter: ['class'] });
      reportsMenu.addEventListener('keydown', event => { if (event.key === 'Escape') { reportsMenu.classList.remove('open'); reportsButton.focus(); event.preventDefault(); } });
      reportsButton.addEventListener('keydown', event => { if (event.key === 'Escape' && reportsMenu.classList.contains('open')) { reportsMenu.classList.remove('open'); event.preventDefault(); } });
      syncReports();
    }
    const online = document.querySelector('.card.ok'); if (online) online.onclick = () => P.navigate('/units.html?filter=online');
  }
  if (page === 'units.html') {
    const bar = controls(), sort = document.createElement('select'); sort.setAttribute('aria-label', 'Sort demo units');
    for (const [value, text] of [['name-asc', 'Unit name A–Z'], ['name-desc', 'Unit name Z–A'], ['battery-asc', 'Battery low–high'], ['battery-desc', 'Battery high–low']]) sort.add(new Option(text, value));
    bar.append('Preview sorting: ', sort);
    const status = $('f-status'); status?.add(new Option('Online · preview filter', 'online'));
    if (new URLSearchParams(location.search).get('filter') === 'online') status.value = 'online';
    const reorder = () => { const tbody = document.querySelector('tbody'); if (!tbody) return; const rows = [...tbody.rows].filter(row => row.cells.length > 2), battery = sort.value.startsWith('battery'), direction = sort.value.endsWith('desc') ? -1 : 1; for (const row of rows) row.hidden = status?.value === 'online' && row.querySelector('.offline') !== null; rows.sort((a, b) => direction * (battery ? (Number.parseFloat(a.cells[7]?.textContent) || 0) - (Number.parseFloat(b.cells[7]?.textContent) || 0) : a.cells[2].textContent.trim().localeCompare(b.cells[2].textContent.trim()))); for (const row of rows) tbody.append(row); };
    const original = window.render; if (original) window.render = (...args) => { original(...args); reorder(); };
    sort.addEventListener('change', reorder);
  }
  if (page === 'admin-users.html') {
    const password = $('f-password'); if (password) { password.value = 'DEMO_ONLY'; password.readOnly = true; password.required = false; }
    // EDIT BY NADA — form.reset and login-method changes must not re-enable password collection.
    const protect = () => { if (password) { password.value = 'DEMO_ONLY'; password.readOnly = true; password.required = false; } for (const input of document.querySelectorAll('[id^="wtoken-"]')) { input.value = 'PREVIEW_ONLY'; input.readOnly = true; } };
    const observer = new MutationObserver(protect); observer.observe(document.body, { childList: true, subtree: true }); protect();
  }
  if (['installations.html', 'maintenance-report.html'].includes(page)) {
    if (page === 'maintenance-report.html') {
      const field = document.createElement('div'); field.className = 'preview-controls'; const label = document.createElement('label'); label.textContent = 'Optional preview signature'; const canvas = document.createElement('canvas'); canvas.id = 'preview-signature'; canvas.width = 480; canvas.height = 130; canvas.style.cssText = 'background:white;max-width:100%;touch-action:none;border:1px solid #546'; label.append(canvas); field.append(label); $('report-form').append(field);
      const ctx = canvas.getContext('2d'); ctx.lineWidth = 2; ctx.strokeStyle = '#132d3c'; let drawing = false;
      const point = event => { const rect = canvas.getBoundingClientRect(); return [(event.clientX - rect.left) * canvas.width / rect.width, (event.clientY - rect.top) * canvas.height / rect.height]; };
      canvas.addEventListener('pointerdown', event => { drawing = true; canvas.dataset.drawn = 'true'; canvas.setPointerCapture(event.pointerId); ctx.beginPath(); ctx.moveTo(...point(event)); });
      canvas.addEventListener('pointermove', event => { if (drawing) { ctx.lineTo(...point(event)); ctx.stroke(); } });
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { drawing = false; });
      const clear = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.dataset.drawn = 'false'; };
      button(field, 'Clear preview signature', clear);
      const original = window.openNewReportModal; window.openNewReportModal = (...args) => { clear(); return original(...args); };
    }
  }
})();
