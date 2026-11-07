// EDIT BY NADA — this runs before original page scripts. Every API request uses the local message bridge.
(() => {
  const P = globalThis.ObserverPreview = {}, pending = new Map(), parentOrigin = new URL(document.URL).origin;
  document.documentElement.dataset.wialonReportsAllowed = 'false';
  let sequence = 0;
  P.call = (type, payload = {}) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('Preview shell did not respond. Open this page through the preview toolbar.')); }, ['scan', 'prompt', 'confirm', 'export', 'report-download'].includes(type) ? 300000 : 15000); pending.set(id, { resolve, reject, timer }); parent.postMessage({ channel: 'observer-preview-v1', id, type, payload }, parentOrigin); });
  window.addEventListener('message', event => { if (event.source !== parent || event.origin !== parentOrigin || event.data?.channel !== 'observer-preview-response-v1') return; const item = pending.get(event.data.id); if (!item) return; clearTimeout(item.timer); pending.delete(event.data.id); if (event.data.error) { const error = new Error(event.data.error); error.status = event.data.status; item.reject(error); } else item.resolve(event.data.result); });
  const localPath = value => { const url = new URL(value, document.URL); if (url.origin !== parentOrigin || url.username || url.password) throw new Error('External destinations are blocked in Preview Mode.'); return url.pathname + url.search; };
  // EDIT BY NADA — export navigations are local downloads, never document/API navigation.
  P.navigate = value => { try { const path = localPath(value); return P.call(path.startsWith('/api/') ? 'export' : 'navigate', { path }).catch(error => P.alert(error.message)); } catch (error) { P.alert(error.message); return Promise.resolve(false); } };
  P.open = value => { try { const path = localPath(value); return path.startsWith('/api/') ? P.call('export', { path }).catch(error => P.alert(error.message)) : P.navigate(path); } catch (error) { P.alert(error.message); return null; } };
  P.print = () => P.open('/api/reports/view');
  P.alert = text => { P.call('alert', { text: String(text) }).catch(() => {}); };
  P.confirm = text => P.call('confirm', { text: String(text) });
  P.prompt = (text, initial = '') => P.call('prompt', { text: String(text), initial });
  window.alert = P.alert;
  window.open = P.open;
  window.print = P.print;
  window.fetch = async (input, options = {}) => {
    const signal = options.signal || input?.signal; if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let path, body = options.body, method = String(options.method || input?.method || 'GET').toUpperCase();
    try { path = localPath(typeof input === 'string' || input instanceof URL ? String(input) : input.url); } catch (error) { return new Response(JSON.stringify({ success: false, error: error.message }), { status: 403, headers: { 'Content-Type': 'application/json' } }); }
    if (body instanceof FormData) { const object = {}; for (const [key, value] of body.entries()) { if (value instanceof Blob) (object[key] ||= []).push(value); else object[key] = value; } const signature = document.getElementById('preview-signature'); if (signature?.dataset.drawn === 'true') object.signature = signature.toDataURL('image/png'); body = object; }
    else if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return new Response(JSON.stringify({ success: false, error: 'Invalid local JSON body.' }), { status: 400 }); } }
    // EDIT BY NADA — demo entry never forwards passwords, even over the local bridge.
    if (body && typeof body === 'object') delete body.password;
    try { const result = await P.call('request', { path, method, body: body || {} }); if (path.split('?')[0] === '/api/me' && result.user) document.documentElement.dataset.wialonReportsAllowed = String(result.user.authMode === 'local'); if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    catch (error) { if (error.name === 'AbortError') throw error; return new Response(JSON.stringify({ success: false, error: error.message }), { status: error.status || 400, headers: { 'Content-Type': 'application/json' } }); }
  };
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker']) globalThis[name] = class { constructor() { throw new Error(`${name} is disabled in Preview Mode.`); } };
  navigator.sendBeacon = () => false;
  document.addEventListener('click', event => { const link = event.target.closest('a[href]'); if (!link) return; event.preventDefault(); const href = link.getAttribute('href'); if (href === '#' || !href) return; P.open(href); }, true);
  // EDIT BY NADA — PREVIEW MODE remains visible in the trusted sidebar; page content starts at the original header.
  document.addEventListener('DOMContentLoaded', () => {
    P.call('ready', { page: location.pathname }).catch(() => {});
    // EDIT BY NADA — let the mobile shell use one page-level scrollbar instead of a nested iframe scrollbar.
    let lastHeight = 0, resizeFrame = 0;
    const reportHeight = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        const height = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
        if (height === lastHeight) return;
        lastHeight = height;
        parent.postMessage({ channel: 'observer-preview-v1', id: ++sequence, type: 'resize', payload: { height } }, parentOrigin);
      });
    };
    new ResizeObserver(reportHeight).observe(document.documentElement);
    new MutationObserver(reportHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener('load', reportHeight, { once: true });
    reportHeight();
  });
})();
