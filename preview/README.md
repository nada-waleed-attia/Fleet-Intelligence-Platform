<!-- EDIT BY NADA -->
# Observer Fleet — isolated interactive preview

This workspace implements approved roadmap Phases 1–3 only. It does not run Observer Fleet's backend, change production HTML, weaken real authentication, or migrate to React/Vite. All records are fictional. No dependencies are required or installed.

<!-- EDIT BY NADA — the subsequent SMS integration request authorizes these specific backend/frontend changes. -->
## Approved Wialon recipient picker — 5 November 2026

The subsequent request to source SMS/WhatsApp recipients from the backend adds `GET /api/sms/units` in `routes/sms.js` and a searchable multi-select in `public/sms.html` / `public/assets/sms-unit-picker.js`. These specific production frontend/backend edits supersede the original Preview-only boundary for this task. The route requires an authenticated session with SMS permission and calls the existing `getUnitsForUser(sessionUser)` integration, preserving its Wialon/session/customer scope. It returns only unit ID/name, device type, account, SIM, serial/IMEI and status. Device type comes from the existing mapped `unit.deviceType`; unresolved types and missing SIMs stay empty and display a dash or a missing-SIM notice. Wialon errors never fall back to seeded data.

In the connected application, selected SIMs are merged with additional numbers using the existing send flow. The picker works for both SMS and WhatsApp, validates missing SIMs, removes duplicate numbers and refreshes selected records by unit ID. This change does not configure a delivery provider or assert message delivery.

The static Preview remains isolated: its SMS picker now explains that Wialon is disconnected and returns no seeded unit recipients. Saved contacts remain independently available. No backend URL, token, credentials, CORS exception or network proxy is added to Preview. Live verification requires the connected Observer application and an authenticated user; starting `FMS.js` also starts unrelated application jobs and was not part of this task.

Verification: `node --test preview/tests/sms-wialon-picker.test.mjs` tests the actual router with isolated Wialon/provider substitutes, the production frontend in an isolated browser, and the disconnected Preview. No real Wialon request or message is sent by these tests.

## Approved backend update — 4 November 2026

The user subsequently authorized backend changes for the current fleet reporting requirements. The static preview still runs independently, without production sessions, Wialon calls, database connections or provider calls. Production HTML remains untouched.

* `lib/batteryFilter.js` and `routes/reports.js` implement **Battery Down below 8000 V literally**, as explicitly confirmed by the user. The default battery report includes zero and positive readings below that threshold; zero-only and positive-low-only variants are also supported. Missing/invalid readings are excluded.
* Fleet workbook columns start with ID, Unit Name, IMEI and SIM Number. Battery Status is removed. Fleet PDF pages explicitly paint a white background.
* `middleware/auth.js`, `routes/wialonReports.js` and the Wialon report page route in `FMS.js` restrict Wialon Reports to `authMode: local`, in addition to existing permissions. The preview mirrors this rule in navigation and local handlers.
* Unit Detail shows Device Type, Device IMEI and Device SIM Number from the available unit response. The Sensor Report keeps its own schema, dynamic multi-select filters and account ordering.

Backend route verification uses isolated Wialon/database/email substitutes: `node --test preview/tests/backend-reports.test.mjs`. No real backend process was started as part of this update.

## Run

From the project directory:

```powershell
# EDIT BY NADA — start only the dedicated static preview tool.
node preview/serve.mjs
```

Open **http://observer-preview.localhost:4174/**. The process listens on loopback only. Opening `http://127.0.0.1:4174/` redirects to the dedicated hostname. Stop the tool with Ctrl+C. Do not run `npm start`, `seed.js`, or database scripts for this preview.

Use the Page selector to visit every existing frontend page or open Wialon Hosting. Unit details default to demo unit 1001. The shell URL preserves the current page and query parameters for refresh/back navigation.

## Share on a phone (Safari / WhatsApp)

<!-- EDIT BY NADA - opt-in public sharing of the isolated demo only. -->
The `observer-preview.localhost` address works only on the computer running the preview. To get a temporary public HTTPS link that works on mobile data or another Wi-Fi network, run:

```powershell
powershell -ExecutionPolicy Bypass -File preview/share.ps1
```

This downloads the official Cloudflare tunnel utility into `tmp/` if needed, starts only the isolated preview, and prints the link to send through WhatsApp. Open that link in Safari. The computer must remain awake and online. Anyone with the link can view the fictional-data demo; each browser keeps its own local edits. This does not share the real backend or database. The script prints a command to stop the tunnel and records the latest link in `tmp/preview-share-session.json`. A new launch creates a new temporary address; permanent hosting requires a separate deployment.

## Explore

* **Explore all pages** gives the selected demo persona an all-access presentation so every screen can be inspected. This is explicitly a demo; no real identity/session exists.
* **Demonstrate permissions** applies the selected local user's permission flags and unit assignments. Switching to a restricted persona unloads an already-open forbidden page. Admin screens remain admin-only in this demonstration.
* **Scenario** supports normal, empty results, service errors, and failed message submission. Restore Normal to continue the standard workflow.
* **Reset demo data** clears only this preview's versioned record key and attachment database, then restores seeded users, records, counters and settings. SMS history is intentionally empty until a local attempt is made. Confirm through the local dialog.
* **Local activity** shows browser-bridge requests and simulated actions. These are not HTTP API requests.

Demo usernames are `demo.admin`, `demo.nile`, and `demo.delta`. Use persona selection instead of credentials. Password fields are disabled and password values are stripped before bridge calls. Wialon import accepts only `PREVIEW_ONLY`. Never paste real passwords/tokens or upload sensitive photos into a demo.

## Functional coverage

| Page | Local functionality |
| --- | --- |
| Dashboard | Shared counters, offline canvas chart renderer, clickable categories/labels, navigation, maintenance badge |
| Units / unit detail | Search, status and battery filters, preview online filter, sorting, row/detail navigation, local exports |
| Observer reports | Unit/group views, fleet/battery/offline/sensor sample reports |
| Wialon reports | Synthetic templates, unit/date selection, generated tables and local export |
| SMS / WhatsApp | Compose/validate/simulate submissions, success/failure logs, contacts/groups, channel/source/date filters, quota settings and derived usage |
| Maintenance requests | Original creation form, details, messages, receive/assign/resolve/close, history; preview toolbar adds local editing |
| Installations | Original form/vehicle controls, sample/manual scanning, optional local camera, local photos, original signature canvas, saved reports and local print view |
| Maintenance reports | Original device-swap form, old/new identifiers, photos, scanning and optional preview signature canvas |
| Admin users | Local creation/assignment/email/permission changes/deletion, synthetic unit import, simulated report email activity |
| Login variants / callback | Demo persona entry, local callback success/error; no real OAuth token processing |

Use Refresh demo actions on maintenance after creating a request to refresh the extra toolbar picker. Local edits and permission changes take effect immediately; this does not assert identical session-refresh behavior in production. The assignment prompt accepts `demo-admin` for the seeded admin.

## Offline and export boundaries

The preview works without internet while its local static tool is running. External CDN scripts/styles are removed from transformed responses. A small native-canvas renderer replaces Chart.js only in preview; fonts use system fallbacks. No external packages or downloads are needed.

Excel buttons produce correctly named **CSV**, not `.xlsx`. PDF buttons open a **DEMO-labelled printable HTML report**, with browser Print / Save as PDF. JSON downloads are also available. Arabic text remains Unicode; a selected Arabic report uses RTL presentation. Backend letterhead, Arabic PDF shaping and production XLSX/PDF layout are not reproduced or validated.

Photos are limited to six per vehicle, 4 MB each, PNG/JPEG/WebP/GIF. They and signatures persist in IndexedDB; records/settings persist under `observer-fleet-preview:v1` in localStorage. Attachments can be inspected through local report views and are deleted when their demo report is deleted or all data is reset. Storage is browser/origin-specific, not shared between devices. Blocking storage or exceeding quota reports an error rather than falling back to a server.

Scanning always offers sample/manual entry. Camera capture requires an explicit click in the trusted shell, camera permission, and native BarcodeDetector support. No camera stream is uploaded. Unsupported/denied camera access keeps manual input available. Hardware decoding and the operating system print dialog require manual verification.

Notifications, delivery statuses, outbound IP, OAuth and report execution are synthetic. Real telemetry, authentication, provider delivery, backend reports, database persistence and shared files require the real application and are not tested here. External map/service links are blocked. Existing production defects are preserved; notably the units page still references its missing PNG logo, and the live PDF helper/maintenanceReports-permission issues remain unresolved.

## Isolation implementation

The static tool uses Node built-ins only. It reads an explicit allowlist of production frontend files and preview assets. It never imports backend modules or reads `.env`, and has no proxy, API handlers, database clients or scheduled jobs. `/api/*`, non-GET/HEAD requests and filesystem traversal are rejected.

The trusted shell contains storage, fixtures, local handlers, local report rendering and optional camera controls. Production page responses are transformed in memory to inject a bootstrap before original scripts and route navigation/exports/dialogs locally. No source file is copied over or rewritten.

Page frames have **opaque origins**: their sandbox omits `allow-same-origin`, popups and top navigation. They cannot access cookies, localStorage, IndexedDB or the parent DOM. A source/origin-validated postMessage bridge is the only adapter. Unknown request methods, paths and bridge operations fail locally. Native fetch is never used by the adapter; XHR, WebSocket, EventSource, workers and beacons are disabled. Content Security Policy additionally blocks network connections, external resources, form submissions and child frames. This is a separate preview policy, never a production authentication change.

## Verify

```powershell
# EDIT BY NADA — tests touch only preview-owned browser storage and artifacts.
node --test preview/tests/contracts.test.mjs preview/tests/workflows.test.mjs
```

Contract tests check all pre-existing file hashes, transformed-script parsing, data relationships, CRUD/status validation, scoping, exports and static-server isolation. Browser tests use installed Chrome/Edge through built-in DevTools/WebSocket support; no browser/dependency is downloaded. Tests run on port 4176 and static-server checks on 4177, independently of the user preview on 4174.

The automated browser uses a disposable profile under `preview/`, disables background networking, blocks DNS/proxy egress, and intercepts requests before navigation. Its OS process sandbox is disabled only because this restricted runner cannot otherwise launch renderers; the application iframe sandbox remains enabled and is tested. Only loopback resources are permitted. A deliberate `.invalid` image probe must be blocked by CSP; its blocked browser event is distinguished from transmitted requests. Downloads are denied during browser tests; CSV content is checked separately.

Artifacts include `artifacts/browser-results.json`, `artifacts/dashboard.png`, and `artifacts/mobile-preview.png`. Test profile cleanup is confined to a verified absolute path inside `preview/`. `production-baseline.json` records SHA-256 hashes of all 57 existing files outside dependencies; the tool does not serve it.

## Added files and annotation exceptions

All added runtime/test code and HTML/CSS/Markdown contain `EDIT BY NADA` using valid comment syntax. `production-baseline.json`, generated `artifacts/browser-results.json`, screenshots and disposable browser-profile files do not support source comments and are reported separately. No production files are modified. No npm manifest/lockfile changes or dependency installations are needed.

* Contracts and operation: `CONTRACTS.md`, `README.md`, `IMPLEMENTATION_REPORT.md`, `production-baseline.json`
* Local static tooling: `serve.mjs`, `transform.mjs`
* Shell and styling: `index.html`, `shell.js`, `preview.css`, `frame.css`, `print.css`
* Local data/actions: `fixtures.js`, `storage.js`, `handlers.js`, `exports.js`
* Sandboxed-page adapters: `bootstrap.js`, `local-widgets.js`, `page-behaviors.js`
* Verification: `tests/contracts.test.mjs`, `tests/browser.mjs`, `tests/workflows.test.mjs`

Phase 4 production fixes and all migrations are out of scope and require separate approval.
