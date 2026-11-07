// EDIT BY NADA — substantive local contracts, preservation and isolation tests; no dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { transform, pages } from '../transform.mjs';
import { createPreviewServer, hostname } from '../serve.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
async function environment() {
  const memory = new Map(), attachments = new Map();
  const context = vm.createContext({ console, Blob, crypto: crypto.webcrypto, URL, setTimeout, localStorage: { getItem: k => memory.get(k) || null, setItem: (k, v) => memory.set(k, v) } });
  for (const file of ['fixtures.js', 'storage.js', 'handlers.js', 'report-language.js', 'sensor-report.js', 'battery-filter.js', 'exports.js']) vm.runInContext(await fs.readFile(path.join(root, 'preview', file), 'utf8'), context, { filename: file });
  const P = context.ObserverPreview; P.putFile = async (id, file) => attachments.set(id, file); P.getFile = async id => attachments.get(id); P.deleteFile = async id => attachments.delete(id);
  return { P, memory, attachments };
}
test('production files outside the explicitly approved backend changes retain their recorded hashes', async () => {
  // The user explicitly authorized backend battery/report updates and local-account access controls.
  const approved = new Set(['FMS.js', 'middleware/auth.js', 'routes/reports.js', 'routes/wialonReports.js']);
  const baseline = JSON.parse(await fs.readFile(path.join(root, 'preview/production-baseline.json')));
  for (const [file, hash] of Object.entries(baseline)) if (!approved.has(file)) assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex'), hash, file);
});
// EDIT BY NADA — callback intentionally omits the original token-reading script.
test('every transformed page parses, loads bootstrap first and has no remote scripts/styles', async () => { for (const page of pages) { const html = transform(await fs.readFile(path.join(root, 'public', page), 'utf8'), page); assert.ok(html.includes('/preview/bootstrap.js')); if (page !== 'wialon-callback.html') assert.ok(html.indexOf('/preview/bootstrap.js') < html.indexOf('// EDIT BY NADA — navigation')); assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=["']https?:/i); for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (m[1].trim()) new vm.Script(m[1], { filename: page }); } });
test('preview script syntax is valid', async () => { for (const file of (await fs.readdir(path.join(root, 'preview'))).filter(f => f.endsWith('.js'))) new vm.Script(await fs.readFile(path.join(root, 'preview', file), 'utf8'), { filename: file }); });
test('dashboard totals and battery categories match the unit data', async () => { const { P } = await environment(), data = await P.handle('/api/dashboard'); assert.equal(data.units.length, 24); assert.equal(data.counters.totalUnits, data.counters.onlineUnits + data.counters.offlineUnits); assert.equal(data.counters.batteryZeroUnits, data.units.filter(u => u.batteryStatus === 'zero').length); for (const unit of data.units) assert.equal(typeof unit.id, 'number'); });
test('customer scoping applies independently of all-page exploration', async () => { const { P } = await environment(); P.mutate(s => { s.mode = 'permissions'; s.activeUser = 'demo-customer'; }); assert.equal((await P.handle('/api/dashboard')).units.length, 8); await assert.rejects(P.handle('/api/units/1010'), /not found/); P.mutate(s => { s.activeUser = 'demo-limited'; }); await assert.rejects(P.handle('/api/sms/send', 'POST', { numbers: 'DEMO-001', text: 'Demo' }), /permission denied/); await assert.rejects(P.report('/api/installations/demo-installation-1/pdf'), /permission denied/); });
test('unknown API methods/paths and external URLs never fall through', async () => { const { P } = await environment(); for (const [url, method] of [['https://example.invalid/api/me', 'GET'], ['/api/not-real', 'POST'], ['/api/units/1001', 'DELETE'], ['/api/dashboard', 'POST'], ['//example.invalid/api/me', 'GET']]) await assert.rejects(P.handle(url, method), /blocked|Blocked|External/); });
test('maintenance creation, local edit, messages and legal status transitions persist', async () => { const { P } = await environment(); const { request } = await P.handle('/api/maintenance', 'POST', { title: 'Demo inspection', description: 'A fictional issue', priority: 'high', vehicleIds: ['1001'] }); await P.handle(`/api/maintenance/${request._id}`, 'PATCH', { title: 'Updated', description: 'Edited locally', priority: 'low' }); await assert.rejects(P.handle(`/api/maintenance/${request._id}/close`, 'PATCH'), /requires status/); await P.handle(`/api/maintenance/${request._id}/reply`, 'POST', { message: 'Local reply' }); for (const [action, body] of [['receive', {}], ['assign', { assignedTo: 'demo-admin' }], ['resolve', { resolution: 'Demo completion' }], ['close', {}]]) await P.handle(`/api/maintenance/${request._id}/${action}`, 'PATCH', body); const saved = (await P.handle(`/api/maintenance/${request._id}`)).request; assert.equal(saved.status, 'closed'); assert.equal(saved.title, 'Updated'); assert.equal(saved.messages.length, 1); assert.equal(saved.history.length, 7); });
test('invalid maintenance submissions do not create records', async () => { const { P } = await environment(); const count = P.read().requests.length; await assert.rejects(P.handle('/api/maintenance', 'POST', { title: 'x', description: 'y', vehicleIds: ['99999'] })); assert.equal(P.read().requests.length, count); });
test('SMS and WhatsApp simulations persist logs, filters and quota changes', async () => { const { P } = await environment(); const before = (await P.handle('/api/sms/status')).usedThisCycle; const submitted = await P.handle('/api/sms/send', 'POST', { numbers: 'DEMO-001,invalid', text: 'Local test', channel: 'sms' }); assert.equal(submitted.sent, 1); assert.equal(submitted.failed, 1); assert.equal((await P.handle('/api/sms/status')).usedThisCycle, before + 1); await P.handle('/api/sms/send', 'POST', { numbers: 'DEMO-002', text: 'WhatsApp demo', channel: 'whatsapp' }); const filtered = await P.handle('/api/sms/report?channel=whatsapp&source=manual'); assert.ok(filtered.logs.every(l => l.channel === 'whatsapp' && l.source === 'manual')); });
test('contacts CRUD and admin permissions survive store round trips without passwords', async () => { const { P } = await environment(); const { contact } = await P.handle('/api/contacts', 'POST', { name: 'Local contact', phoneNumber: 'DEMO-003', group: 'Demo' }); assert.ok((await P.handle('/api/contacts/groups')).groups.includes('Demo')); await P.handle('/api/contacts/' + contact._id, 'DELETE'); const { user } = await P.handle('/api/admin/users', 'POST', { username: 'demo.new', password: 'NOT_STORED', permissions: { units: true } }); await P.handle('/api/admin/users/' + user._id, 'PATCH', { permissions: { sms: true } }); assert.equal(P.read().users.find(u => u._id === user._id).permissions.sms, true); assert.ok(!JSON.stringify(P.read()).includes('NOT_STORED')); await assert.rejects(P.handle('/api/admin/users/demo-admin/import-wialon-units', 'POST', { wialonToken: 'REAL_TOKEN' }), /PREVIEW_ONLY/); });
test('local uploads validate files, store attachments and produce sample reports', async () => { const { P, attachments } = await environment(); const { report } = await P.handle('/api/installations', 'POST', { companyId: 'demo-customer', employeeName: 'Demo', jobTitle: 'Technician', installationDate: '2026-11-02', items: JSON.stringify([{ unitId: '1001', unitName: 'CR14', imei: '990000000000001', notes: 'Demo' }]), photos_0: [new Blob(['test'], { type: 'image/png' })] }); assert.equal(attachments.size, 1); assert.equal(report.items[0].photos.length, 1); await P.handle('/api/installations/' + report._id, 'DELETE'); assert.equal(attachments.size, 0); });
test('report interval and selected-unit contracts are preserved', async () => { const { P } = await environment(); const query = { templateId: 1, resourceId: 9001, unitIds: ['1001'], dateFrom: '2026-10-01', dateTo: '2026-11-02' }; const { results } = await P.handle('/api/wialon-reports/run', 'POST', query); assert.equal(results.length, 1); assert.equal(results[0].unitName, 'CR14'); assert.equal(results[0].tables[0].rows[0][1], query.dateFrom); await assert.rejects(P.handle('/api/wialon-reports/run', 'POST', { ...query, dateTo: '2025-01-01' }), /date range/); });
test('sensor reports have their own schema, dynamic multi-filters and account ordering across exports', async () => {
  const { P } = await environment();
  P.mutate(state => { state.units = state.units.slice(0, 3).map((unit, index) => ({ ...unit, name: ['Unit Z', 'Unit B', 'Unit A'][index], accountGroup: ['Zulu', 'Alpha', 'Alpha'][index], deviceType: ['Type B', 'Type A', 'Type B'][index], serialNumber: 'IMEI-' + unit.id, mobileNumber: 'SIM-' + unit.id, batteryVolts: index === 2 ? 0 : 12, fuelPercentage: 0 })); });
  const report = await P.report('/api/reports/view-sensors');
  assert.equal(report.title, 'Sensor Report'); assert.equal(report.subtitle, 'Show all sensor values across all units');
  // EDIT BY NADA — Sensor Report labels the stored unit phone field as Mobile Number.
  assert.deepEqual(Array.from(report.rows[0].slice(0, 6)), ['ID', 'Account', 'Unit Name', 'Device IMEI', 'Mobile Number', 'Device Type']);
  for (const column of ['Wialon ID', 'Battery data', 'Fuel Detection']) assert.ok(!report.rows[0].includes(column));
  assert.deepEqual(Array.from(report.rows.slice(1), row => row[2]), ['Unit A', 'Unit B', 'Unit Z']);
  assert.equal(report.rows[1][3], 'IMEI-1003'); assert.equal(report.rows[1][4], 'SIM-1003'); assert.equal(report.rows[1][7], 0); assert.equal(report.rows[1][11], '0%');
  assert.deepEqual(Array.from(report.sensor.options.deviceTypes, option => option.value), ['Type A', 'Type B']);
  const filter = '?deviceTypes=Type%20B&accounts=Alpha';
  const view = await P.report('/api/reports/view-sensors' + filter), exported = await P.report('/api/reports/export-sensors' + filter + '&format=xlsx');
  assert.equal(view.rows.length, 2); assert.equal(view.rows[1][2], 'Unit A'); assert.equal(JSON.stringify(view.rows), JSON.stringify(exported.rows));
  const multi = await P.report('/api/reports/view-sensors?deviceTypes=Type%20A&deviceTypes=Type%20B&accounts=Alpha'); assert.equal(multi.rows.length, 3);
  const arabic = await P.report('/api/reports/view-sensors' + filter + '&lang=ar'); assert.equal(arabic.title, 'تقرير الحساسات'); assert.equal(arabic.rows[0][5], 'نوع الجهاز'); assert.equal(arabic.rows[1][2], 'Unit A');
  const fleet = await P.report('/api/reports/view'); assert.ok(fleet.rows[0].includes('IMEI')); assert.ok(!fleet.rows[0].includes('Device Type'));
});
test('fleet reports consistently export the revised identity columns and active directory filters', async () => {
  const { P } = await environment();
  P.mutate(state => { state.units[0].serialNumber = 'TRACKER-IMEI'; state.units[0].mobileNumber = '201012345678'; });
  const view = await P.report('/api/reports/view'), exported = await P.report('/api/reports/export?format=xlsx');
  // EDIT BY NADA — the Fleet report's mobile field has the requested label.
  assert.deepEqual(Array.from(view.rows[0].slice(0, 5)), ['ID', 'Unit Name', 'IMEI', 'Mobile Number', 'Account']);
  assert.equal(view.rows[1][2], 'TRACKER-IMEI'); assert.equal(view.rows[1][3], '201012345678'); assert.equal(view.fleet, true);
  for (const removed of ['Wialon ID', 'Battery data', 'Serial Number', 'Unit number']) assert.ok(!view.rows[0].includes(removed));
  assert.equal(JSON.stringify(view.rows), JSON.stringify(exported.rows));
  const filtered = await P.report('/api/reports/export?format=pdf&connection=online&search=Nile&sort=name-desc');
  assert.ok(filtered.rows.length > 1); assert.ok(filtered.rows.slice(1).every(row => row[4] === 'Nile Logistics' && row[5] === 'Online'));
  const names = Array.from(filtered.rows.slice(1), row => row[1]); assert.deepEqual(names, [...names].sort().reverse());
});
test('Wialon reports are available only to local authentication accounts', async () => {
  const { P } = await environment(); assert.ok((await P.handle('/api/wialon-reports/templates')).templates.length);
  P.mutate(state => { state.users[0].authMode = 'wialon'; });
  await assert.rejects(P.handle('/api/wialon-reports/templates'), /local accounts only/);
  await assert.rejects(P.handle('/api/wialon-reports/units'), /local accounts only/);
  await assert.rejects(P.report('/api/wialon-reports/export'), /local accounts only/);
  P.mutate(state => { state.users[0].authMode = 'local'; }); assert.ok((await P.handle('/api/wialon-reports/units')).units.length);
});
test('Battery Down uses literal 8000 V, excludes missing readings and supports zero/low separation', async () => {
  const { P } = await environment();
  P.mutate(state => { state.units = [0, 7.5, 7999.99, 8000, 8000.01, null, '', 12.2].map((value, index) => ({ ...state.units[index], batteryVolts: value, batteryStatus: value === null ? 'no_data' : value === 0 ? 'zero' : 'ok' })); });
  const down = await P.report('/api/reports/view?filter=battery0'); assert.equal(down.rows.length, 5); assert.equal(down.title, 'Battery Report');
  const zero = await P.report('/api/reports/view?filter=battery&battery=zero'); assert.equal(zero.rows.length, 2); assert.equal(zero.rows[1][7], 0);
  const low = await P.report('/api/reports/view?filter=battery-low'); assert.equal(low.rows.length, 4); assert.ok(low.rows.slice(1).every(row => row[7] > 0 && row[7] < 8000));
  const exported = await P.report('/api/reports/export?filter=all&battery=down&format=pdf'); assert.equal(exported.rows.length, down.rows.length);
});
test('sensor filters respect account access, missing integration fields and zero matching results', async () => {
  const { P } = await environment(); const original = await P.report('/api/reports/view-sensors'); assert.equal(original.rows[1][3], '—'); assert.equal(original.rows[1][5], '—');
  P.mutate(state => { state.units[0].deviceType = 'Visible type'; state.units[8].deviceType = 'Other account type'; state.mode = 'permissions'; state.activeUser = 'demo-customer'; });
  const report = await P.report('/api/reports/view-sensors'); assert.equal(report.sensor.available, 8); assert.ok(!report.sensor.options.deviceTypes.some(option => option.value === 'Other account type'));
  const empty = await P.report('/api/reports/view-sensors?deviceTypes=Other%20account%20type'); assert.equal(empty.rows.length, 1); assert.ok(P.reportHtml(empty).includes('No units match'));
  P.mutate(state => { state.scenario = 'empty'; }); const noUnits = await P.report('/api/reports/view-sensors'); assert.equal(noUnits.rows.length, 1); assert.equal(noUnits.sensor.options.accounts.length, 0);
});
test('CSV uses real CSV syntax, neutralizes formulas; report HTML escapes user text', async () => { const { P } = await environment(); const csv = P.csv([['name', 'value'], ['a,"b', '=1+2']]); assert.ok(csv.includes('"a,""b"')); assert.ok(csv.includes('"\'=1+2"')); const html = P.reportHtml({ title: '<img src=x>', rows: [['<script>'], ['<svg onload=alert(1)>']], images: [], lang: 'en' }); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<svg')); });
test('scenarios produce empty/error/failed delivery results without changing production', async () => { const { P } = await environment(); P.mutate(s => { s.scenario = 'empty'; }); assert.equal((await P.handle('/api/dashboard')).units.length, 0); P.mutate(s => { s.scenario = 'error'; }); await assert.rejects(P.handle('/api/dashboard'), /Simulated/); assert.ok((await P.handle('/api/me')).success); P.mutate(s => { s.scenario = 'send-failure'; }); assert.equal((await P.handle('/api/sms/send', 'POST', { numbers: 'DEMO-001', text: 'Demo', channel: 'sms' })).failed, 1); });
test('static tool exposes only allowlisted frontend resources and refuses API requests', async () => { const port = 4177, server = createPreviewServer(port); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); const get = (url, method = 'GET', host = `${hostname}:${port}`) => new Promise((resolve, reject) => { const request = http.request({ host: '127.0.0.1', port, path: url, method, headers: { Host: host } }, response => { let data = ''; response.on('data', chunk => data += chunk); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data })); }); request.on('error', reject); request.end(); }); try { const page = await get('/pages/index.html'); assert.equal(page.status, 200); assert.ok(page.headers['content-security-policy'].includes("connect-src 'none'")); for (const url of ['/api/me', '/FMS.js', '/.env', '/preview/production-baseline.json', '/assets/../FMS.js', '/preview/../../package.json']) assert.equal((await get(url)).status, 404, url); assert.equal((await get('/api/sms/send', 'POST')).status, 405); assert.equal((await get('/', 'GET', 'evil.invalid')).status, 403); } finally { await new Promise(resolve => server.close(resolve)); } });
