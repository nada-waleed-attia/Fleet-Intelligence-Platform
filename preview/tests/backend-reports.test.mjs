// Isolated backend route tests: Wialon, email and database modules are replaced before loading.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import http from 'node:http';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
const require = createRequire(import.meta.url);
const { matchesBattery, BATTERY_DOWN_VOLTS } = require('../../lib/batteryFilter');
const { requireLocalAccount } = require('../../middleware/auth');

test('backend Battery Down handles 8000 V boundaries without treating missing values as zero', () => {
  assert.equal(BATTERY_DOWN_VOLTS, 8000);
  for (const value of [0, '0', 7.5, 12.2, 7999.999]) assert.equal(matchesBattery({ batteryVolts: value }, 'down'), true);
  for (const value of [8000, 8000.01, null, undefined, '', ' ', 'bad', -1, Infinity]) assert.equal(matchesBattery({ batteryVolts: value }, 'down'), false);
  assert.equal(matchesBattery({ batteryVolts: 0, batteryStatus: 'no_data' }, 'down'), false);
  assert.equal(matchesBattery({ batteryVolts: 0 }, 'low'), false); assert.equal(matchesBattery({ batteryVolts: 7.5 }, 'low'), true);
  assert.equal(matchesBattery({ batteryVolts: 0 }, 'zero'), true); assert.equal(matchesBattery({ batteryVolts: 7.5 }, 'zero'), false);
});

test('local-account middleware denies Wialon sessions even for admins and preserves anonymous handling', () => {
  const invoke = (user, originalUrl) => { const state = {}; const res = { status(code) { state.status = code; return this; }, json(body) { state.body = body; return this; }, redirect(path) { state.redirect = path; return this; } }; requireLocalAccount({ session: user ? { user } : {}, originalUrl }, res, () => { state.next = true; }); return state; };
  assert.equal(invoke({ role: 'customer', authMode: 'local' }, '/api/wialon-reports/units').next, true);
  assert.equal(invoke({ role: 'admin', authMode: 'wialon' }, '/api/wialon-reports/units').status, 403);
  assert.equal(invoke({ role: 'admin', authMode: 'wialon' }, '/wialon-reports.html').redirect, '/index.html');
  assert.equal(invoke(null, '/api/wialon-reports/units').status, 401);
});

test('real backend fleet routes export the revised workbook, filtered battery sets and a white PDF page', async () => {
  const express = require('express'), ExcelJS = require('exceljs');
  const units = [0, 7.5, 7999.9, 8000, null, '', 12.2].map((voltage, index) => ({ id: 1001 + index, name: 'Unit ' + index, accountGroup: 'Test account', serialNumber: 'IMEI-' + index, mobileNumber: '20101234567' + index, batteryVolts: voltage, batteryStatus: voltage === null ? 'no_data' : voltage === 0 ? 'zero' : 'ok', deviceBatteryVolts: 3.7, status: 'Online', isOffline: false, lastMessageTime: '2026-11-04', location: 'Test location', offlineDays: 0 }));
  const overrides = {
    '../lib/wialon': { getUnitsForUser: async () => units, getStcanUnitsForUser: async () => units },
    '../lib/batteryFilter': require('../../lib/batteryFilter'),
    '../middleware/auth': { requireAuth: (req, res, next) => next(), requireAdmin: (req, res, next) => next(), requirePermission: () => (req, res, next) => next() },
    '../lib/mailer': { isConfigured: () => false, sendReportEmail: () => { throw new Error('Email must not be called by these tests.'); } },
    '../models/User': {}, '../models/InstallationReport': {}
  };
  const module = { exports: {} }, source = await fs.readFile(new URL('../../routes/reports.js', import.meta.url), 'utf8');
  const isolatedRequire = name => { if (Object.hasOwn(overrides, name)) return overrides[name]; if (['express', 'exceljs', 'pdfkit'].includes(name)) return require(name); throw new Error('Unexpected backend dependency: ' + name); };
  // Keep ExcelJS arrays in the same JS realm while replacing all integration dependencies.
  const load = new vm.Script('(function(require,module,exports,console){\n' + source + '\n})', { filename: 'routes/reports.js' }).runInThisContext();
  load(isolatedRequire, module, module.exports, { log() {}, error() {} });
  const app = express(); app.use((req, res, next) => { req.session = { user: { username: 'isolated-test', role: 'admin', authMode: 'local' } }; next(); }); app.use('/api/reports', module.exports);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const get = path => new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port: server.address().port, path }, response => { const data = []; response.on('data', chunk => data.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data: Buffer.concat(data) })); }).on('error', reject); });
  const workbook = async path => { const response = await get(path); assert.equal(response.status, 200, response.data.toString().slice(0, 150)); const book = new ExcelJS.Workbook(); await book.xlsx.load(response.data); return book.worksheets[0]; };
  try {
    const sheet = await workbook('/api/reports/export?filter=battery0&format=xlsx');
    // EDIT BY NADA — Fleet exports identify the telephone field as Mobile Number.
    assert.deepEqual(sheet.getRow(5).values.slice(1, 6), ['ID', 'Unit Name', 'IMEI', 'Mobile Number', 'Account']);
    assert.ok(!sheet.getRow(5).values.includes('Battery Status')); assert.equal(sheet.rowCount - 5, 4);
    assert.equal(sheet.getCell('C6').value, 'IMEI-0'); assert.equal(sheet.getCell('D6').value, '201012345670');
    assert.equal((await workbook('/api/reports/export?filter=battery&battery=zero&format=xlsx')).rowCount - 5, 1);
    assert.equal((await workbook('/api/reports/export?filter=battery-low&format=xlsx')).rowCount - 5, 3);
    assert.equal((await workbook('/api/reports/export?filter=all&battery=down&format=xlsx')).rowCount - 5, 4);
    const pdf = await get('/api/reports/export?format=pdf'); assert.equal(pdf.status, 200); assert.ok(pdf.data.subarray(0, 8).toString().startsWith('%PDF-'));
    const streams = [...pdf.data.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap(match => { try { return [inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1')]; } catch { return []; } }).join('\n');
    assert.match(streams, /1 1 1 (?:scn|rg)/, 'PDF explicitly paints a white surface'); assert.match(streams, /0 0 841\.89 595\.28 re/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
