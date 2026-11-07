// EDIT BY NADA — response-only transformations; original production HTML is never written.
import { englishOperations } from './operations-language.mjs';
export const pages = ['index.html', 'units.html', 'unit.html', 'observer-reports.html', 'wialon-reports.html', 'sms.html', 'maintenance.html', 'installations.html', 'maintenance-report.html', 'admin-users.html', 'login.html', 'login-standalone.html', 'wialon-callback.html'];
function rewrite(code, attribute = false) {
  let out = code.replace(/window\.open\s*\(/g, 'ObserverPreview.open(').replace(/window\.print\s*\(/g, 'ObserverPreview.print(');
  out = out.replace(/(?:window\.)?location\.href\s*=\s*([^;]+);/g, 'ObserverPreview.navigate($1);');
  if (attribute) out = out.replace(/(?:window\.)?location\.href\s*=\s*([^;]+)$/g, 'ObserverPreview.navigate($1)');
  return out.replace(/(?<![\w.])confirm\s*\(/g, 'await ObserverPreview.confirm(').replace(/(?<![\w.])prompt\s*\(/g, 'await ObserverPreview.prompt(');
}
export function transform(html, page) {
  if (!pages.includes(page)) throw new Error('Unknown preview page');
  if (page === 'maintenance-report.html') html = englishOperations(html);
  let output = html.replace(/<link\b[^>]*href=["']https?:[^>]*>/gi, '')
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attributes, body) => {
      if (/\bsrc\s*=/.test(attributes)) return '';
      if (page === 'wialon-callback.html') return '';
      return `<script${attributes}>\n// EDIT BY NADA — navigation and dialogs are local preview adapters.\n${rewrite(body)}<\/script>`;
    });
  // EDIT BY NADA — remove pasted Markdown fences from the unit preview's HTML response.
  if (page === 'unit.html') output = output.replace(/^\s*```(?:html)?\s*$/gm, '');
  output = output.replace(/\bon(click|change|input|submit)\s*=\s*"([^"]*)"/gi, (_, event, code) => `on${event}="${rewrite(code, true)}"`);
  // Identify every page before its first paint and use the local Cairo typeface throughout.
  output = output.replace(/<body\b/i, `<body data-preview-page="${page}"`);
  if (page === 'index.html') output = output.replace(/<body\b/i, '<body class="preview-dashboard"');
  if (page === 'observer-reports.html') output = output.replace(/<body\b/i, '<body id="observer-reports-view"');
  if (page === 'wialon-reports.html') output = output.replace(/<body\b/i, '<body id="wialon-reports-view"');
  if (page === 'sms.html') output = output.replace(/<body\b/i, '<body id="sms-workspace-view"');
  if (page === 'maintenance.html') output = output.replace(/<body\b/i, '<body id="maintenance-workspace-view"');
  if (page === 'installations.html') output = output.replace(/<body\b/i, '<body id="installation-workspace-view"');
  if (['maintenance-report.html','admin-users.html'].includes(page)) output = output.replace(/<body\b/i, '<body class="operations-workspace"');
  output = output.replace(/font-family\s*:[^;}]+;/gi, 'font-family: "Cairo", sans-serif;');
  output = output.replace(/<head\b[^>]*>/i, `$&\n<!-- EDIT BY NADA — isolated preview bootstrap, before every original script. -->\n<link rel="stylesheet" href="/preview/frame.css">${page === 'sms.html' ? '\n<link rel="stylesheet" href="/preview/sms-theme.css">' : ''}\n<script src="/preview/bootstrap.js"><\/script>\n<script src="/preview/local-widgets.js"><\/script>\n<script defer src="/preview/page-behaviors.js"><\/script>`);
  output = output.replace('<link rel="stylesheet" href="/preview/frame.css">', '$&\n<link rel="stylesheet" href="/preview/green-pages-theme.css">');
  output = output.replace('<script defer src="/preview/page-behaviors.js">', '<script src="/preview/icons.js"></script>\n<script defer src="/preview/page-behaviors.js">');
  output = output.replace('<script src="/preview/local-widgets.js">', '<script src="/preview/battery-filter.js"></script><script src="/preview/local-widgets.js">');
  if (page === 'observer-reports.html') output = output.replace('</head>', '<link rel="stylesheet" href="/preview/observer-reports-theme.css"><link rel="stylesheet" href="/preview/sensor-report.css"><script src="/preview/sensor-report.js"></script></head>');
  if (page === 'wialon-reports.html') output = output.replace('</head>', '<link rel="stylesheet" href="/preview/wialon-reports-theme.css"><link rel="stylesheet" href="/preview/wialon-workspace.css"><script src="/preview/report-language.js"></script><script defer src="/preview/wialon-reports.js"></script></head>');
  if (page === 'index.html') output = output.replace('</head>', '<link rel="stylesheet" href="/preview/dashboard-theme.css"><script defer src="/preview/dashboard.js"></script></head>');
  if (page === 'units.html') output = output.replace('</head>', '<link rel="stylesheet" href="/preview/units-theme.css"><script defer src="/preview/units.js"></script></head>');
  if (page === 'unit.html') output = output.replace('</head>', '<link rel="stylesheet" href="/preview/unit-detail-theme.css"><script defer src="/preview/unit-detail.js"></script></head>');
  // EDIT BY NADA — load the shared vanilla unit-transfer control before the isolated composer adapter.
  if (page === 'sms.html') output = output.replace('</head>', '<link rel="stylesheet" href="/preview/sms-workspace.css"><script defer src="/assets/sms-unit-transfer.js"></script><script defer src="/preview/sms-workspace.js"></script></head>');
  if (page === 'maintenance.html') output = output.replace('</head>', '<link rel="stylesheet" href="/preview/maintenance-workspace.css"><script defer src="/preview/maintenance-workspace.js"></script></head>');
  if (page === 'installations.html') output = output.replace('</head>', '<link rel="stylesheet" href="/preview/installations-workspace.css"><script defer src="/preview/installations-workspace.js"></script></head>');
  // EDIT BY NADA — replace production logo references only in the in-memory preview response.
  if (['maintenance-report.html','admin-users.html'].includes(page)) output = output.replace('</head>', '<link rel="stylesheet" href="/preview/operations-workspace.css"><script defer src="/preview/operations-workspace.js"></script></head>');
  output = output.replace(/(<img\b[^>]*\bsrc\s*=\s*["'])data:image\/[^"']+(["'])/gi, '$1/assets/observe-logo.png$2')
    .replace(/\/assets\/logo-icon\.(?:jpg|png)/gi, '/assets/observe-logo.png');
  // Preserve known production defects; preview additions are separate and labelled.
  return output.replace(/<title>/i, '<title>PREVIEW MODE · ');
}
