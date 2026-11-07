// EDIT BY NADA — trusted local shell. Sandboxed pages have opaque origins and no storage/cookie access.
(() => {
  const P = globalThis.ObserverPreview, $ = id => document.getElementById(id), frame = $('page-frame');
  let questionResolve, scanResolve, stream, detectorTimer, report, reportSource, reportPath, reportLanguage = 'en', pendingQuestions = Promise.resolve();
  // EDIT BY NADA — sensor-only refresh state keeps selections and exports in sync.
  let sensorControls = null, sensorSequence = 0, sensorRefresh = Promise.resolve(), sensorSelection = null, reportPageTitle = null;
  const labels = ['Dashboard', 'Units', 'Unit details', 'Observer reports', 'Wialon reports', 'SMS / WhatsApp', 'Maintenance requests', 'Installations', 'Maintenance reports', 'Admin users', 'Login', 'Standalone login', 'Wialon callback'];
  const status = text => { $('preview-status').textContent = text; };
  const activity = text => { const entry = document.createElement('li'); entry.textContent = `${new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo' })} Cairo · ${text}`; $('activity-list').prepend(entry); while ($('activity-list').children.length > 100) $('activity-list').lastChild.remove(); };
  const ask = (kind, text, initial = '') => {
    const action = pendingQuestions.then(() => new Promise(resolve => { questionResolve = resolve; $('question-title').textContent = kind === 'prompt' ? 'Enter a demo value' : 'Confirm local demo action'; $('question-text').textContent = text; $('answer-label').hidden = kind !== 'prompt'; $('question-answer').value = initial; $('question-dialog').showModal(); if (kind === 'prompt') $('question-answer').focus(); }));
    pendingQuestions = action.catch(() => {}); return action;
  };
  $('question-form').addEventListener('submit', event => { event.preventDefault(); const accepted = event.submitter?.value === 'ok', prompt = !$('answer-label').hidden; $('question-dialog').close(); questionResolve?.(prompt ? accepted ? $('question-answer').value : null : accepted); questionResolve = null; });
  $('question-dialog').addEventListener('cancel', () => { questionResolve?.(null); questionResolve = null; });
  const resolveReportLanguage = path => { const lang = new URL(path, location.origin).searchParams.get('lang'); return ['ar', 'en'].includes(lang) ? lang : reportLanguage; };
  const reportPathLanguage = (path, lang) => { const url = new URL(path, location.origin); if (url.origin !== location.origin) throw new Error('External report destination blocked.'); url.searchParams.set('lang', lang); return url.pathname + url.search; };
  // EDIT BY NADA — only Fleet directory downloads request language; report viewers keep their existing behavior.
  let unitsExportResolve = null;
  const unitsExportDialog = $('units-export-dialog');
  const chooseUnitsExportLanguage = format => {
    if (unitsExportDialog.open) return Promise.resolve(null);
    $('units-export-format').textContent = format === 'pdf' ? 'PDF · تنزيل مباشر / Direct download' : 'CSV (Excel) · تنزيل مباشر / Direct download';
    unitsExportDialog.querySelector(`input[value="${reportLanguage}"]`).checked = true;
    unitsExportDialog.returnValue = '';
    return new Promise(resolve => { unitsExportResolve = resolve; unitsExportDialog.showModal(); });
  };
  unitsExportDialog.addEventListener('close', () => {
    const resolve = unitsExportResolve; unitsExportResolve = null;
    const lang = unitsExportDialog.returnValue === 'download' ? unitsExportDialog.querySelector('input:checked').value : null;
    if (lang) reportLanguage = lang;
    resolve?.(lang);
  });
  const configure = () => { const state = P.read(); $('persona').replaceChildren(...state.users.filter(u => u.isActive).map(u => new Option(u.displayName, u._id))); $('persona').value = state.activeUser; $('access-mode').value = state.mode; $('scenario').value = state.scenario; };
  $('page-picker').append(...P.pages.map((p, i) => new Option(labels[i], p)));
  // EDIT BY NADA - keep Wialon in the shared page dropdown instead of adding a one-off sidebar button.
  const wialonOption = new Option('🌐 Wialon Hosting', 'external:wialon');
  $('page-picker').append(wialonOption);
  // Keep the main navigation focused on daily work; technical entry pages remain routable.
  P.mutate(state => { state.scenario = 'normal'; state.mode = 'explore'; });
  const pageNavConfig = [
    ['index.html', 'Dashboard', 'layout-dashboard'],
    ['units.html', 'Units', 'truck'],
    ['observer-reports.html', 'Observer Reports', 'chart-column'],
    ['wialon-reports.html', 'Wialon Reports', 'file-chart-column'],
    ['sms.html', 'SMS / WhatsApp', 'message-square'],
    ['maintenance.html', 'Maintenance requests', 'wrench'],
    ['installations.html', 'Installations', 'clipboard-check'],
    ['maintenance-report.html', 'Maintenance reports', 'clipboard-list'],
    ...(P.user(P.read()).role === 'admin' ? [['admin-users.html', 'Admin users', 'users']] : []),
    ['external:wialon', 'Wialon Hosting', 'globe']
  ];
  const pageNavButtons = pageNavConfig.map(([page, label, iconName]) => {
    const button = document.createElement('button'), text = document.createElement('span');
    button.type = 'button'; button.className = 'sidebar-page-link'; button.dataset.page = page;
    button.innerHTML = ObserverIcons.svg(iconName); text.textContent = label; button.append(text);
    if (page === 'external:wialon') { button.classList.add('sidebar-external-link'); button.title = 'Open Wialon Hosting in a new tab'; }
    button.addEventListener('click', () => { $('page-picker').value = page; $('page-picker').dispatchEvent(new Event('change', { bubbles: true })); });
    $('sidebar-page-links').append(button); return button;
  });
  const syncPageNav = () => {
    const current = $('page-picker').value === 'unit.html' ? 'units.html' : $('page-picker').value;
    // EDIT BY NADA — temporarily hide Wialon Reports for every account while retaining its page and access rules.
    const wialonPage = [...$('page-picker').options].find(option => option.value === 'wialon-reports.html');
    wialonPage.hidden = true; wialonPage.disabled = true;
    for (const button of pageNavButtons) {
      // EDIT BY NADA — keep the shared sidebar entry hidden after every navigation or persona refresh.
      if (button.dataset.page === 'wialon-reports.html') button.hidden = true;
      const active = button.dataset.page === current;
      button.classList.toggle('is-selected', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
  };
  $('mobile-menu-toggle').innerHTML = ObserverIcons.svg('menu') + '<span>Menu</span>';
  $('preview-logout').innerHTML = ObserverIcons.svg('log-out') + '<span>Logout</span>';
  $('report-back').innerHTML = ObserverIcons.svg('arrow-left') + '<span>Back</span>';
  // EDIT BY NADA — in-flow, scrollable sidebar choices retain the original select/change contracts.
  const sidebarPickers = new Map();
  // EDIT BY NADA — keep mobile navigation compact while preserving desktop controls.
  const mobileMenu = $('mobile-menu-toggle'), sidebarControls = $('mobile-sidebar-controls');
  const compactFrame = matchMedia('(max-width: 900px)');
  let installationModalOpen=false, lastPageHeight=520;
  const syncInstallationModal=()=>{
    const active=installationModalOpen&&compactFrame.matches;
    document.body.classList.toggle('preview-installation-modal',active);
    document.documentElement.style.setProperty('--preview-modal-height',`${window.visualViewport?.height||innerHeight}px`);
    document.documentElement.style.setProperty('--preview-modal-top',`${window.visualViewport?.offsetTop||0}px`);
  };
  window.addEventListener('resize',syncInstallationModal);
  window.visualViewport?.addEventListener('resize',syncInstallationModal);
  window.visualViewport?.addEventListener('scroll',syncInstallationModal);
  const syncFrameMode = () => {
    if (compactFrame.matches) frame.style.height = '520px';
    else frame.style.removeProperty('height');
    syncInstallationModal();
  };
  compactFrame.addEventListener('change', syncFrameMode);
  syncFrameMode();
  mobileMenu.addEventListener('click', () => { const expanded = mobileMenu.getAttribute('aria-expanded') === 'true'; mobileMenu.setAttribute('aria-expanded', String(!expanded)); sidebarControls.classList.toggle('is-open', !expanded); });
  for (const select of document.querySelectorAll('#preview-sidebar select')) {
    if (select.id === 'page-picker') continue;
    const details = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('div');
    details.className = 'sidebar-picker'; list.className = 'sidebar-picker-options';
    summary.setAttribute('aria-label', select.getAttribute('aria-label') || select.parentElement.firstChild.textContent.trim());
    select.hidden = true; select.after(details); details.append(summary, list);
    const sync = () => {
      summary.textContent = select.selectedOptions[0]?.textContent || 'Select';
      list.replaceChildren(...Array.from(select.options, option => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = option.textContent;
        button.className = option.selected ? 'is-selected' : ''; button.disabled = option.disabled;
        button.setAttribute('aria-pressed', String(option.selected));
        button.addEventListener('click', () => { select.value = option.value; details.open = false; select.dispatchEvent(new Event('change', { bubbles: true })); sync(); summary.focus(); });
        return button;
      }));
    };
    details.addEventListener('toggle', () => { if (details.open) for (const other of sidebarPickers.values()) if (other.details !== details) other.details.open = false; });
    details.addEventListener('keydown', event => { if (event.key === 'Escape' && details.open) { details.open = false; summary.focus(); event.preventDefault(); } });
    select.addEventListener('change', sync); sidebarPickers.set(select.id, { details, sync }); sync();
  }
  const syncSidebar = () => { for (const picker of sidebarPickers.values()) picker.sync(); syncPageNav(); };
  const pageFrom = raw => { const url = new URL(raw, location.origin); if (url.origin !== location.origin || url.username || url.password) throw new Error('External navigation blocked.'); const page = url.pathname.replace(/^\/pages\//, '').replace(/^\//, '') || 'index.html'; if (!P.pages.includes(page)) throw new Error('Unknown page blocked.'); return { page, search: url.search }; };
  const navigate = (raw, replace = false) => {
    try {
      const target = pageFrom(raw), state = P.read(), user = P.user(state), permission = P.pagePermissions[target.page];
      if (target.page === 'wialon-reports.html' && user.authMode !== 'local') { activity('Wialon Reports is restricted to local accounts.'); return navigate('/index.html', true); }
      // EDIT BY NADA — remove stale all-access content when switching to a restricted persona.
      if (state.mode === 'permissions' && user.role !== 'admin' && permission && (!user.permissions[permission] || target.page === 'admin-users.html')) { frame.src = 'about:blank'; closeReport(); stopScanner(null); status(`Demo access denied for ${permission}. Choose Explore all pages to inspect this page.`); activity(`DENIED page ${target.page}`); return; }
      installationModalOpen=false;lastPageHeight=520;syncInstallationModal();
      stopScanner(null); $('page-picker').value = target.page;
      // EDIT BY NADA - restore the page's own title without changing shared sidebar controls.
      document.title = target.page === 'sms.html' ? 'Observer — SMS' : 'Observer Fleet · PREVIEW MODE';
      syncSidebar();
      if (matchMedia('(max-width: 720px)').matches) { mobileMenu.setAttribute('aria-expanded', 'false'); sidebarControls.classList.remove('is-open'); }
      if (compactFrame.matches) frame.style.height = '520px';
      const query = target.search || (target.page === 'unit.html' ? '?id=1001' : '');
      const shellUrl = `/?page=${encodeURIComponent(target.page)}${query ? '&args=' + encodeURIComponent(query) : ''}`;
      history[replace ? 'replaceState' : 'pushState']({}, '', shellUrl);
      frame.src = `/pages/${target.page}${query}`;
      status(`PREVIEW MODE · ${labels[P.pages.indexOf(target.page)]} · ${state.mode === 'explore' ? 'All pages available' : user.displayName + ' permission demonstration'} · Changes stay in this browser.`);
    } catch (error) { status(error.message); activity(`BLOCKED ${raw}`); }
  };
  const reload = () => navigate('/' + $('page-picker').value + (new URL(frame.src || location.href).search || ''), true);
  $('page-picker').addEventListener('change', () => {
    if ($('page-picker').value === 'external:wialon') {
      $('page-picker').value = new URL(location.href).searchParams.get('page') || 'index.html';
      syncSidebar();
      window.open('https://hosting.wialon.eu/?lang=en', '_blank', 'noopener,noreferrer');
      return;
    }
    navigate('/' + $('page-picker').value);
  });
  for (const [id, key] of [['persona', 'activeUser'], ['access-mode', 'mode'], ['scenario', 'scenario']]) $(id).addEventListener('change', () => { P.mutate(s => { s[key] = $(id).value; }); reload(); });
  $('reset').addEventListener('click', async () => { if (!await ask('confirm', 'Reset all demo records, files, signatures, permissions and settings in this preview? Production data is never accessed.')) return; try { await P.reset(); configure(); syncSidebar(); $('activity-list').replaceChildren(); closeReport(); navigate('/index.html', true); activity('RESET local demo data and attachments'); } catch (error) { status(error.message); } });
  $('activity-toggle').addEventListener('click', () => { $('activity').hidden = !$('activity').hidden; $('activity-toggle').setAttribute('aria-expanded', String(!$('activity').hidden)); });
  // EDIT BY NADA — mirror the dashboard's demo logout using the local handler and preview navigation.
  $('preview-logout').addEventListener('click', async () => { try { await P.handle('/api/logout', 'POST'); activity('LOCAL demo logout'); navigate('/login.html'); } catch (error) { status(error.message); } });
  // EDIT BY NADA — discard pending sensor updates and restore the page title on return.
  function closeReport() {
    if (report) for (const image of report.images) if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url);
    if (reportPageTitle !== null) document.title = reportPageTitle;
    reportPageTitle = null; sensorSequence++; sensorControls = null; sensorSelection = null; sensorRefresh = Promise.resolve();
    ['report-csv', 'report-json', 'report-print'].forEach(id => $(id).disabled = false);
    report = null; reportSource = null; reportPath = null; $('report-panel').hidden = true; $('report-content').replaceChildren(); $('report-content').removeAttribute('aria-busy');
  }
  $('report-back').addEventListener('click', closeReport);
  // EDIT BY NADA — output waits for the latest sensor selection instead of exporting stale rows.
  const outputReport = async action => { await sensorRefresh; if (!report) return; const source = reportSource; await document.fonts.ready; if (report && reportSource === source) await action(); };
  $('report-csv').addEventListener('click', () => outputReport(() => P.download(report.sensor ? 'sensor-report.csv' : 'observer-demo.csv', P.csv(report.rows), 'text/csv;charset=utf-8')).catch(error => status(error.message)));
  $('report-json').addEventListener('click', () => outputReport(() => P.download(report.sensor ? 'sensor-report.json' : 'observer-demo.json', JSON.stringify({ preview: true, lang: report.lang, title: report.title, rows: report.rows }, null, 2), 'application/json')).catch(error => status(error.message)));
  $('report-print').addEventListener('click', () => outputReport(() => window.print()).catch(error => status(error.message)));
  document.querySelectorAll('[data-report-lang]').forEach(button => button.addEventListener('click', () => { if (reportSource) renderReportLanguage(button.dataset.reportLang); }));
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p' && report) { event.preventDefault(); $('report-print').click(); } });
  // EDIT BY NADA — refresh rows in place so multi-select menus and keyboard focus stay open.
  function updateSensorFilters(selected) {
    if (!report?.sensor) return Promise.resolve();
    const sequence = ++sensorSequence, nextPath = ObserverSensorReport.path(reportPath, selected);
    sensorSelection = selected; sensorControls?.setError(''); $('report-content').setAttribute('aria-busy', 'true');
    ['report-csv', 'report-json', 'report-print'].forEach(id => $(id).disabled = true);
    sensorRefresh = (async () => {
      let succeeded = false;
      try {
        const next = await P.report(reportPathLanguage(nextPath, 'en'));
        if (sequence !== sensorSequence || !report?.sensor) return;
        reportSource = next; reportPath = nextPath; sensorSelection = null; report = ObserverReportLanguage.report(next, reportLanguage);
        const fragment = document.createElement('template'); fragment.innerHTML = P.reportHtml(report);
        $('report-content').querySelector('.report-table-scroll').replaceWith(fragment.content.querySelector('.report-table-scroll'));
        sensorControls?.setCount(report.sensor.total); succeeded = true;
      } catch (error) { if (sequence === sensorSequence) sensorControls?.setError(error.message); }
      finally {
        if (sequence === sensorSequence) {
          $('report-content').removeAttribute('aria-busy');
          if (succeeded) ['report-csv', 'report-json', 'report-print'].forEach(id => $(id).disabled = false);
        }
      }
    })();
    return sensorRefresh;
  }
  function renderReportLanguage(lang) {
    reportLanguage = lang; report = ObserverReportLanguage.report(reportSource, lang);
    const arabic = report.lang === 'ar';
    $('report-content').innerHTML = P.reportHtml(report);
    $('report-content').dir = arabic ? 'rtl' : 'ltr'; $('report-content').lang = report.lang;
    // EDIT BY NADA — filters exist only on Sensor Report and apply immediately, independently.
    if (report.sensor) {
      const S = globalThis.ObserverSensorReport;
      sensorControls = S.createFilters({ options: report.sensor.options, selected: sensorSelection || report.sensor.selected, total: report.sensor.total, lang, onChange: updateSensorFilters });
      $('report-content').querySelector('.report-summary').after(sensorControls.element);
      document.title = 'Sensor Report';
    }
    $('report-back').querySelector('span').textContent = arabic ? 'رجوع' : 'Back';
    $('report-back').setAttribute('aria-label', arabic ? 'الرجوع إلى التقارير' : 'Back to reports');
    $('report-csv').textContent = arabic ? 'تنزيل CSV تجريبي' : 'Download demo CSV';
    $('report-json').textContent = arabic ? 'تنزيل JSON تجريبي' : 'Download demo JSON';
    // EDIT BY NADA — remove the JSON action from every in-app report viewer, including installation records.
    $('report-json').hidden = true;
    $('report-print').textContent = arabic ? 'طباعة / حفظ PDF' : 'Print / Save as PDF';
    $('report-language-label').textContent = arabic ? 'لغة التقرير' : 'Report language';
    document.querySelectorAll('[data-report-lang]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.reportLang === lang)));
    $('report-panel').setAttribute('aria-label', arabic ? 'عرض التقرير' : 'Report viewer');
  }
  async function showReport(path, lang, autoDownload = true) {
    // EDIT BY NADA — give the sensor viewer its exact title without renaming its source page.
    const next = await P.report(reportPathLanguage(path, 'en')); closeReport(); reportPageTitle = document.title; reportSource = next; reportPath = path; renderReportLanguage(lang);
    $('report-panel').hidden = false; activity(`LOCAL REPORT ${path}`);
    if (autoDownload && report.requestedFormat === 'xlsx') { P.download(report.sensor ? 'sensor-report.csv' : 'observer-demo.csv', P.csv(report.rows), 'text/csv;charset=utf-8'); status('Demo CSV downloaded. XLSX generation requires the real backend or an approved browser library.'); }
  }
  // EDIT BY NADA — direct downloads also support the Preview's actual Excel-compatible CSV format.
  async function downloadReport(path, format, fileName) {
    if (!['pdf', 'word', 'xlsx'].includes(format)) throw new Error('Invalid report download request.');
    const next = await P.report(path), name = (fileName || next.title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 90) || 'maintenance-report';
    try {
      if (format === 'pdf') P.download(`${name}.pdf`, await P.pdf(next), 'application/pdf');
      // EDIT BY NADA — preserve PDF/Word output and use an honest .csv extension for Preview spreadsheets.
      else if (format === 'word') P.download(`${name}.doc`, '\ufeff' + await P.word(next), 'application/msword;charset=utf-8');
      else P.download(`${name}.csv`, P.csv(next.rows), 'text/csv;charset=utf-8');
      status(`${format === 'pdf' ? 'PDF' : format === 'word' ? 'Word' : 'CSV'} report downloaded.`); activity(`LOCAL ${format.toUpperCase()} DOWNLOAD ${path}`);
    } finally { for (const image of next.images || []) if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url); }
  }
  function stopScanner(value) { clearInterval(detectorTimer); detectorTimer = null; stream?.getTracks().forEach(track => track.stop()); stream = null; $('scan-video').srcObject = null; $('scan-video').hidden = true; if ($('scan-dialog').open) $('scan-dialog').close(); const resolve = scanResolve; scanResolve = null; resolve?.(value); }
  $('scan-sample').addEventListener('click', () => { const value = $('scan-value').value.trim(); if (value) stopScanner(value); });
  $('scan-close').addEventListener('click', () => stopScanner(null));
  $('scan-dialog').addEventListener('cancel', () => stopScanner(null));
  $('scan-camera').addEventListener('click', async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.BarcodeDetector) throw new Error('Camera decoding is unavailable here. Use the sample/manual value.');
      if (stream) return;
      const formats = await BarcodeDetector.getSupportedFormats(); if (!formats.length) throw new Error('No supported barcode formats. Use manual input.');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (!$('scan-dialog').open) { stopScanner(null); return; }
      $('scan-video').srcObject = stream; $('scan-video').hidden = false; await $('scan-video').play(); const detector = new BarcodeDetector({ formats }); let detecting = false;
      detectorTimer = setInterval(async () => { if (detecting) return; detecting = true; try { const codes = await detector.detect($('scan-video')); if (codes[0]?.rawValue) stopScanner(codes[0].rawValue); } catch { /* EDIT BY NADA — scan misses have no external fallback. */ } finally { detecting = false; } }, 300);
      $('scan-status').textContent = 'Camera processing stays on this device.';
    } catch (error) { stream?.getTracks().forEach(t => t.stop()); stream = null; $('scan-status').textContent = error.message; }
  });
  window.addEventListener('message', async event => {
    if (event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.channel !== 'observer-preview-v1') return;
    const { id, type, payload } = event.data; const source = event.source;
    if (!Number.isInteger(id) || id < 1) return;
    try {
      let result;
      if (type === 'request') { if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(payload.method) || typeof payload.path !== 'string' || payload.path.length > 4096) throw new Error('Invalid preview request.'); activity(`LOCAL ${payload.method} ${payload.path}`); await new Promise(resolve => setTimeout(resolve, 45)); result = await P.handle(payload.path, payload.method, payload.body); configure(); syncSidebar(); }
      else if (type === 'resize') {
        const height = Number(payload.height);
        if (!Number.isFinite(height) || height < 1 || height > 50000) throw new Error('Invalid preview page height.');
        lastPageHeight=height;
        if (compactFrame.matches&&!installationModalOpen) frame.style.height = `${Math.max(520, height)}px`;
        result = true;
      }
      else if(type==='installation-modal'){
        if($('page-picker').value!=='installations.html'||typeof payload.open!=='boolean')throw new Error('Invalid installation layout request.');
        installationModalOpen=payload.open;syncInstallationModal();
        if(!installationModalOpen&&compactFrame.matches)frame.style.height=`${Math.max(520,lastPageHeight)}px`;
        result=true;
      }
      else if(type==='report-download'){
        if($('page-picker').value!=='maintenance-report.html'||typeof payload.path!=='string'||typeof payload.format!=='string')throw new Error('Invalid report download request.');
        if(!/^\/api\/maintenance-reports\/[^/]+\/pdf(?:\?.*)?$/.test(payload.path))throw new Error('Invalid report download path.');
        const lang=resolveReportLanguage(payload.path);
        await downloadReport(reportPathLanguage(payload.path,lang),payload.format);result=true;
      }
      else if (type === 'navigate') { navigate(payload.path); result = true; }
      else if (type === 'export') {
        if(typeof payload.path!=='string'||payload.path.length>4096)throw new Error('Invalid report request.');
        // EDIT BY NADA — intercept only Units Fleet directory downloads, before the generic report viewer path.
        const url=new URL(payload.path,location.origin);
        if(url.origin!==location.origin)throw new Error('External report destination blocked.');
        if($('page-picker').value==='units.html'&&url.pathname==='/api/reports/export'&&url.searchParams.get('chooseLanguage')==='1'){
          const format=url.searchParams.get('format');
          if(!['xlsx','pdf'].includes(format))throw new Error('Invalid Units export format.');
          const lang=await chooseUnitsExportLanguage(format);
          if(lang&&$('page-picker').value==='units.html')await downloadReport(reportPathLanguage(payload.path,lang),format,`fleet-report-demo-${lang}`);
        }else{
          const lang=resolveReportLanguage(payload.path),path=reportPathLanguage(payload.path,lang);
          if(url.searchParams.get('download')==='1'&&(url.pathname.endsWith('/pdf')||url.searchParams.get('format')==='pdf'))await downloadReport(path,'pdf');else await showReport(path,lang);
        }
        result=true;
      }
      else if (type === 'alert') { status(`PREVIEW MODE · ${payload.text}`); result = true; }
      else if (type === 'confirm' || type === 'prompt') result = await ask(type, String(payload.text), payload.initial || '');
      else if (type === 'scan') { stopScanner(null); $('scan-status').textContent = ''; $('scan-value').value = '990000000000001'; $('scan-dialog').showModal(); result = await new Promise(resolve => { scanResolve = resolve; }); }
      else if (type === 'scan-stop') { stopScanner(null); result = true; }
      else if (type === 'ready') { activity(`PAGE READY ${payload.page}`); result = true; }
      else throw new Error('Unknown preview bridge operation blocked.');
      source.postMessage({ channel: 'observer-preview-response-v1', id, result }, '*');
    } catch (error) { activity(`LOCAL ERROR ${error.message}`); source.postMessage({ channel: 'observer-preview-response-v1', id, error: error.message, status: error.status || 400 }, '*'); }
  });
  window.addEventListener('popstate', () => { const params = new URLSearchParams(location.search); navigate('/' + (params.get('page') || 'index.html') + (params.get('args') || ''), true); });
  window.addEventListener('beforeunload', () => stopScanner(null));
  try { configure(); syncSidebar(); const params = new URLSearchParams(location.search); navigate('/' + (params.get('page') || 'index.html') + (params.get('args') || ''), true); }
  catch (error) { status(error.message); activity(error.message); }
})();
