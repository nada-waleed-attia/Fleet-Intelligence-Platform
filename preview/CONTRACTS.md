<!-- EDIT BY NADA -->
# Observer Fleet preview contracts

This is a frontend development environment, not an application backend. All responses below are synthetic browser responses; no endpoint is forwarded. Unknown methods/paths fail closed. IDs, dates, status spellings, response wrappers, and relationships follow current frontend consumers. The separately authorized backend battery/report changes are documented in README.md; the preview does not execute that backend code.

| Pages | Requests consumed | Local response / behavior |
| --- | --- | --- |
| login.html, login-standalone.html | POST /api/login | Demo persona only; `{success,user}`; no passwords stored |
| wialon-callback.html | GET /api/wialon-oauth-url, POST /api/login/wialon-token | Local demo callback only; real tokens rejected |
| All authenticated pages | GET /api/me, POST /api/logout | `{success,user}`; user has `id`, `username`, `displayName`, `role`, `authMode`, `permissions`, `assignedUnitNames`, `wialonAccounts` |
| index.html, units.html, unit.html | GET /api/dashboard, GET /api/units/:id | `{success,counters,units}` and `{success,unit}`; counters derived from scoped demo units |
| observer-reports.html, units.html, unit.html | GET /api/reports/view, /export, /view-sensors, /export-sensors, /export-unit/:id | Fleet view/CSV/PDF/print; filters all, offline and battery ranges; Sensor Report has separate columns, dynamic device/account multi-filters and account ordering |
| wialon-reports.html | GET /api/wialon-reports/templates, /units; POST /run; GET /export | Local authentication accounts only; `{success,templates}`, `{success,units}`, `{success,results}`; preserve template/resource IDs, intervals and per-unit tables |
| sms.html | GET /api/contacts, /groups; POST /api/contacts; DELETE /api/contacts/:id | `{success,contacts}`, `{success,groups}`; local CRUD only |
| sms.html | POST /api/sms/send; GET /report, /report/export, /quota-settings, /status; PUT /quota-settings; GET /api/server-ip | Local attempt logs, counts and quota; source manual/alert, channel sms/whatsapp, status simulated/failed; no SMS provider access or carrier delivery |
| maintenance.html | GET/POST /api/maintenance; GET /vehicles, /:id; POST /:id/reply; PATCH /:id/receive, /assign, /resolve, /close | `{success,requests}`, `{success,request}`, `{success,units}`; pending → received → in_progress → resolved → closed; messages/history retained |
| installations.html | GET /api/installations/companies, /units, /; POST /; DELETE /:id; GET /:id/pdf | `{success,companies}`, `{success,units}`, `{success,reports}`; multipart metadata/photos stored in browser only |
| maintenance-report.html | Same operations under /api/maintenance-reports | Device replacement reports include old/new IMEI, serial and SIM fields |
| admin-users.html | GET/POST /api/admin/users; PATCH/DELETE /:id; POST /:id/import-wialon-units; POST /api/reports/send-email/:id | `{success,users}` / `{success,user}`; local CRUD, demo unit assignment and notification log |

## Data invariants

* Units use numeric `id`; include `name`, `accountGroup`, `status`, `lastMessageTime`, `location`, `offlineDays`, `batteryVolts`, `deviceBatteryVolts`, `batteryStatus`, `batterySource`, sensor values and `hasMileage`/`hasFuel`.
* Users/entities include `id` and `_id` where existing consumers expect either. Never include real credentials or tokens.
* Requests include `requestNumber`, customer and creator references/names, `vehicles`, `priority`, `status`, `messages`, `history` and timestamps. Local edit support is a preview extension, not a promise that the live API supports it.
* Installation and replacement reports include `company`, `companyName`, `items`, report date, `employeeName`, `jobTitle`, `signature`; each item has unit identifiers, device identifiers, notes and local photo references.
* Contacts use `name`, `phoneNumber`, `group`; message logs use `receiverMSISDN`, `smsText`, `channel`, `source`, `status`, unit/customer references and timestamps.
* Dashboard, unit details, exports, badges and quotas derive from one versioned local store. Reset clears only preview-owned storage and IndexedDB.

## Isolation contract

Only an allowlisted local origin and static resources are served. Bootstrap executes before page scripts. Browser API interception never calls native fetch/XHR; CSP blocks network connections, external scripts/images/fonts, forms and frames. The page frame has an opaque origin (no allow-same-origin): it cannot read cookies, browser storage or parent DOM, open popups or navigate the top window. A source-validated postMessage bridge invokes handlers and persistence in the trusted shell. Camera scanning also runs in the shell and requires an explicit user click. Navigation and export calls are rewritten in transformed responses; no production source is changed. Neither tool nor browser loads production environment files or backend modules. No service workers or application network proxy are used.

## Known live differences

PDF helper exports and the backend maintenanceReports permission definition are inconsistent in the current project. Demo success does not validate those live features. CSV replaces Excel workbook downloads and printable HTML replaces backend PDFs, with accurate file extensions and DEMO labels. Camera scanning is optional and permission-based; manual/sample input always works. Notifications, external IP, OAuth, uploads and delivery receipts are simulations. Production authentication and server-side permission enforcement are untouched.
