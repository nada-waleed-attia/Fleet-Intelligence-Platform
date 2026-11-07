// EDIT BY NADA — local static development tool; no production modules, environment files or proxy.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform, pages } from './transform.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(root, '..', 'public');
export const hostname = 'observer-preview.localhost';
const scripts = new Set(['shell.js', 'fixtures.js', 'storage.js', 'handlers.js', 'exports.js', 'bootstrap.js', 'local-widgets.js', 'page-behaviors.js', 'dashboard.js', 'dashboard-theme.css', 'units.js', 'units-theme.css', 'preview.css', 'frame.css', 'print.css', 'sms-theme.css', 'wialon-reports-theme.css', 'green-pages-theme.css', 'icons.js', 'observer-reports-theme.css']);
scripts.add('unit-detail.js');
scripts.add('unit-detail-theme.css');
scripts.add('wialon-reports.js');
scripts.add('wialon-workspace.css');
scripts.add('report-language.js');
scripts.add('sensor-report.js');
scripts.add('sensor-report.css');
scripts.add('battery-filter.js');
scripts.add('sms-workspace.css');
scripts.add('sms-workspace.js');
scripts.add('maintenance-workspace.css');
scripts.add('maintenance-workspace.js');
scripts.add('installations-workspace.css');
scripts.add('installations-workspace.js');
scripts.add('operations-workspace.css');
scripts.add('operations-workspace.js');
// EDIT BY NADA — the approved Observer logo is the only logo asset used by preview responses.
const assets = new Set(['logo-icon.jpg', 'logo-full.jpg', 'observe-logo.png', 'login-bg-reference.jpg', 'logo-icon-old-black-bg.jpg', 'generated/letterhead-1.png', 'cairo-variable.ttf', 'cairo-OFL.txt']);
// EDIT BY NADA — allow only the two shared local transfer-picker assets; APIs remain blocked.
assets.add('sms-unit-transfer.js');
assets.add('sms-unit-transfer.css');
export function createPreviewServer(port = 4174) {
  return http.createServer(async (request, response) => {
    const reply = (status, content, type = 'text/plain; charset=utf-8', extra = {}) => { response.writeHead(status, { 'Content-Type': type, ...extra }); response.end(request.method === 'HEAD' ? undefined : content); };
    // EDIT BY NADA — embedded preview panels have a different ancestor origin. Do not restrict embedding;
    // the opaque page sandbox, validated bridge, resource allowlist and network CSP still enforce isolation.
    const common = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'self'";
    response.setHeader('Content-Security-Policy', common);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    if (!['GET', 'HEAD'].includes(request.method)) return reply(405, 'Preview serves static files only.');
    if (request.headers.host !== `${hostname}:${port}`) {
      if ([`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) return reply(302, '', 'text/plain', { Location: `http://${hostname}:${port}/` });
      return reply(403, 'Unrecognized preview host.');
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, `http://${hostname}:${port}`).pathname); } catch { return reply(400, 'Invalid path'); }
    try {
      if (pathname === '/' || pathname === '/index.html') return reply(200, await fs.readFile(path.join(root, 'index.html')), 'text/html; charset=utf-8');
      const page = pathname.match(/^\/pages\/([a-z-]+\.html)$/)?.[1];
      if (page && pages.includes(page)) {
        response.setHeader('Content-Security-Policy', common.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("frame-src 'self'", "frame-src 'none'"));
        return reply(200, transform(await fs.readFile(path.join(publicRoot, page), 'utf8'), page), 'text/html; charset=utf-8');
      }
      const name = pathname.replace(/^\/preview\//, '');
      if (pathname.startsWith('/preview/') && scripts.has(name)) return reply(200, await fs.readFile(path.join(root, name)), name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
      const asset = pathname.replace(/^\/assets\//, '');
      if (pathname.startsWith('/assets/') && assets.has(asset)) {
        // EDIT BY NADA — serve shared picker code and styles with their correct MIME types.
        const type = asset.endsWith('.js') ? 'text/javascript; charset=utf-8' : asset.endsWith('.css') ? 'text/css; charset=utf-8' : asset.endsWith('.png') ? 'image/png' : asset.endsWith('.ttf') ? 'font/ttf' : asset.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'image/jpeg';
        // Sandboxed page frames have an opaque origin; allow their public font requests.
        return reply(200, await fs.readFile(path.join(publicRoot, 'assets', asset)), type, asset.endsWith('.ttf') ? { 'Access-Control-Allow-Origin': '*' } : {});
      }
      return reply(404, 'Blocked: this resource is outside the preview allowlist.');
    } catch (error) { return reply(500, 'Preview could not load an allowlisted local resource.'); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPreviewServer();
  server.on('error', error => { console.error(`Preview could not start: ${error.message}`); process.exitCode = 1; });
  server.listen(4174, '127.0.0.1', () => console.log('PREVIEW MODE: http://observer-preview.localhost:4174/ — no backend or network proxy'));
}
