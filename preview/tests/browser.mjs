// EDIT BY NADA — dependency-free browser harness using the installed Chromium DevTools protocol.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(fn, description, timeout = 12000) { const start = Date.now(); let last; while (Date.now() - start < timeout) { try { const value = await fn(); if (value) return value; } catch (error) { last = error; } await pause(80); } throw new Error(`Timed out: ${description}${last ? ': ' + last.message : ''}`); }
// EDIT BY NADA — embedded-rendering tests may allow another explicitly local test origin.
// EDIT BY NADA — explicitly selected browsers never fall back to a different executable.
export async function browser(origin, additionalOrigins = [], browserName = 'auto') {
  const allowedOrigins = [origin, ...additionalOrigins];
  assert.ok(allowedOrigins.every(value => { const url = new URL(value); return url.protocol === 'http:' && url.hostname === 'observer-preview.localhost'; }), 'Browser tests allow only dedicated loopback preview origins.');
  const installed = { chrome: 'C:/Program Files/Google/Chrome/Application/chrome.exe', edge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' };
  assert.ok(['auto', 'chrome', 'edge'].includes(browserName));
  const paths = browserName === 'auto' ? Object.values(installed) : [installed[browserName]]; let executable;
  for (const candidate of paths) try { await fs.access(candidate); executable = candidate; break; } catch { /* EDIT BY NADA — inspect only known local browser paths. */ }
  if (!executable) throw new Error('An installed Chrome/Edge is required; no dependency or browser download will be attempted.');
  const profile = path.join(root, `.browser-test-${process.pid}`); await fs.mkdir(profile, { recursive: true });
  // EDIT BY NADA — disable only the test browser OS sandbox for this restricted runner; iframe isolation remains enabled.
  const child = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--disable-domain-reliability', '--disable-client-side-phishing-detection', '--safebrowsing-disable-auto-update', '--metrics-recording-only', '--disable-features=OptimizationHints,MediaRouter,Translate', '--host-resolver-rules=MAP observer-preview.localhost 127.0.0.1, MAP * ~NOTFOUND', '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=observer-preview.localhost;127.0.0.1;localhost', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let browserErrors = ''; child.stderr.on('data', data => { browserErrors = (browserErrors + data).slice(-6000); });
  let ws, exit = false; child.on('exit', () => { exit = true; });
  const active = await until(async () => { if (exit) throw new Error('Browser exited before debugger started.'); const text = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); return text.trim().split('\n'); }, 'browser debugger port');
  const debugOrigin = `http://127.0.0.1:${active[0]}`;
  ws = new WebSocket(`ws://127.0.0.1:${active[0]}${active[1]}`);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const pending = new Map(), contexts = new Map(), events = [], sessions = new Set(), external = [], requests = [], exceptions = [];
  let sequence = 0, mainSession, closed = false;
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { if (closed) return reject(new Error('Debugger closed')); const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Debugger timeout: ${method}`)); }, 15000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  ws.addEventListener('message', async event => {
    const message = JSON.parse(event.data), session = message.sessionId;
    if (message.id) { const item = pending.get(message.id); if (!item) return; clearTimeout(item.timer); pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); return; }
    events.push(message);
    if (message.method === 'Target.attachedToTarget') {
      const id = message.params.sessionId; sessions.add(id); if (message.params.targetInfo.type === 'page' && !mainSession) mainSession = id;
      // EDIT BY NADA — include browser security/resource errors, not only JavaScript exceptions.
      try { await call('Runtime.enable', {}, id); await call('Log.enable', {}, id); await call('Network.enable', {}, id); await call('Page.enable', {}, id); await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, id); await call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, id); await call('Runtime.runIfWaitingForDebugger', {}, id); } catch (error) { if (!closed) exceptions.push('HARNESS: ' + error.message); }
    }
    // EDIT BY NADA — preserve fail-closed interception while permitting the two local embedding-test origins.
    if (message.method === 'Fetch.requestPaused') { const { requestId, request } = message.params; const local = allowedOrigins.some(value => request.url.startsWith(value + '/')) || request.url.startsWith('data:') || request.url.startsWith('blob:') || request.url === 'about:blank'; if (!local) external.push(request.url); try { await call(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId } : { requestId, errorReason: 'BlockedByClient' }, session); } catch { /* EDIT BY NADA — navigation cancellation can invalidate an intercepted request. */ } }
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault) contexts.set(`${session}:${message.params.context.id}`, { session, id: message.params.context.id });
    if (message.method === 'Runtime.executionContextDestroyed') contexts.delete(`${session}:${message.params.executionContextId}`);
    if (message.method === 'Runtime.executionContextsCleared') for (const [key, context] of contexts) if (context.session === session) contexts.delete(key);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  // EDIT BY NADA — explicitly attach the page; browser-level tab targets vary by Chromium version.
  const target = await call('Target.createTarget', { url: 'about:blank' });
  const attached = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  mainSession = attached.sessionId;
  try { await until(() => mainSession && contexts.size > 0, 'attached test page'); }
  catch (error) { console.log('Debugger diagnostics: ' + JSON.stringify({ exceptions, events: events.slice(-5), browserErrors })); try { await call('Browser.close'); } catch {} ws.close(); child.kill(); throw error; }
  const evaluateAt = async (expression, context) => { const result = await call('Runtime.evaluate', { expression, contextId: context.id, returnByValue: true, awaitPromise: true, userGesture: true }, context.session); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  async function contextFor(frame = false) { for (const context of [...contexts.values()]) { try { const pathname = await evaluateAt('location.pathname', context); if (frame ? pathname.startsWith('/pages/') : context.session === mainSession && pathname === '/') return context; } catch { /* EDIT BY NADA — discard stale contexts during navigation. */ } } return null; }
  const evaluate = async (expression, frame = false) => { const context = await until(() => contextFor(frame), frame ? 'sandbox context' : 'shell context'); return evaluateAt(expression, context); };
  const navigate = async (page = 'index.html', args = '') => { await call('Page.navigate', { url: origin + '/?page=' + encodeURIComponent(page) + (args ? '&args=' + encodeURIComponent(args) : '') }, mainSession); await until(async () => await evaluate('location.pathname', true) === '/pages/' + page, `page ${page}`); await until(async () => await evaluate('document.readyState', true) === 'complete', 'page loaded'); await pause(250); };
  await call('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true });
  // EDIT BY NADA — expose browser identity so verification evidence names the actual executable and user agent.
  const identity = { executable, ...(await call('Browser.getVersion')) };
  return { identity, call, evaluate, navigate, events, requests, external, exceptions, sessions, screenshot: async name => { const result = await call('Page.captureScreenshot', { format: 'png' }, mainSession); await fs.mkdir(path.join(root, 'artifacts'), { recursive: true }); await fs.writeFile(path.join(root, 'artifacts', name), Buffer.from(result.data, 'base64')); }, close: async () => { try { await call('Browser.close'); } catch { /* EDIT BY NADA — closing the browser may close its debugger before the response. */ } closed = true; ws.close(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Browser closed')); } pending.clear(); if (!exit) await until(() => exit, 'browser shutdown', 5000).catch(() => child.kill()); assert.ok(profile.startsWith(root + path.sep) && path.basename(profile).startsWith('.browser-test-')); await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } };
}
