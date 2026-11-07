<!-- EDIT BY NADA -->
# Preview Mode implementation report

## Subsequent authorized update — 4 November 2026

The user explicitly approved backend changes and confirmed a literal **8000 V** Battery Down threshold. Fleet export columns, the white fleet PDF surface, and local-account-only Wialon reporting are implemented in the backend and mirrored by the preview. Unit Detail also has the three requested connection metadata cards. Isolated backend tests and the corresponding browser workflows cover these changes; see README.md for scope and commands.

## Original roadmap delivery (historical)

Approved scope completed: roadmap Phases 1–3 (contracts, isolation, local interactive workflows and reset). No production fixes, React/Vite migration, dependency installation, backend start, database connection or provider call was performed.

**Preview:** http://observer-preview.localhost:4174/

**Start:** `node preview/serve.mjs` from the project directory. The delivered preview process is running on loopback port 4174. Operational details and feature instructions are in [README.md](README.md); endpoint and data contracts are in [CONTRACTS.md](CONTRACTS.md).

## Verification results

The combined command `node --test preview/tests/contracts.test.mjs preview/tests/workflows.test.mjs` passed **16 tests**, including **49 real-browser checks**.

* All 13 existing pages are accessible in exploration mode and visibly labelled PREVIEW MODE.
* Browser workflows cover dashboard charts/toggles, unit search/filter/sort/details, original report actions, simulated SMS/WhatsApp, persisted contacts, maintenance creation/edit/status transitions, local multipart attachments/signatures, original installation/device-replacement forms, manual/sample scanner callbacks, admin creation/permissions and simulated email.
* Browser navigation/reload preserves records; reset restores seeded records/users and removes stored attachments. SMS history starts empty and records only local attempts made from the page.
* Opaque-origin page frames cannot read cookies, browser storage or the parent DOM. Switching to a restricted persona removes stale forbidden content.
* Normal workflows produced **zero external requests**. Direct external fetch/navigation, unknown API routes, real-token submissions, XHR/socket APIs and an intentional external-image probe were blocked. The image probe triggered browser CSP enforcement before transmission; a blocked browser request event is not counted as a transmitted request.
* No uncaught browser exceptions occurred.
* SHA-256 checks passed for **all 57 pre-existing project files outside node_modules**. No dependencies were installed or changed. Root package files, all production HTML and all backend files are unchanged.
* The live preview returned HTTP 200 for its shell and transformed pages, HTTP 404 for `/api/me`, and the expected connection-blocking CSP.

Network evidence is in [artifacts/browser-results.json](artifacts/browser-results.json). Screenshots are [artifacts/dashboard.png](artifacts/dashboard.png) and [artifacts/mobile-preview.png](artifacts/mobile-preview.png). Embedded image contents are omitted from request logs. Browser tests deliberately deny downloads; CSV quoting/formula-neutralization and generated report content are verified separately.

## Exact added-file inventory

All additions are inside `preview/`. **Changed existing project files: none.**

| Category | Added files |
| --- | --- |
| Documentation and baseline | `CONTRACTS.md`, `README.md`, `IMPLEMENTATION_REPORT.md`, `production-baseline.json` |
| Static development tool | `serve.mjs`, `transform.mjs` |
| Trusted preview shell | `index.html`, `shell.js`, `preview.css`, `frame.css`, `print.css` |
| Synthetic records, persistence and actions | `fixtures.js`, `storage.js`, `handlers.js`, `exports.js` |
| Sandboxed-page adapters | `bootstrap.js`, `local-widgets.js`, `page-behaviors.js` |
| Automated tests | `tests/contracts.test.mjs`, `tests/browser.mjs`, `tests/workflows.test.mjs` |
| Generated verification artifacts | `artifacts/browser-results.json`, `artifacts/dashboard.png`, `artifacts/mobile-preview.png` |

Source files contain `EDIT BY NADA` using valid comments. JSON manifests of verification data and binary screenshots are documented here instead of receiving invalid comments. Disposable test browser profiles were confined to `preview/` and removed; they are not deliverables.

## Remaining limitations

* Messaging, email, OAuth, telemetry, external IP, provider responses and Wialon report execution are simulations, clearly separated from production behavior.
* Excel actions produce actual `.csv` files; PDF actions provide printable demo HTML and browser Save as PDF. Production XLSX/PDF layouts/letterheads are not reproduced.
* Charts use a small native-canvas preview renderer, and external fonts use system fallbacks. No CDN resources or additional packages are loaded.
* Camera decoding depends on browser BarcodeDetector support and camera permission; sample/manual input was tested. Physical camera decoding and the operating system print dialog need manual verification.
* Attachments accept PNG/JPEG/WebP/GIF, at most six per vehicle and 4 MB per photo. Records and files are local to this browser/origin and subject to storage limits; no shared persistence exists.
* Known production defects are retained, including the missing units PNG logo, live PDF helper exports and missing maintenanceReports permission definition. Successful demo behavior does not validate those backend features.
* Tests use a disposable installed Chrome/Edge instance with background egress disabled. Its OS process sandbox is disabled for this restricted runner; the application iframe sandbox remains enabled and verified.

Phase 4 and all migrations remain unstarted and require separate approval.
