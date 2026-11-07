// EDIT BY NADA — exercise the actual SMS router and frontend with isolated Wialon/provider substitutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import http from 'node:http';
import { createRequire } from 'node:module';
// EDIT BY NADA — supply the router's CommonJS directory without running the production app.
import { fileURLToPath } from 'node:url';
import { browser, until } from './browser.mjs';
import { createPreviewServer } from '../serve.mjs';
const require = createRequire(import.meta.url);
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const stop = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const read = file => fs.readFile(new URL('../../' + file, import.meta.url), 'utf8');

// EDIT BY NADA — no real sessions, Wialon, database or messaging providers are used by this test server.
async function application() {
    const express = require('express');
    const auth = require('../../middleware/auth');
    const state = {
        user: { id: 'test-customer', username: 'test', role: 'customer', authMode: 'local', permissions: { sms: true }, assignedUnitNames: ['Test A', 'Test B', 'Test C'] },
        units: [
            // EDIT BY NADA — explicit test statuses exercise bulk offline selection without real Wialon calls.
            { id: 71, name: 'Test A', deviceType: 'Captured Type A', mobileNumber: '01012345678', serialNumber: 'test-imei-a', accountGroup: 'Test account', status: 'Offline', secretInternalField: 'not-for-the-picker' },
            { id: 72, name: 'Test B', deviceType: 'Captured Type B', mobileNumber: '+201112345678', accountGroup: 'Test account', status: 'Online' },
            { id: 73, name: 'Test C', deviceType: 'Unknown HW (999)', mobileNumber: null, accountGroup: 'Test account' }
        ], calls: [], sent: [], error: null
    };
    const overrides = {
        '../lib/wialon': { getUnitsForUser: async user => { state.calls.push(user); if (state.error) throw state.error; return state.units; } },
        '../lib/vodafoneSms': { normalizeMsisdn: value => value, sendSmsBatch: async () => { throw new Error('Tests must not send messages.'); } },
        '../lib/whatsapp': { isWhatsAppConfigured: () => false, sendWhatsAppMessage: async () => { throw new Error('Tests must not send messages.'); } },
        '../middleware/auth': auth,
        '../models/SmsLog': {}, '../models/SmsQuotaSettings': {}, '../models/User': {}, '../lib/reportPdf': {}
    };
    const module = { exports: {} };
    const load = new vm.Script('(function(require,module,exports,console,__dirname){\n' + await read('routes/sms.js') + '\n})').runInThisContext();
    load(name => Object.hasOwn(overrides, name) ? overrides[name] : require(name), module, module.exports, { error() {}, log() {} }, fileURLToPath(new URL('../../routes/', import.meta.url)));
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { req.session = state.user ? { user: state.user } : {}; next(); });
    app.get('/api/me', (req, res) => res.json({ success: true, user: { ...state.user, role: 'admin', displayName: 'Isolated test' } }));
    app.get('/api/contacts/groups', (req, res) => res.json({ success: true, groups: [] }));
    // EDIT BY NADA — capture the frontend's payload instead of invoking the real send route.
    app.post('/api/sms/send', (req, res) => { state.sent.push(req.body); res.json({ success: true, sent: 0, failed: 0, results: [] }); });
    app.use('/api/sms', module.exports);
    app.get('/', (req, res) => res.type('html').send('<!doctype html><html><body><iframe src="/pages/sms.html" style="width:100%;height:90vh;border:0"></iframe></body></html>'));
    app.get('/pages/sms.html', async (req, res) => res.type('html').send(await read('public/sms.html')));
    app.get('/assets/sms-unit-picker.js', async (req, res) => res.type('js').send(await read('public/assets/sms-unit-picker.js')));
    // EDIT BY NADA — serve the same shared control that the real frontend and Preview load.
    app.get('/assets/sms-unit-transfer.js', async (req, res) => res.type('js').send(await read('public/assets/sms-unit-transfer.js')));
    app.get('/assets/sms-unit-transfer.css', async (req, res) => res.type('css').send(await read('public/assets/sms-unit-transfer.css')));
    app.get('/assets/observe-logo.png', async (req, res) => res.type('png').send(await fs.readFile(new URL('../../public/assets/observe-logo.png', import.meta.url))));
    const server = http.createServer(app), port = await listen(server);
    return { server, port, state };
}

test('SMS unit endpoint uses the existing session scope, real mapped fields and authenticated SMS access', async () => {
    const { server, port, state } = await application();
    const get = () => fetch(`http://127.0.0.1:${port}/api/sms/units`);
    try {
        let response = await get(), body = await response.json();
        assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(body.source, 'wialon'); assert.equal(body.integrationAvailable, true);
        assert.equal(state.calls[0], state.user);
        assert.equal(body.units[0].deviceType, 'Captured Type A'); assert.equal(body.units[0].mobileNumber, '01012345678');
        assert.ok(!Object.hasOwn(body.units[0], 'secretInternalField'));
        assert.equal(body.units[2].deviceType, ''); assert.equal(body.units[2].mobileNumber, '');
        state.user.permissions.sms = false; response = await get(); assert.equal(response.status, 403); assert.equal(state.calls.length, 1);
        state.user = null; response = await get(); assert.equal(response.status, 401); assert.equal(state.calls.length, 1);
        state.user = { id: 'test-wialon', role: 'admin', authMode: 'wialon' };
        state.error = Object.assign(new Error('private session details'), { code: 'WIALON_SESSION_EXPIRED' });
        response = await get(); body = await response.json(); assert.equal(response.status, 401); assert.equal(body.sessionExpired, true); assert.deepEqual(body.units, []); assert.ok(!body.error.includes('private'));
        state.error = new Error('private token details'); response = await get(); body = await response.json(); assert.equal(response.status, 502); assert.deepEqual(body.units, []); assert.ok(!body.error.includes('private'));
        state.error = null; state.units = []; response = await get(); assert.deepEqual((await response.json()).units, []);
    } finally { await stop(server); }
});

// EDIT BY NADA — actual production frontend: staging, explicit Move and right-box-only unit recipients.
test('production SMS transfer picker preserves search staging and submits only moved unit SIMs', async () => {
    const { server, port, state } = await application();
    const b = await browser('http://observer-preview.localhost:' + port);
    const run = expression => b.evaluate(expression, true);
    const rows = pane => run('document.querySelectorAll("[data-list=' + pane + '] .sms-transfer-row").length');
    const search = value => run('document.querySelector("[data-search=available]").value=' + JSON.stringify(value) + ';document.querySelector("[data-search=available]").dispatchEvent(new Event("input"))');
    const mark = (pane, id) => run('document.querySelector(' + JSON.stringify('[data-pane="' + pane + '"][data-transfer-id="' + id + '"]') + ').click()');
    try {
        await b.navigate('sms.html');
        await until(async () => await rows('available') === 3, 'backend units in Available units');
        assert.ok(await run('document.querySelector("[data-list=available]").textContent.includes("Captured Type A")'));
        assert.ok(await run('document.querySelector("[data-list=available]").textContent.includes("— · Test account")'));
        await search('Captured Type A'); await mark('available', 71);
        await search('Captured Type B'); await mark('available', 72);
        assert.equal(await rows('selected'), 0);
        assert.equal(await run('ObserverSmsUnits.prepare().numbers'), '');
        assert.ok(await run('document.querySelector("[data-move]").textContent.includes("(2)")'));
        await run('document.querySelector("[data-move]").click()');
        assert.equal(await rows('selected'), 2);
        await search('');
        assert.equal(await rows('available'), 1);
        await run('document.getElementById("send-numbers").value="+201012345678";document.getElementById("send-text").value="test-only";sendSms()');
        assert.equal(state.sent.length, 1);
        assert.equal(state.sent[0].numbers, '201012345678,201112345678');
        assert.equal(state.sent[0].unitId, '');
        await mark('available', 73);
        assert.equal(await run('ObserverSmsUnits.prepare().valid'), true, 'unmoved missing SIM does not enter recipients');
        await run('document.querySelector("[data-move]").click();sendSms()');
        assert.equal(state.sent.length, 1);
        assert.ok(await run('document.getElementById("send-result").textContent.includes("no valid SIM")'));
        await mark('selected', 73); await run('document.querySelector("[data-remove]").click()');
        await mark('selected', 72); await run('document.querySelector("[data-remove]").click()');
        assert.equal(await rows('selected'), 1);
        assert.equal(await rows('available'), 2);
        state.units = [{ ...state.units[0], deviceType: 'Updated captured model', mobileNumber: '01098765432' }];
        await run('loadSendHelpers()');
        assert.equal(await rows('selected'), 1);
        assert.ok(await run('document.querySelector("[data-list=selected]").textContent.includes("Updated captured model")'));
        state.error = new Error('test-only failure'); await run('loadSendHelpers()');
        assert.equal(await rows('available'), 0); assert.equal(await rows('selected'), 0);
        assert.ok(await run('document.querySelector("[data-list=available]").textContent.includes("Unable to load units")'));
        await run('window.dispatchEvent(new CustomEvent("observer:sms-units",{detail:{success:true,integrationAvailable:false,units:[]}}))');
        assert.equal(await run('document.querySelector(".sms-transfer").dataset.state'), 'pending');
        assert.equal(await run('document.querySelector("[data-search=available]").disabled'), true);
        state.error = null; await run('loadSendHelpers()');
        assert.equal(await run('document.querySelector(".sms-transfer").dataset.state'), 'connected');
        assert.equal(await run('document.querySelector("[data-search=available]").disabled'), false);
        assert.deepEqual(b.exceptions, []); assert.deepEqual(b.external, []);
    } finally { await b.close(); await stop(server); }
});

test('isolated Preview shows no seeded units as Wialon recipients and keeps saved contacts independent', async () => {
    const port = 4188, server = createPreviewServer(port); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    const b = await browser(`http://observer-preview.localhost:${port}`);
    try {
        await b.navigate('sms.html');
        // EDIT BY NADA — wait on the integration state rather than duplicating presentation copy.
        await until(async () => await b.evaluate('document.getElementById("sm-wialon-connection").dataset.state === "pending"', true), 'honest disconnected picker state');
        assert.equal(await b.evaluate('document.querySelectorAll("#sm-recipient-list input").length', true), 0);
        // EDIT BY NADA — verify the pending place for future real unit data, with no credential input.
        assert.equal(await b.evaluate('document.getElementById("sm-wialon-connection").dataset.state', true), 'pending');
        // EDIT BY NADA — compact waiting row and optional disclosures preserve the prepared composer behavior.
        // EDIT BY NADA — both prepared transfer boxes remain visible without inventing backend records.
        assert.ok(await b.evaluate('document.querySelector("[data-list=available]").textContent.includes("device types and SIMs")', true));
        assert.equal(await b.evaluate('document.querySelector(".sms-transfer").dataset.state', true), 'pending');
        assert.equal(await b.evaluate('document.querySelector(".sm-message-preview").open', true), false);
        await b.evaluate('document.getElementById("send-text").value="Preview only";document.getElementById("send-text").dispatchEvent(new Event("input"));document.querySelector(".sm-message-preview summary").click()', true);
        assert.equal(await b.evaluate('document.querySelector(".sm-message-preview").open', true), true);
        assert.equal(await b.evaluate('document.getElementById("sm-preview-text").textContent', true), 'Preview only');
        await b.evaluate('document.querySelector(".sm-message-preview summary").click();document.querySelector(".sm-manual-numbers summary").click()', true);
        assert.ok(await b.evaluate('document.getElementById("send-numbers").getBoundingClientRect().height>0', true));
        assert.equal(await b.evaluate('document.getElementById("sm-recipient-search").disabled', true), true);
        assert.equal(await b.evaluate('document.querySelectorAll(".sm-recipient-picker input[type=password]").length', true), 0);
        await b.evaluate('document.querySelector("[data-recipient-source=contact]").click()', true);
        assert.equal(await b.evaluate('document.getElementById("sm-unit-transfer").hidden', true), true);
        assert.equal(await b.evaluate('document.getElementById("sm-recipient-search").disabled', true), false);
        assert.equal(await b.evaluate('document.getElementById("sm-wialon-connection").hidden', true), true);
        assert.deepEqual(b.exceptions, []); assert.deepEqual(b.external, []);
    } finally { await b.close(); await stop(server); }
});

// EDIT BY NADA — twenty offline units are test-only browser data, never shipped as Wialon records.
test('Preview moves twenty offline units in bulk, preserves contacts and sends only committed units', async () => {
    const port = 4188, server = createPreviewServer(port); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    const b = await browser(`http://observer-preview.localhost:${port}`);
    const run = expression => b.evaluate(expression, true);
    const rows = pane => run('document.querySelectorAll("[data-list=' + pane + '] .sms-transfer-row").length');
    const search = value => run('document.querySelector("[data-search=available]").value=' + JSON.stringify(value) + ';document.querySelector("[data-search=available]").dispatchEvent(new Event("input"))');
    const mark = (pane, id) => run('document.querySelector(' + JSON.stringify('[data-pane="' + pane + '"][data-transfer-id="' + id + '"]') + ').click()');
    try {
        await b.navigate('sms.html');
        await until(async () => await run('document.querySelector(".sms-transfer").dataset.state') === 'pending', 'disconnected initial state');
        await b.evaluate(`(() => {
            const P=ObserverPreview;
            globalThis.transferTestUnits=Array.from({length:25},(_,index)=>({id:9001+index,name:'Test Unit '+String(index+1).padStart(2,'0'),deviceType:'Test model',mobileNumber:String(201000000000+index),accountGroup:'Test account',status:index<20?'Offline':'Online',isOffline:index<20}));
            P.mutate(state=>{state.units=transferTestUnits;state.logs=[];});
            const original=P.handle;
            P.handle=(path,...args)=>path==='/api/sms/units'?Promise.resolve({success:true,source:'wialon',integrationAvailable:true,units:transferTestUnits}):original(path,...args);
        })()`);
        await run('loadSendHelpers()');
        assert.equal(await rows('available'), 25); assert.equal(await rows('selected'), 0);
        await search('Test Unit 01'); await mark('available', 9001);
        await search('Test Unit 02'); await mark('available', 9002);
        assert.equal(await rows('selected'), 0); assert.equal(await run('document.getElementById("sm-recipient-count").textContent'), '0');
        await run('document.querySelector("[data-move]").click()');
        assert.equal(await rows('selected'), 2);
        await run('document.querySelector("[data-clear]").click()'); await search('');
        await run('document.querySelector("[data-status]").value="offline";document.querySelector("[data-status]").dispatchEvent(new Event("change"));document.querySelector("[data-all=available]").click()');
        assert.equal(await rows('available'), 20); assert.equal(await rows('selected'), 0);
        assert.ok(await run('document.querySelector("[data-move]").textContent.includes("(20)")'));
        await run('document.querySelector("[data-move]").click()');
        assert.equal(await rows('selected'), 20); assert.equal(await rows('available'), 0);
        assert.equal(await run('document.getElementById("sm-recipient-count").textContent'), '20');
        await run('document.querySelector("[data-status]").value="all";document.querySelector("[data-status]").dispatchEvent(new Event("change"));document.getElementById("sm-channel-whatsapp").click()');
        assert.equal(await rows('available'), 5); assert.equal(await rows('selected'), 20);
        // EDIT BY NADA — marking an available online unit must not silently add it to the outgoing message.
        await mark('available', 9021);
        await run('document.getElementById("send-text").value="Test-only bulk message";sendSms()');
        const logs = await b.evaluate('ObserverPreview.read().logs.map(log=>({unitId:log.unitId,status:log.status}))');
        assert.equal(logs.length, 20); assert.ok(logs.every(log => Number(log.unitId) >= 9001 && Number(log.unitId) <= 9020 && log.status === 'simulated'));
        await mark('selected', 9001); await mark('selected', 9002); await run('document.querySelector("[data-remove]").click()');
        assert.equal(await rows('selected'), 18); assert.equal(await rows('available'), 7);
        // EDIT BY NADA — selecting a contact and clearing contacts must preserve the independent unit boxes.
        await b.evaluate('ObserverPreview.handle("/api/contacts","POST",{name:"Transfer test contact",phoneNumber:"201111222333",group:"Test"})');
        await run('loadContacts();document.querySelector("[data-recipient-source=contact]").click()');
        await until(async () => await run('document.querySelectorAll("#sm-recipient-list input").length') > 0, 'contact picker retained');
        await run('document.querySelector("#sm-recipient-list input").click();document.getElementById("sm-clear-selection").click();document.querySelector("[data-recipient-source=unit]").click()');
        assert.equal(await rows('selected'), 18);
        await b.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, [...b.sessions][0]);
        assert.ok(await run('document.documentElement.scrollWidth<=innerWidth'));
        assert.deepEqual(b.exceptions, []); assert.deepEqual(b.external, []);
    } finally { await b.close(); await stop(server); }
});
