// EDIT BY NADA — local request handlers. No native fetch, sockets or backend imports.
(() => {
  const P = globalThis.ObserverPreview;
  P.html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const requireValue = (condition, message) => { if (!condition) { const error = new Error(message); error.status = 400; throw error; } };
  const list = value => Array.isArray(value) ? value.map(String) : String(value || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  const now = () => new Date().toISOString();
  const history = (request, user, action, details = '') => { request.updatedAt = now(); request.history.push({ action, by: user._id, byName: user.displayName, details, createdAt: now() }); };
  P.results = (state, query) => {
    const template = state.templates.find(t => String(t.templateId) === String(query.templateId));
    requireValue(template && String(template.resourceId) === String(query.resourceId), 'Select a demo report template.');
    requireValue(query.dateFrom && query.dateTo && query.dateFrom <= query.dateTo, 'Select a valid date range.');
    // EDIT BY NADA — exports and run results share the same scenario semantics.
    if (state.scenario === 'empty') return [];
    const ids = list(query.unitIds);
    return P.scopedUnits(state).filter(u => !ids.length || ids.includes(String(u.id))).map((u, i) => ({ unitId: u.id, unitName: u.name, tables: [{ name: template.name, headers: ['Vehicle', 'From', 'To', template.templateId === 2 ? 'Fuel (L)' : 'Distance (km)'], rows: [[u.name, query.dateFrom, query.dateTo, template.templateId === 2 ? 18 + i : 85 + i * 7]] }] }));
  };
  P.handle = async (path, method = 'GET', body = {}) => {
    const url = new URL(path, 'http://preview.invalid');
    requireValue(url.origin === 'http://preview.invalid' && !url.username && !url.password, 'External destinations are blocked in Preview Mode.');
    const route = url.pathname.replace(/\/$/, ''), q = Object.fromEntries(url.searchParams), state = P.read(), user = P.user(state);
    const ok = value => ({ success: true, ...value });
    const find = (items, id) => { const item = items.find(x => String(x._id ?? x.id) === String(id)); if (!item) { const e = new Error('Demo record not found.'); e.status = 404; throw e; } return item; };
    const write = fn => P.mutate(s => ok(fn(s)));
    const scopedRequests = s => s.requests.filter(r => s.mode === 'explore' || user.role === 'admin' || r.customer === user._id);
    if (route.startsWith('/api/wialon-reports') && user.authMode !== 'local') { const error = new Error('Wialon Reports is available to local accounts only.'); error.status = 403; throw error; }
    if (route === '/__preview/state' && method === 'GET') return ok({ state });
    if (route === '/api/me' && method === 'GET') return ok({ user: { ...user, ...(state.mode === 'explore' ? { role: 'admin', permissions: Object.fromEntries(P.permissions.map(k => [k, true])) } : {}) } });
    if (route === '/api/logout' && method === 'POST') return ok({ demo: true });
    if (route === '/api/login' && method === 'POST') { const selected = state.users.find(u => u.username === body.username && u.isActive); requireValue(selected, 'Use one of the listed demo usernames. No real credentials are accepted.'); return write(s => { s.activeUser = selected._id; return { user: selected }; }); }
    if (route === '/api/wialon-oauth-url' && method === 'GET') return ok({ url: '/wialon-callback.html?demo=success' });
    if (route === '/api/login/wialon-token' && method === 'POST') { requireValue(body.accessToken === 'PREVIEW_ONLY' || body.token === 'PREVIEW_ONLY', 'Real tokens are not accepted.'); return ok({ user }); }
    if (state.mode === 'permissions' && user.role !== 'admin') {
      // EDIT BY NADA — the real unit-recipient endpoint has the same SMS permission as the composer.
      let permission = route.startsWith('/api/admin') || route.includes('send-email') ? 'adminUsers' : route.startsWith('/api/installations') ? 'installations' : route.startsWith('/api/maintenance-reports') ? 'maintenanceReports' : route.startsWith('/api/maintenance') ? 'maintenance' : route.startsWith('/api/wialon-reports') ? 'wialonReports' : route.startsWith('/api/contacts') || ['/api/sms/send', '/api/sms/units'].includes(route) ? 'sms' : route.startsWith('/api/sms/report') ? 'reports' : route === '/api/sms/quota-settings' ? 'quota' : route === '/api/sms/status' ? 'status' : route.startsWith('/api/reports') || route.startsWith('/api/units') ? 'units' : null;
      if (permission && !user.permissions[permission]) { const e = new Error(`Demo permission denied: ${permission}`); e.status = 403; throw e; }
      if (route === '/api/sms/send' && body.channel === 'whatsapp' && !user.permissions.whatsapp) { const e = new Error('Demo WhatsApp permission denied.'); e.status = 403; throw e; }
      if (route === '/api/sms/quota-settings' && method === 'PUT') { const e = new Error('Demo admin access required.'); e.status = 403; throw e; }
    }
    if (state.scenario === 'error' && method === 'GET' && route !== '/__preview/state') { const e = new Error('Simulated service failure. Select Normal in the preview toolbar.'); e.status = 503; throw e; }
    const units = state.scenario === 'empty' ? [] : P.scopedUnits(state);
    // EDIT BY NADA — do not present seeded units as live Wialon recipients in the isolated preview.
    if (route === '/api/sms/units' && method === 'GET') return ok({ units: [], source: 'preview', integrationAvailable: false, message: 'Wialon units are available in the connected Observer application. This preview is not connected to the backend.' });
    if (route === '/api/dashboard' && method === 'GET') return ok({ units, counters: { totalUnits: units.length, onlineUnits: units.filter(u => !u.isOffline).length, offlineUnits: units.filter(u => u.isOffline).length, unitsWithMileage: units.filter(u => u.hasMileage).length, unitsWithFuel: units.filter(u => u.hasFuel).length, batteryZeroUnits: units.filter(u => u.batteryStatus === 'zero').length } });
    if (/^\/api\/units\/[^/]+$/.test(route) && method === 'GET') return ok({ unit: find(units, route.split('/').pop()) });
    if (route === '/api/server-ip' && method === 'GET') return ok({ outboundIp: '192.0.2.10 (synthetic; no lookup)' });
    if (route === '/api/contacts/groups' && method === 'GET') return ok({ groups: [...new Set(state.contacts.map(c => c.group))] });
    if (route === '/api/contacts') {
      if (method === 'GET') return ok({ contacts: state.scenario === 'empty' ? [] : state.contacts.filter(c => !q.group || c.group === q.group) });
      if (method === 'POST') { requireValue(body.name?.trim() && body.phoneNumber?.trim(), 'Name and demo recipient are required.'); return write(s => { const id = P.nextId(s, 'contact'), contact = { _id: id, id, name: body.name, phoneNumber: body.phoneNumber, group: body.group || 'General', notes: body.notes || '' }; s.contacts.push(contact); return { contact }; }); }
    }
    if (/^\/api\/contacts\/[^/]+$/.test(route) && method === 'DELETE') return write(s => { find(s.contacts, route.split('/').pop()); s.contacts = s.contacts.filter(c => c._id !== route.split('/').pop()); return {}; });
    if (route === '/api/sms/send' && method === 'POST') {
      requireValue(body.text?.trim(), 'Write a message.'); requireValue(['sms', 'whatsapp'].includes(body.channel || 'sms'), 'Select a valid channel.');
      const normalize = value => { let phone = String(value || '').trim(); if (/^DEMO-\d{3}$/.test(phone)) return phone; phone = phone.replace(/[\s().-]/g, '').replace(/^\+/, '').replace(/^00/, ''); if (/^01[0125]\d{8}$/.test(phone)) phone = '20' + phone.slice(1); return phone; };
      const valid = phone => /^(DEMO-\d{3}|\d{10,15})$/.test(phone), recipients = new Map();
      const add = (number, target) => { const phone = normalize(number); if (!phone) return; if (!recipients.has(phone)) recipients.set(phone, { number: phone, units: [], contactIds: [] }); const record = recipients.get(phone); if (target?.kind === 'unit' && !record.units.some(unit => unit.id === String(target.record.id))) record.units.push({ id: String(target.record.id), name: target.record.name }); if (target?.kind === 'contact' && !record.contactIds.includes(target.record._id)) record.contactIds.push(target.record._id); };
      if (body.targets !== undefined) {
        requireValue(Array.isArray(body.targets) && body.targets.length <= 1000, 'Choose an available recipient list.');
        for (const target of body.targets) {
          requireValue(target && ['unit', 'contact'].includes(target.kind) && ['string', 'number'].includes(typeof target.id), 'Invalid recipient selection.');
          const record = target.kind === 'unit' ? units.find(unit => String(unit.id) === String(target.id)) : state.contacts.find(contact => String(contact._id || contact.id) === String(target.id));
          requireValue(record, 'A selected recipient is no longer available. Refresh the recipient list.');
          const phone = target.kind === 'unit' ? record.mobileNumber || record.phoneNumber || record.simNumber || record.ph : record.phoneNumber;
          requireValue(valid(normalize(phone)), `No valid ${target.kind === 'unit' ? 'SIM' : 'phone'} number recorded for ${record.name}.`);
          add(phone, { kind: target.kind, record });
        }
      }
      list(body.numbers).forEach(number => add(number)); requireValue(recipients.size, 'Select recipients or enter phone numbers.'); requireValue(recipients.size <= 100, 'Maximum 100 unique preview recipients.');
      return write(s => { const results = [...recipients.values()].map(({ number, units: linkedUnits, contactIds }) => {
        const accepted = state.scenario !== 'send-failure' && valid(number);
        s.logs.unshift({ _id: P.nextId(s, 'log'), receiverMSISDN: number, smsText: body.text, channel: body.channel || 'sms', source: 'manual', status: accepted ? 'simulated' : 'failed', delivery: 'not_sent', errorMessage: accepted ? 'Preview only: no SMS provider is connected.' : 'Preview validation failed; nothing sent', unitId: linkedUnits.length ? linkedUnits.map(unit => unit.id).join(', ') : body.unitId || '', unitName: linkedUnits.length ? linkedUnits.map(unit => unit.name).join(', ') : body.unitName || '', unitIds: linkedUnits.map(unit => unit.id), contactIds, customerName: user.displayName, sentBy: user.username, createdAt: now(), updatedAt: now() });
        return { number, success: accepted, simulated: accepted, error: accepted ? '' : 'Preview validation failed; nothing sent' };
      }); return { results, sent: results.filter(result => result.success).length, failed: results.filter(result => !result.success).length, simulated: true, delivered: false, providerConnected: false }; });
    }
    if (route === '/api/sms/report' && method === 'GET') { const logs = P.filteredLogs(state, q); return ok({ logs, total: logs.length, totalSent: logs.filter(l => ['submitted', 'simulated'].includes(l.status)).length, totalDelivered: logs.filter(l => l.status === 'submitted').length, totalSimulated: logs.filter(l => l.status === 'simulated').length, totalFailed: logs.filter(l => l.status === 'failed').length }); }
    if (route === '/api/sms/quota-settings') {
      if (method === 'GET') return ok({ settings: state.quota });
      if (method === 'PUT') { requireValue(Number(body.totalContracted) >= 0 && Number.isInteger(Number(body.totalContracted)) && Number(body.renewalDay) >= 1 && Number(body.renewalDay) <= 28, 'Quota must be a nonnegative integer; renewal day must be 1–28.'); return write(s => ({ settings: s.quota = { totalContracted: Number(body.totalContracted), renewalDay: Number(body.renewalDay) } })); }
    }
    if (route === '/api/sms/status' && method === 'GET') {
      const end = new Date(), start = new Date(); start.setDate(Math.min(state.quota.renewalDay, 28)); start.setHours(0, 0, 0, 0); if (start > end) start.setMonth(start.getMonth() - 1); const next = new Date(start); next.setMonth(next.getMonth() + 1);
      const counted = state.logs.filter(l => l.status === 'submitted' && l.channel === 'sms'), simulated = state.logs.filter(l => l.status === 'simulated' && l.channel === 'sms'), used = counted.filter(l => new Date(l.createdAt) >= start && new Date(l.createdAt) < next).length, last = state.logs[0];
      return ok({ sentToday: counted.filter(l => l.createdAt.slice(0, 10) === now().slice(0, 10)).length, simulatedToday: simulated.filter(l => l.createdAt.slice(0, 10) === now().slice(0, 10)).length, usedThisCycle: used, remainingThisCycle: Math.max(0, state.quota.totalContracted - used), totalContracted: state.quota.totalContracted, cycle: { start: start.toISOString(), end: next.toISOString(), renewalDay: state.quota.renewalDay }, lastMessage: last ? { number: last.receiverMSISDN, text: last.smsText, unitName: last.unitName, status: last.status, sentAt: last.createdAt, sentBy: last.sentBy } : null });
    }
    if (route === '/api/wialon-reports/templates' && method === 'GET') return ok({ templates: state.scenario === 'empty' ? [] : state.templates });
    if (route === '/api/wialon-reports/units' && method === 'GET') return ok({ units });
    if (route === '/api/wialon-reports/run' && method === 'POST') return ok({ results: state.scenario === 'empty' ? [] : P.results(state, body) });
    if (route === '/api/maintenance/vehicles' && method === 'GET') return ok({ units });
    if (route === '/api/maintenance') {
      if (method === 'GET') return ok({ requests: state.scenario === 'empty' ? [] : scopedRequests(state).filter(r => (!q.status || r.status === q.status) && (!q.priority || r.priority === q.priority)) });
      if (method === 'POST') { requireValue(body.title?.trim() && body.description?.trim() && list(body.vehicleIds).length, 'Title, description and at least one vehicle are required.'); requireValue(['low', 'medium', 'high', 'critical', 'urgent'].includes(body.priority || 'medium'), 'Invalid priority.'); requireValue(list(body.vehicleIds).every(id => units.some(u => String(u.id) === id)), 'Select an available demo vehicle.'); return write(s => { const id = P.nextId(s, 'request'); const request = { _id: id, id, requestNumber: `MNT-DEMO-${s.sequence}`, customer: user.role === 'admin' ? 'demo-customer' : user._id, customerName: user.displayName, createdBy: user._id, createdByName: user.displayName, title: body.title.trim(), description: body.description.trim(), priority: body.priority || 'medium', status: 'pending', vehicles: units.filter(u => list(body.vehicleIds).includes(String(u.id))).map(u => ({ unitId: String(u.id), unitName: u.name })), messages: [], history: [], createdAt: now(), updatedAt: now() }; history(request, user, 'created', 'Local preview only; no email sent'); s.requests.unshift(request); return { request }; }); }
    }
    const maintenance = route.match(/^\/api\/maintenance\/([^/]+)(?:\/(reply|receive|assign|resolve|close))?$/);
    if (maintenance) {
      const [, id, action] = maintenance; find(scopedRequests(state), id);
      if (!action && method === 'GET') return ok({ request: find(state.requests, id) });
      if (!action && method === 'PATCH') { requireValue(body.title?.trim() && body.description?.trim(), 'Title and description are required.'); return write(s => { const request = find(s.requests, id); Object.assign(request, { title: body.title.trim(), description: body.description.trim(), priority: body.priority || request.priority }); history(request, user, 'edited', 'Preview-only edit'); return { request }; }); }
      if (action === 'reply' && method === 'POST') { requireValue(body.message?.trim(), 'Write a reply.'); return write(s => { const request = find(s.requests, id); request.messages.push({ sender: user._id, senderName: user.displayName, senderRole: user.role, message: body.message.trim(), createdAt: now() }); history(request, user, 'reply'); return { request }; }); }
      if (action && method === 'PATCH') return write(s => { const request = find(s.requests, id), transitions = { receive: ['pending', 'received'], assign: ['received', 'in_progress'], resolve: ['in_progress', 'resolved'], close: ['resolved', 'closed'] }; const transition = transitions[action]; requireValue(request.status === transition[0], `This action requires status ${transition[0]}.`); if (state.mode === 'permissions') requireValue(action === 'close' || user.role === 'admin', 'A demo admin must perform this action.'); if (action === 'assign') { const assigned = find(s.users, body.assignedTo); requireValue(assigned.role === 'admin', 'Assign to a demo admin.'); request.assignedTo = assigned._id; request.assignedToName = assigned.displayName; } if (action === 'resolve') { requireValue(body.resolution?.trim(), 'Enter a resolution.'); request.resolution = body.resolution; request.resolvedByName = user.displayName; request.resolvedAt = now(); } if (action === 'close') { request.closedByName = user.displayName; request.closedAt = now(); } request.status = transition[1]; history(request, user, action); return { request }; });
    }
    const reports = route.match(/^\/api\/(installations|maintenance-reports)(?:\/([^/]+))?$/);
    if (reports) {
      const [, type, id] = reports, key = type === 'installations' ? 'installations' : 'maintenanceReports', visible = state[key].filter(r => state.mode === 'explore' || user.role === 'admin' || r.company === user._id);
      if (id === 'companies' && method === 'GET') return ok({ companies: state.users.filter(u => u.role === 'customer' && (state.mode === 'explore' || user.role === 'admin' || u._id === user._id)).map(u => ({ ...u, name: u.displayName })) });
      if (id === 'units' && method === 'GET') { const company = state.users.find(u => u._id === q.companyId); return ok({ units: units.filter(u => !company || company.assignedUnitNames.includes(u.name)) }); }
      if (!id && method === 'GET') return ok({ reports: state.scenario === 'empty' ? [] : visible.filter(r => (!q.companyId || r.company === q.companyId) && (!q.dateFrom || (r.installationDate || r.maintenanceDate) >= q.dateFrom) && (!q.dateTo || (r.installationDate || r.maintenanceDate) <= q.dateTo)) });
      if (id && method === 'DELETE') { const report = find(visible, id); const files = report.items.flatMap(i => i.photos || []); if (report.signatureFile) files.push(report.signatureFile); for (const file of files) await P.deleteFile(file); return write(s => { s[key] = s[key].filter(r => r._id !== id); return {}; }); }
      if (!id && method === 'POST') {
        const data = body, items = typeof data.items === 'string' ? JSON.parse(data.items) : data.items; requireValue(data.companyId && data.employeeName?.trim() && data.jobTitle?.trim() && Array.isArray(items) && items.length, 'Complete all required report fields and vehicles.'); const dateField = key === 'installations' ? 'installationDate' : 'maintenanceDate'; requireValue(/^\d{4}-\d{2}-\d{2}$/.test(data[dateField] || ''), 'Select a valid report date.'); requireValue(items.every(item => item.unitName?.trim() && item.imei?.trim()), 'Each vehicle requires a name and device identifier.'); const company = find(state.users, data.companyId); requireValue(company.role === 'customer', 'Select a demo company.'); requireValue(state.mode === 'explore' || user.role === 'admin' || company._id === user._id, 'Demo company is not available.');
        const storedFiles = []; let signatureFile;
        try {
          for (let i = 0; i < items.length; i++) { items[i].photos = []; const photos = data[`photos_${i}`] || []; requireValue(photos.length <= 6, 'Maximum six local photos per vehicle.'); for (const file of photos) { requireValue(file instanceof Blob && /^image\/(png|jpeg|webp|gif)$/.test(file.type) && file.size <= 4 * 1024 * 1024, 'Use PNG/JPEG/WebP/GIF photos up to 4 MB.'); const fileId = `photo-${crypto.randomUUID()}`; await P.putFile(fileId, file); storedFiles.push(fileId); items[i].photos.push(fileId); } }
          if (data.signature) { requireValue(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.signature) && data.signature.length < 2000000, 'Invalid local signature.'); signatureFile = `signature-${crypto.randomUUID()}`; await P.putFile(signatureFile, data.signature); storedFiles.push(signatureFile); }
          return write(s => { const recordId = P.nextId(s, key), report = { _id: recordId, id: recordId, reportNumber: `${key === 'installations' ? 'INS' : 'MTR'}-DEMO-${s.sequence}`, company: company._id, companyName: company.displayName, [dateField]: data[dateField], items, employeeName: data.employeeName, jobTitle: data.jobTitle, signature: signatureFile ? 'Stored locally' : '', signatureFile, createdBy: user._id, createdByName: user.displayName, createdAt: now() }; s[key].unshift(report); return { report }; });
        } catch (error) { for (const id of storedFiles) await P.deleteFile(id); throw error; }
      }
    }
    if (route === '/api/admin/users') {
      if (method === 'GET') return ok({ users: state.users });
      if (method === 'POST') { requireValue(/^[\w.-]{2,50}$/.test(body.username || ''), 'Use a demo username with letters, digits, dots, underscores or hyphens.'); requireValue(!state.users.some(u => u.username === body.username), 'Demo username already exists.'); return write(s => { const id = P.nextId(s, 'user'), created = { _id: id, id, username: body.username, displayName: body.displayName || body.username, role: body.role === 'admin' ? 'admin' : 'customer', authMode: body.authMode === 'wialon' ? 'wialon' : 'local', permissions: Object.fromEntries(P.permissions.map(k => [k, Boolean(body.permissions?.[k])])), assignedUnitNames: list(body.assignedUnitNames), wialonAccounts: list(body.wialonAccounts), reportEmail: body.reportEmail || '', isActive: true, createdAt: now() }; s.users.push(created); return { user: created }; }); }
    }
    const admin = route.match(/^\/api\/admin\/users\/([^/]+)(\/import-wialon-units)?$/);
    if (admin) {
      const [, id, importing] = admin; find(state.users, id);
      if (importing && method === 'POST') { requireValue(body.wialonToken === 'PREVIEW_ONLY', 'Use PREVIEW_ONLY; never paste a real token.'); return write(s => { const target = find(s.users, id); target.assignedUnitNames = s.units.slice(0, 8).map(u => u.name); return { importedUnits: target.assignedUnitNames }; }); }
      if (!importing && method === 'PATCH') return write(s => { const target = find(s.users, id); for (const key of ['reportEmail', 'displayName', 'isActive', 'authMode']) if (body[key] !== undefined) target[key] = body[key]; if (body.assignedUnitNames !== undefined) target.assignedUnitNames = list(body.assignedUnitNames); if (body.permissions) for (const key of P.permissions) if (key in body.permissions) target.permissions[key] = Boolean(body.permissions[key]); return { user: target }; });
      if (!importing && method === 'DELETE') { requireValue(id !== state.activeUser && state.users.filter(u => u.role === 'admin').length > (find(state.users, id).role === 'admin' ? 1 : 0), 'Keep the active persona and at least one demo admin.'); return write(s => { s.users = s.users.filter(u => u._id !== id); return {}; }); }
    }
    if (/^\/api\/reports\/send-email\/[^/]+$/.test(route) && method === 'POST') return write(s => { const recipient = find(s.users, route.split('/').pop()); s.notifications.unshift({ id: P.nextId(s, 'notification'), to: recipient.reportEmail, type: 'email-simulation', createdAt: now() }); return { sentTo: `${recipient.reportEmail || 'demo inbox'} (SIMULATED — no email sent)` }; });
    const error = new Error(`Blocked: no local handler for ${method} ${route}`); error.status = 404; throw error;
  };
  P.filteredLogs = (state, q) => state.scenario === 'empty' ? [] : state.logs.filter(l => (!q.channel || l.channel === q.channel) && (!q.source || l.source === q.source) && (!q.date || l.createdAt.startsWith(q.date)) && (q.date || !q.month || l.createdAt.startsWith(q.month)));
})();
