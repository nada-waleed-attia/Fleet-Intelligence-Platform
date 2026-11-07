// EDIT BY NADA — presentation and accessibility for the isolated All Units preview.
(() => {
  const $ = id => document.getElementById(id);
  const icon = name => {
    const node = document.createElement('span'); node.className = 'units-icon';
    node.setAttribute('aria-hidden', 'true'); node.innerHTML = ObserverIcons.svg(name); return node;
  };
  const labelButton = (button, name, label) => {
    if (!button) return;
    const text = document.createElement('span'); text.textContent = label;
    button.replaceChildren(icon(name), text);
  };
  const backdrop = document.createElement('div'); backdrop.className = 'units-backdrop'; backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = '<div class="units-glow units-glow-green"></div><div class="units-glow units-glow-gold"></div><div class="units-contours"></div><div class="units-perspective-grid"></div>';
  document.body.prepend(backdrop);
  const heading = document.querySelector('.brand-text');
  const subtitle = document.createElement('p'); subtitle.className = 'units-intro';
  subtitle.textContent = 'Find a unit. Check its status. Open the details.'; heading.append(subtitle);
  labelButton(document.querySelector('.back-btn'), 'arrow-left', 'Dashboard');

  // Keep the main fleet counts visible; the production print placeholders remain available.
  const info = document.querySelector('.report-info');
  const overview = document.createElement('section'); overview.className = 'units-overview'; overview.setAttribute('aria-label', 'Fleet overview');
  const groups = [
    ['total', 'All units', 'truck', 'All tracked units', 'all'],
    ['online', 'Online', 'activity', 'Sending updates', 'online'],
    ['offline', 'Offline', 'wifi-off', 'Check connection', 'offline']
  ];
  for (const [key, label, symbol, description, filter] of groups) {
    const card = document.createElement('button'); card.type = 'button'; card.className = `units-stat units-stat-${key}`;
    const title = document.createElement('span'); title.className = 'units-stat-label'; title.textContent = label;
    const count = document.createElement('strong'); count.id = `units-count-${key}`; count.textContent = '—';
    const detail = document.createElement('span'); detail.className = 'units-stat-detail'; detail.textContent = description;
    const tile = icon(symbol); tile.classList.add('units-stat-icon');
    card.append(title, count, detail, tile);
    card.addEventListener('click', () => { $('f-status').value = filter; if (filter === 'all') { $('f-batt').value = 'all'; $('f-search').value = ''; } window.render(); });
    overview.append(card);
  }
  info.after(overview);

  const controls = document.querySelector('.controls');
  $('f-batt').add(new Option('Battery Down', 'down'));
  // EDIT BY NADA — old zero-only URL values fall back to the remaining All option.
  if (!$('f-batt').value) $('f-batt').value = 'all';
  const sort = document.querySelector('.preview-controls select');
  const oldSortBar = sort?.parentElement;
  const fields = [[$('f-search'), 'Search units', 'truck'], [$('f-status'), 'Connection status', 'activity'], [$('f-batt'), 'Battery', 'battery'], [sort, 'Sort by', 'chart-column']];
  for (const [field, label, symbol] of fields) {
    if (!field) continue;
    if (!field.id) field.id = 'units-sort';
    field.setAttribute('aria-label', label);
    const wrapper = document.createElement('label'); wrapper.className = field.type === 'search' ? 'units-filter units-search' : 'units-filter';
    const caption = document.createElement('span'); caption.className = 'units-filter-label'; caption.append(icon(symbol), document.createTextNode(label));
    wrapper.append(caption, field); controls.append(wrapper);
  }
  if (oldSortBar) oldSortBar.remove();
  const closeMenus = except => document.querySelectorAll('.units-select-wrap.is-open').forEach(menu => { if (menu !== except) { menu.classList.remove('is-open'); menu.querySelector('.units-select-trigger')?.setAttribute('aria-expanded', 'false'); } });
  const enhanceSelect = select => {
    const field = select.closest('.units-filter'); if (!field || select.dataset.enhanced) return;
    select.dataset.enhanced = 'true'; select.classList.add('units-native-select');
    const wrap = document.createElement('div'); wrap.className = 'units-select-wrap';
    if (select.id === 'units-sort') wrap.classList.add('units-sort-wrap');
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'units-select-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div'); menu.className = 'units-select-menu'; menu.setAttribute('role', 'listbox');
    const options = [...select.options].map(option => {
      const item = document.createElement('button'); item.type = 'button'; item.className = 'units-select-option'; item.dataset.value = option.value; item.setAttribute('role', 'option'); item.textContent = option.textContent.trim();
      item.addEventListener('click', () => { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); wrap.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); }); menu.append(item); return item;
    });
    const sync = () => { const selected = select.options[select.selectedIndex]; trigger.textContent = selected?.textContent.trim() || 'Choose'; options.forEach(item => { const active = item.dataset.value === select.value; item.classList.toggle('is-selected', active); item.setAttribute('aria-selected', String(active)); }); };
    trigger.addEventListener('click', () => { const open = !wrap.classList.contains('is-open'); closeMenus(wrap); wrap.classList.toggle('is-open', open); trigger.setAttribute('aria-expanded', String(open)); });
    trigger.addEventListener('keydown', event => { if (event.key === 'Escape') { wrap.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); } });
    select.addEventListener('change', sync); field.replaceChild(wrap, select); wrap.append(trigger, select, menu); sync();
  };
  document.querySelectorAll('.units-filter select').forEach(enhanceSelect);
  document.addEventListener('click', event => { if (!event.target.closest('.units-select-wrap')) closeMenus(); });
  const onlineOption = [...$('f-status').options].find(option => option.value === 'online');
  if (onlineOption) onlineOption.textContent = 'Online';
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'units-reset'; reset.textContent = 'Reset filters';
  reset.addEventListener('click', () => { $('f-search').value = ''; $('f-status').value = 'all'; $('f-batt').value = 'all'; if (sort) sort.value = 'name-asc'; document.querySelectorAll('.units-filter select').forEach(select => select.dispatchEvent(new Event('change', { bubbles: true }))); window.render(); });
  controls.append(reset);

  const table = document.querySelector('.table-wrapper');
  const section = document.createElement('section'); section.className = 'units-table-section'; section.setAttribute('aria-label', 'Fleet units');
  const toolbar = document.createElement('div'); toolbar.className = 'units-table-toolbar';
  const title = document.createElement('div'); title.className = 'units-table-title';
  title.innerHTML = '<h2>Fleet directory</h2><p id="units-result-count" role="status">Loading units…</p>';
  const exports = document.createElement('div'); exports.className = 'units-export-actions';
  const excel = document.querySelector('.excel-btn'); const pdf = document.querySelector('.pdf-btn');
  labelButton(excel, 'table-2', 'Export Excel'); labelButton(pdf, 'file-text', 'Export PDF');
  const batteryExport = document.querySelector('.excel-btn[onclick*="battery0"]'); labelButton(batteryExport, 'battery', 'Battery Report Excel');
  if (excel) exports.append(excel); if (pdf) exports.append(pdf);
  const exportPath = (format, filter = 'all') => {
    const params = new URLSearchParams({ filter, format, connection: $('f-status').value, battery: $('f-batt').value, search: $('f-search').value.trim(), sort: sort?.value || 'name-asc' });
    // EDIT BY NADA — Units exports choose a language, then download without opening a report viewer.
    params.set('download', '1'); params.set('chooseLanguage', '1');
    return '/api/reports/export?' + params;
  };
  window.exportExcel = filter => ObserverPreview.open(exportPath('xlsx', filter === 'battery0' ? 'battery0' : 'all'));
  window.exportPDF = () => ObserverPreview.open(exportPath('pdf'));
  toolbar.append(title, exports); table.before(section); section.append(toolbar, table);
  table.tabIndex = 0; table.setAttribute('role', 'region'); table.setAttribute('aria-label', 'Units table; scroll to see all columns and rows');
  const foot = document.createElement('p'); foot.className = 'units-table-hint'; foot.append(icon('eye'), document.createTextNode('Select a unit to view its full details.')); section.append(foot);
  document.querySelectorAll('th').forEach(th => th.scope = 'col');

  const formatDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  let dataReady = false;
  const decorate = () => {
    const records = typeof units === 'undefined' ? [] : units;
    const rows = [...$('tbody').rows].filter(row => row.cells.length === 9);
    if ($('f-batt').value === 'down') rows.forEach(row => { const id = row.getAttribute('onclick')?.match(/openUnit\((\d+)\)/)?.[1], unit = records.find(record => String(record.id) === id); row.hidden = row.hidden || !ObserverBattery.matches(unit, 'down'); });
    const visible = rows.filter(row => !row.hidden);
    const empty = $('tbody').querySelector('.units-filter-empty');
    if (!visible.length && rows.length && !empty) { const row = document.createElement('tr'), cell = document.createElement('td'); row.className = 'units-filter-empty'; cell.colSpan = 9; cell.textContent = 'No units match these filters.'; row.append(cell); $('tbody').append(row); }
    else if (visible.length && empty) empty.remove();
    if ($('tbody').textContent.includes('Error loading fleet data')) {
      $('units-result-count').textContent = 'Unable to load units';
      for (const key of ['total', 'online', 'offline']) $(`units-count-${key}`).textContent = '—';
      return;
    }
    if (rows.length || (typeof units !== 'undefined' && $('tbody').textContent.includes('No data found'))) dataReady = true;
    if (dataReady) {
      const online = records.filter(unit => !unit.isOffline).length;
      for (const [key, count] of [['total', records.length], ['online', online], ['offline', records.length - online]]) {
        $(`units-count-${key}`).textContent = count; $(`stat-${key}`).textContent = count;
      }
      $('units-result-count').textContent = `${visible.length} of ${records.length} units`;
    }
    groups.forEach(([key, , , , filter]) => document.querySelector(`.units-stat-${key}`).setAttribute('aria-pressed', String($('f-status').value === filter)));
    visible.forEach((row, index) => {
      row.cells[0].textContent = index + 1;
      if (row.dataset.unitsStyled) return;
      row.dataset.unitsStyled = 'true'; row.style.setProperty('--row-delay', `${Math.min(index, 9) * 30}ms`);
      const name = row.cells[2].textContent.trim();
      row.tabIndex = 0; row.setAttribute('role', 'link'); row.setAttribute('aria-label', `View ${name}`);
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.click(); } });
      row.cells[2].append(icon('chevron-right'));
      const date = new Date(row.cells[4].textContent.trim());
      if (!Number.isNaN(date.valueOf())) { row.cells[4].title = row.cells[4].textContent.trim(); row.cells[4].textContent = formatDate.format(date); }
      for (const cell of [row.cells[7], row.cells[8]]) if (/^(?:null|undefined|NaN)\s*V$/.test(cell.textContent.trim())) { cell.textContent = '—'; cell.classList.remove('batt-zero'); }
    });
  };
  const render = window.render;
  window.render = (...args) => { render(...args); decorate(); };
  sort?.addEventListener('change', () => queueMicrotask(decorate));
  // Observe row replacement as well as normal renders so loading failures get a clear label.
  new MutationObserver(decorate).observe($('tbody'), { childList: true });
  decorate();
})();
