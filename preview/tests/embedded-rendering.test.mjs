// EDIT BY NADA — regression: a different-origin preview panel must display the dashboard and retain isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { createPreviewServer } from '../serve.mjs';
import { browser, until } from './browser.mjs';

// EDIT BY NADA — regression now runs specifically in Microsoft Edge, never Chrome.
test('Microsoft Edge dashboard renders inside a different-origin preview panel', { timeout: 90000 }, async () => {
  const previewOrigin = 'http://observer-preview.localhost:4179';
  const panelOrigin = 'http://observer-preview.localhost:4180';
  const preview = createPreviewServer(4179);
  // EDIT BY NADA — a local static embedding fixture, with no backend or external destination.
  const panel = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; frame-src ${previewOrigin}` });
    response.end(`<!doctype html><!-- EDIT BY NADA --><html><head><title>Embedded rendering regression</title></head><body style="margin:0"><iframe title="Embedded preview panel" src="${previewOrigin}/" style="display:block;border:0;width:100vw;height:100vh"></iframe></body></html>`);
  });
  await Promise.all([new Promise(resolve => preview.listen(4179, '127.0.0.1', resolve)), new Promise(resolve => panel.listen(4180, '127.0.0.1', resolve))]);
  let b;
  try {
    b = await browser(panelOrigin, [previewOrigin], 'edge');
    console.log('Verified browser: ' + JSON.stringify(b.identity));
    await b.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }, [...b.sessions][0]);
    await b.navigate('index.html');
    await until(async () => await b.evaluate("document.getElementById('c-tot')?.innerText", true) === '24', 'embedded dashboard data');
    const dashboard = await b.evaluate(`(()=>{const elements=['.app','.header','#content','.cards','#chart-status','#chart-battery'];return {elements:elements.map(selector=>{const node=document.querySelector(selector),style=getComputedStyle(node),rect=node.getBoundingClientRect();return {selector,display:style.display,visibility:style.visibility,width:rect.width,height:rect.height}}),scripts:[...document.scripts].map(s=>s.src||'inline dashboard script'),styles:[...document.styleSheets].map(s=>s.href||'inline dashboard styles'),loading:getComputedStyle(document.getElementById('loading')).display,counters:['c-tot','c-on','c-off','c-battzero'].map(id=>document.getElementById(id).innerText),opaque:(()=>{try{parent.document;return false}catch{return true}})()}})()`, true);
    assert.ok(dashboard.elements.every(node => node.display !== 'none' && node.visibility === 'visible' && node.width > 0 && node.height > 0), JSON.stringify(dashboard.elements));
    assert.equal(dashboard.loading, 'none');
    assert.deepEqual(dashboard.counters, ['24', '16', '8', '4']);
    assert.ok(dashboard.opaque, 'Page sandbox must still deny parent access.');
    assert.deepEqual(b.exceptions, []);
    assert.deepEqual(b.external, []);
    const errors = b.events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error').map(e => e.params.entry.text);
    assert.deepEqual(errors, [], 'No console resource/CSP errors in the embedded dashboard.');
    // EDIT BY NADA — keep Edge-specific screenshots/evidence distinct from earlier Chrome runs.
    await b.screenshot('edge-embedded-dashboard.png');
    await fs.writeFile(new URL('../artifacts/edge-rendering-results.json', import.meta.url), JSON.stringify({ previewOnly: true, passed: true, browser: b.identity, dashboard, consoleErrors: errors, exceptions: b.exceptions, externalRequests: b.external }, null, 2));
  } catch (error) {
    if (b) {
      const errors = b.events.filter(e => e.method === 'Log.entryAdded').map(e => ({ level: e.params.entry.level, text: e.params.entry.text }));
      console.log('Embedded browser diagnostics: ' + JSON.stringify({ errors, exceptions: b.exceptions }));
      await b.screenshot('embedded-rendering-failure.png');
    }
    throw error;
  } finally {
    if (b) await b.close();
    await Promise.all([new Promise(resolve => preview.close(resolve)), new Promise(resolve => panel.close(resolve))]);
  }
});
