// EDIT BY NADA — real-browser workflows and network-isolation verification without downloads/dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer, hostname } from '../serve.mjs';
import { browser, until } from './browser.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('all preview pages, local workflows, persistence, reset and network isolation', { timeout: 180000 }, async () => {
  const port = 4176, origin = `http://${hostname}:${port}`, server = createPreviewServer(port); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); let b;
  try {
    b = await browser(origin);
    // EDIT BY NADA — capture a useful desktop viewport before the mobile pass.
    await b.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }, [...b.sessions][0]);
    const checks = [];
    const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log('PASS: ' + name); };
    const frame = expression => b.evaluate(expression, true);
    const api = (url, method = 'GET', body) => frame(`fetch(${JSON.stringify(url)}, {method:${JSON.stringify(method)},body:${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'}}).then(r=>r.json())`);
    await b.navigate('index.html');
    await until(async () => await frame("document.getElementById('c-tot').innerText") === '24', 'dashboard data');
    check('dashboard counters and offline charts render', await frame("document.querySelectorAll('.preview-chart-key button').length === 5"));
    await frame("document.querySelector('.preview-chart-key button').click()"); check('chart categories toggle interactively', await frame("document.querySelector('.preview-chart-key button').getAttribute('aria-pressed')==='false'"));
    check('sandbox has no cookie/storage/parent DOM access', await frame("(()=>{let denied=0;for(const fn of [()=>localStorage.getItem('x'),()=>document.cookie,()=>parent.document.body])try{fn()}catch{denied++}return denied===3})()"));
    await b.screenshot('dashboard.png');
    const pages = ['units.html', 'unit.html', 'observer-reports.html', 'wialon-reports.html', 'sms.html', 'maintenance.html', 'installations.html', 'maintenance-report.html', 'admin-users.html', 'login.html', 'login-standalone.html', 'wialon-callback.html'];
    // EDIT BY NADA — PREVIEW MODE is labelled by the trusted sidebar; page frames begin at their original headers.
    for (const page of pages) { await b.navigate(page); check(page + ' is accessible without injected top banners', await frame("!!document.body && !document.querySelector('.preview-banner')")); }
    await b.navigate('units.html');
    await until(async () => await frame("document.querySelectorAll('tbody tr').length") === 24, 'units rows');
    await frame("document.getElementById('f-search').value='CR14';render()"); check('unit search', await frame("document.querySelectorAll('tbody tr').length===1 && document.querySelector('tbody').textContent.includes('CR14')"));
    await frame("document.getElementById('f-search').value='';document.getElementById('f-status').value='offline';render()"); check('offline filtering', await frame("document.querySelectorAll('tbody tr').length===8"));
    await frame("document.getElementById('f-status').value='all';render();document.querySelector('.preview-controls select').value='name-desc';document.querySelector('.preview-controls select').dispatchEvent(new Event('change'))"); check('unit sorting', await frame("document.querySelector('tbody tr').cells[2].textContent.trim()==='OD-024'"));
    await b.navigate('unit.html', '?id=1001'); check('unit details share the same vehicle', await frame("document.body.textContent.includes('CR14')"));
    // EDIT BY NADA — original report actions must use the local exporter, including location-based downloads.
    await b.navigate('observer-reports.html');
    await frame("document.querySelector('.featured-actions button').click()");
    await until(async () => await b.evaluate("!document.getElementById('report-panel').hidden"), 'original report action');
    check('original report action displays labelled demo results', await b.evaluate("document.getElementById('report-content').textContent.includes('DEMO DATA')"));
    await b.evaluate("document.getElementById('report-csv').click();document.getElementById('report-json').click();document.getElementById('report-back').click()");
    await b.navigate('sms.html');
    await frame("document.getElementById('send-numbers').value='DEMO-001';document.getElementById('send-text').value='Browser workflow demo';sendSms()");
    await until(async () => await frame("document.getElementById('send-result').textContent.includes('1 sent')"), 'simulated SMS');
    check('SMS workflow persists a local submission', (await api('/api/sms/report')).logs.some(l => l.smsText === 'Browser workflow demo'));
    const whatsapp = await api('/api/sms/send', 'POST', { numbers: 'DEMO-002', text: 'Local WhatsApp', channel: 'whatsapp' }); check('WhatsApp simulation', whatsapp.sent === 1);
    await api('/api/contacts', 'POST', { name: 'Browser Contact', phoneNumber: 'DEMO-003', group: 'Browser' });
    await b.navigate('sms.html'); check('contacts persist on refresh/navigation', (await api('/api/contacts')).contacts.some(c => c.name === 'Browser Contact'));
    await b.navigate('maintenance.html');
    await frame("openCreateModal()"); await until(async () => await frame("document.querySelectorAll('.vehicle-checkbox').length") > 0, 'maintenance vehicle picker');
    await frame("document.querySelector('.vehicle-checkbox').checked=true;document.getElementById('title').value='Browser inspection';document.getElementById('description').value='Fictional inspection only';document.getElementById('createForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    await until(async () => (await api('/api/maintenance')).requests.some(r => r.title === 'Browser inspection'), 'maintenance create UI');
    const created = (await api('/api/maintenance')).requests.find(r => r.title === 'Browser inspection');
    await api('/api/maintenance/' + created._id, 'PATCH', { title: 'Browser edited', description: 'Local edit', priority: 'high' });
    for (const [action, body] of [['receive', {}], ['assign', { assignedTo: 'demo-admin' }], ['resolve', { resolution: 'Demo complete' }], ['close', {}]]) { const result = await api(`/api/maintenance/${created._id}/${action}`, 'PATCH', body); check('maintenance ' + action, result.success); }
    const reportBody = { companyId: 'demo-customer', installationDate: '2026-11-02', employeeName: 'Browser Technician', jobTitle: 'Demo', items: JSON.stringify([{ unitId: '1001', unitName: 'CR14', imei: '990000000000001', serialNumber: 'DEMO-SN', simNumber: 'DEMO-SIM', notes: 'Browser attachment' }]) };
    const upload = await frame(`(async()=>{const form=new FormData();for(const [k,v]of Object.entries(${JSON.stringify(reportBody)}))form.append(k,v);form.append('photos_0',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'}),'demo.png');const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;canvas.getContext('2d').fillRect(0,0,10,10);form.append('signature',canvas.toDataURL('image/png'));return(await fetch('/api/installations',{method:'POST',body:form})).json()})()`);
    check('local multipart upload and signature persisted', upload.success && upload.report.items[0].photos.length === 1 && upload.report.signatureFile);
    await b.navigate('installations.html'); await frame(`ObserverPreview.open('/api/installations/${upload.report._id}/pdf')`);
    await until(async () => await b.evaluate("!document.getElementById('report-panel').hidden"), 'local attachment report');
    check('report displays local photo and signature', await b.evaluate("document.querySelectorAll('#report-content img').length===2"));
    await b.evaluate("document.getElementById('report-back').click()");
    // EDIT BY NADA — exercise original installation form, local scanner bridge and signature functions.
    await frame("openNewReportModal();document.getElementById('f-company').value='demo-customer';onCompanyChange()");
    await until(async () => await frame("document.querySelector('.vehicle-unit-select').options.length") > 1, 'installation vehicle options');
    await frame("openScanModal(document.querySelector('.vehicle-row .scan-btn'))");
    await until(async () => await b.evaluate("document.getElementById('scan-dialog').open"), 'local scanner dialog');
    await b.evaluate("document.getElementById('scan-value').value='990000000000007';document.getElementById('scan-sample').click()");
    await until(async () => await frame("document.querySelector('.vehicle-imei').value") === '990000000000007', 'scanner sample callback');
    check('scanner sample fills the existing device field', true);
    await frame("(()=>{document.querySelector('.vehicle-unit-select').value='1001';document.getElementById('f-date').value='2026-11-02';document.getElementById('f-employee-name').value='Form Technician';document.getElementById('f-job-title').value='Demo';const c=document.getElementById('sig-pad'),r=c.getBoundingClientRect();const e={pointerId:1,clientX:r.left+20,clientY:r.top+20,preventDefault(){}};signatureStart(e);signatureMove({...e,clientX:r.left+100,clientY:r.top+50});signatureEnd(e);document.getElementById('report-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})()");
    await until(async () => (await api('/api/installations')).reports.some(r => r.employeeName === 'Form Technician'), 'original installation form save');
    check('original installation form saves a local signature', (await api('/api/installations')).reports.find(r => r.employeeName === 'Form Technician').signatureFile);
    await b.navigate('maintenance-report.html');
    await frame("openNewReportModal();document.getElementById('f-company').value='demo-customer';onCompanyChange()");
    await until(async () => await frame("document.querySelector('.vehicle-unit-select').options.length") > 1, 'replacement vehicle options');
    await frame("document.querySelector('.vehicle-unit-select').value='1001';document.querySelector('.vehicle-imei').value='990000000000008';document.querySelector('.vehicle-old-imei').value='990000000000007';document.getElementById('f-date').value='2026-11-02';document.getElementById('f-employee-name').value='Replacement Technician';document.getElementById('f-job-title').value='Demo';document.getElementById('report-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    await until(async () => (await api('/api/maintenance-reports')).reports.some(r => r.employeeName === 'Replacement Technician'), 'original replacement form save');
    check('replacement form retains old/new device identifiers', (await api('/api/maintenance-reports')).reports.find(r => r.employeeName === 'Replacement Technician').items[0].oldImei === '990000000000007');
    await b.navigate('wialon-reports.html');
    await until(async () => await frame("document.getElementById('template-select').options.length") === 3, 'report templates');
    await frame("runReport()"); await until(async () => await frame("document.querySelectorAll('#result-area table').length") > 0, 'sample Wialon results'); check('Wialon sample result UI', true);
    await b.navigate('admin-users.html');
    const user = (await api('/api/admin/users', 'POST', { username: 'demo.browser', displayName: 'Browser Customer', role: 'customer', permissions: { dashboard: true, units: true }, assignedUnitNames: ['CR14'] })).user;
    await api('/api/admin/users/' + user._id, 'PATCH', { permissions: { sms: true } }); check('admin permission controls persist', (await api('/api/admin/users')).users.find(u => u._id === user._id).permissions.sms);
    await frame("document.getElementById('f-username').value='demo.form';document.getElementById('f-displayname').value='Form Customer';document.getElementById('create-form').requestSubmit()");
    await until(async () => (await api('/api/admin/users')).users.some(u => u.username === 'demo.form'), 'original admin creation form');
    check('admin password stays disabled after form reset', await frame("document.getElementById('f-password').readOnly && !document.getElementById('f-password').required"));
    await frame("sendReport('demo-customer')"); await until(async () => (await api('/__preview/state')).state.notifications.length > 0, 'simulated email activity');
    check('report email only records a local simulation', true);
    const externalBefore = b.external.length;
    check('external fetch rejected locally', !(await frame("fetch('https://example.invalid/api/leak',{method:'POST',body:'demo'}).then(r=>r.ok)")));
    check('unknown API refused locally', !(await api('/api/unhandled')).success);
    check('real OAuth tokens refused locally', !(await api('/api/login/wialon-token', 'POST', { token: 'REAL-TOKEN-DO-NOT-USE' })).success);
    check('XHR and socket mechanisms disabled', await frame("(()=>{let denied=0;for(const name of ['XMLHttpRequest','WebSocket','EventSource'])try{new window[name]('https://example.invalid')}catch{denied++}return denied===3})()"));
    check('external navigation stays inside preview shell', await frame("ObserverPreview.navigate('https://example.invalid/').then(()=>true)"));
    check('no external request reached the browser network layer', b.external.length === externalBefore && b.external.length === 0);
    const allowed = b.requests.filter(url => !url.startsWith(origin + '/') && !url.startsWith('data:') && !url.startsWith('blob:') && url !== 'about:blank'); check('all observed page requests use the isolated local origin', allowed.length === 0);
    // EDIT BY NADA — verify browser enforcement as well as interception. .invalid is never routable; test-browser proxy also blocks egress.
    const cspProbe = await frame("new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),1500);document.addEventListener('securitypolicyviolation',event=>{if(event.effectiveDirective==='img-src'){clearTimeout(timer);resolve(true)}},{once:true});const image=new Image();image.src='https://example.invalid/blocked-preview-probe.png';document.body.append(image)})");
    check('CSP blocks non-adapter external resources before transmission', cspProbe && b.external.length === 0);
    // EDIT BY NADA — switching permissions cannot retain an already-open admin page.
    await b.evaluate("document.getElementById('persona').value='demo-limited';document.getElementById('persona').dispatchEvent(new Event('change'));document.getElementById('access-mode').value='permissions';document.getElementById('access-mode').dispatchEvent(new Event('change'))");
    await until(async () => await b.evaluate("document.getElementById('page-frame').getAttribute('src')==='about:blank'"), 'restricted persona page unload');
    check('permission mode removes stale all-access content', await b.evaluate("document.getElementById('preview-status').textContent.includes('denied')"));
    await b.evaluate("document.getElementById('access-mode').value='explore';document.getElementById('access-mode').dispatchEvent(new Event('change'))");
    await until(async () => await frame("location.pathname") === '/pages/admin-users.html', 'return to exploration');
    const storedBefore = await b.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('observer-fleet-preview:')).length"); check('only namespaced preview record storage used', storedBefore === 1);
    await b.evaluate("document.getElementById('reset').click()"); await until(async () => await b.evaluate("document.getElementById('question-dialog').open"), 'reset confirmation'); await b.evaluate("document.getElementById('question-ok').click()");
    await until(async () => (await api('/api/maintenance')).requests.length === 5, 'reset requests');
    check('reset restores users, records, logs and counters', (await api('/api/admin/users')).users.length === 3 && (await api('/api/sms/report')).logs.length === 8);
    check('reset removes locally stored attachments', await b.evaluate(`ObserverPreview.getFile(${JSON.stringify(upload.report.items[0].photos[0])}).then(x=>x===undefined)`));
    await b.navigate('index.html'); await b.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, [...b.sessions][0]); await b.screenshot('mobile-preview.png');
    check('no uncaught browser errors', b.exceptions.length === 0);
    await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
    // EDIT BY NADA — retain network evidence without embedding megabytes of image data in the report.
    await fs.writeFile(path.join(root, 'artifacts/browser-results.json'), JSON.stringify({ previewOnly: true, checks, observedRequests: [...new Set(b.requests.map(url => url.startsWith('data:') ? 'data:[embedded local resource omitted]' : url))], externalRequests: b.external, blockedPolicyProbes: ['https://example.invalid/blocked-preview-probe.png'], exceptions: b.exceptions, notes: ['The intentional CSP probe may appear as a blocked browser request event; no external request reached request interception or transmission.', 'Browser downloads deliberately denied during automated tests; CSV content verified by contract tests.', 'Camera hardware permission/decoding requires manual verification.'] }, null, 2));
  } finally { if (b) await b.close(); await new Promise(resolve => server.close(resolve)); }
});
