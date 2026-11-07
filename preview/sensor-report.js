// EDIT BY NADA — sensor schema and multi-select controls for the Sensor Report page.
(() => {
  const missing = '__missing__';
  const text = value => value === null || value === undefined || String(value).trim() === '' || ['N/A', 'null', 'undefined'].includes(String(value).trim()) ? '' : String(value).trim();
  // EDIT BY NADA — use existing integration fields; unresolved hardware names are unavailable.
  const deviceType = unit => {
    const value = typeof unit.deviceType === 'string' ? text(unit.deviceType) : '';
    return /^unknown(?:\s+hw(?:\s*\([^)]*\))?)?$/i.test(value) ? '' : value;
  };
  const metadata = unit => ({
    deviceType: deviceType(unit), account: text(unit.accountGroup),
    imei: text(unit.imei) || text(unit.serialNumber), sim: text(unit.mobileNumber)
  });
  const key = value => value || missing;
  const compare = (left, right) => String(left || '').localeCompare(String(right || ''), 'en', { numeric: true, sensitivity: 'base' });
  const selection = url => ({ deviceTypes: url.searchParams.getAll('deviceTypes'), accounts: url.searchParams.getAll('accounts') });
  const filter = (units, selected = {}) => units.filter(unit => {
    const data = metadata(unit);
    return (!(selected.deviceTypes || []).length || selected.deviceTypes.includes(key(data.deviceType))) && (!(selected.accounts || []).length || selected.accounts.includes(key(data.account)));
  }).sort((left, right) => compare(metadata(left).account, metadata(right).account) || compare(left.name, right.name) || compare(left.id, right.id));
  const options = units => {
    // EDIT BY NADA — offer only captured values, trimmed and deduplicated; no invented type bucket.
    const collect = property => { const values = new Map(); units.forEach(unit => { const value = metadata(unit)[property]; if (value) values.set(value, (values.get(value) || 0) + 1); }); return [...values].sort(([left], [right]) => compare(left, right)).map(([value, count]) => ({ value, count })); };
    return { deviceTypes: collect('deviceType'), accounts: collect('account') };
  };
  const path = (source, selected) => {
    const url = new URL(source, 'http://sensor.invalid');
    ['deviceTypes', 'accounts'].forEach(name => { url.searchParams.delete(name); [...new Set(selected[name] || [])].forEach(value => url.searchParams.append(name, value)); });
    return url.pathname + url.search;
  };
  const copy = {
    // EDIT BY NADA — distinguish absent captured data from a search with no matches.
    en: { title: 'Filter sensor units', deviceTypes: 'Device Type', accounts: 'Account Name', all: 'All', selected: 'selected', search: 'Search…', selectAll: 'Select all', clear: 'Clear', reset: 'Reset filters', apply: 'Apply filters', missing: 'Not available', empty: 'No matching options', noTypes: 'No device types are available in the unit data.', noAccounts: 'No account names are available in the unit data.', units: 'units', sorted: 'Sorted by Account Name' },
    ar: { title: 'تصفية وحدات الحساسات', deviceTypes: 'نوع الجهاز', accounts: 'اسم الحساب', all: 'الكل', selected: 'محدد', search: 'بحث…', selectAll: 'تحديد الكل', clear: 'مسح', reset: 'إعادة التعيين', apply: 'تطبيق الفلاتر', missing: 'غير متاح', empty: 'لا توجد اختيارات مطابقة', noTypes: 'أنواع الأجهزة غير متاحة في بيانات الوحدات.', noAccounts: 'أسماء الحسابات غير متاحة في بيانات الوحدات.', units: 'وحدة', sorted: 'الترتيب حسب اسم الحساب' }
  };
  const createFilters = config => {
    const lang = config.lang === 'ar' ? 'ar' : 'en', labels = copy[lang], root = document.createElement('section');
    root.className = 'sensor-report-filters'; root.lang = lang; root.dir = lang === 'ar' ? 'rtl' : 'ltr'; root.setAttribute('aria-label', labels.title);
    const selected = { deviceTypes: new Set(config.selected?.deviceTypes || []), accounts: new Set(config.selected?.accounts || []) }, menus = [];
    const current = () => ({ deviceTypes: [...selected.deviceTypes], accounts: [...selected.accounts] });
    const node = (tag, cls, content) => { const value = document.createElement(tag); if (cls) value.className = cls; if (content !== undefined) value.textContent = content; return value; };
    const button = (label, action) => { const value = node('button', '', label); value.type = 'button'; value.addEventListener('click', action); return value; };
    const fields = node('div', 'sensor-filter-fields'); root.append(fields);
    ['deviceTypes', 'accounts'].forEach(name => {
      const field = node('div', 'sensor-filter-field'), label = node('span', 'sensor-filter-label', labels[name]), menu = node('details', 'sensor-filter-menu'), trigger = node('summary', 'sensor-filter-trigger'), list = node('div', 'sensor-filter-popover');
      trigger.setAttribute('aria-label', labels[name]); menu.append(trigger, list); field.append(label, menu); fields.append(field); menus.push(menu);
      const searchLabel = node('label', 'sensor-filter-search'), search = node('input'); search.type = 'search'; search.placeholder = labels.search; search.setAttribute('aria-label', `${labels.search} ${labels[name]}`); searchLabel.append(node('span', 'sensor-visually-hidden', labels[name]), search);
      const bulk = node('div', 'sensor-filter-bulk'), choices = node('div', 'sensor-filter-choices'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', labels[name]);
      const available = config.options[name] || [];
      const caption = () => { trigger.textContent = selected[name].size ? `${selected[name].size} ${labels.selected}` : labels.all; };
      const notify = () => { caption(); config.onChange?.(current()); };
      const render = () => { choices.replaceChildren(); const matching = available.filter(option => (option.value === missing ? labels.missing : option.value).toLowerCase().includes(search.value.trim().toLowerCase()));
        // EDIT BY NADA — missing integration values are explanatory text, never selectable types.
        if (!matching.length) choices.append(node('p', 'sensor-filter-empty', available.length ? labels.empty : labels[name === 'deviceTypes' ? 'noTypes' : 'noAccounts']));
        matching.forEach(option => { const row = node('label', 'sensor-filter-option'), check = node('input'); check.type = 'checkbox'; check.value = option.value; check.checked = selected[name].has(option.value); check.dataset.sensorFilter = name; check.addEventListener('change', () => { if (check.checked) selected[name].add(option.value); else selected[name].delete(option.value); notify(); }); row.append(check, node('span', '', option.value === missing ? labels.missing : option.value), node('small', '', String(option.count))); choices.append(row); });
      };
      bulk.append(button(labels.selectAll, () => { available.forEach(option => selected[name].add(option.value)); render(); notify(); }), button(labels.clear, () => { selected[name].clear(); render(); notify(); }));
      list.append(searchLabel, bulk, choices); search.addEventListener('input', render);
      menu.addEventListener('toggle', () => { if (menu.open) {
        menus.forEach(other => { if (other !== menu) other.open = false; });
        const rect = trigger.getBoundingClientRect(), below = innerHeight - rect.bottom - 14, above = rect.top - 14, openUp = below < 240 && above > below, available = openUp ? above : below;
        list.style.top = openUp ? 'auto' : 'calc(100% + 11px)'; list.style.bottom = openUp ? 'calc(100% + 11px)' : 'auto';
        choices.style.maxHeight = Math.max(36, Math.min(196, available - 135)) + 'px';
        search.focus({ preventScroll: true });
      } });
      menu.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.open = false; trigger.focus(); event.preventDefault(); event.stopPropagation(); } });
      menu.refresh = () => { render(); caption(); }; menu.refresh();
    });
    const footer = node('div', 'sensor-filter-footer'), count = node('span', 'sensor-filter-count', `${config.total ?? 0} ${labels.units} · ${labels.sorted}`); count.setAttribute('role', 'status');
    const reset = button(labels.reset, () => { selected.deviceTypes.clear(); selected.accounts.clear(); menus.forEach(menu => menu.refresh()); config.onChange?.(current()); config.onReset?.(current()); }); footer.append(count, reset);
    if (config.onApply) { const apply = button(labels.apply, () => { menus.forEach(menu => menu.open = false); config.onApply(current()); }); apply.className = 'sensor-filter-apply'; footer.append(apply); }
    // EDIT BY NADA — report local filter failures without silently exporting stale selections.
    const error = node('p', 'sensor-filter-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    root.append(footer, error);
    root.addEventListener('focusout', () => requestAnimationFrame(() => { if (!root.contains(document.activeElement)) menus.forEach(menu => menu.open = false); }));
    root.addEventListener('click', event => event.stopPropagation());
    // EDIT BY NADA — the viewer can update the count/error without recreating checkbox state.
    return { element: root, selection: current, setCount: total => count.textContent = `${total} ${labels.units} · ${labels.sorted}`, setError: message => { error.textContent = message; error.hidden = !message; } };
  };
  globalThis.ObserverSensorReport = Object.freeze({ metadata, filter, options, selection, path, createFilters });
})();
