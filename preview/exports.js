// EDIT BY NADA — accurate local formats, escaped HTML, and spreadsheet formula neutralization.
(() => {
  const P = globalThis.ObserverPreview;
  P.csv = rows => '\ufeff' + rows.map(row => row.map(value => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; }).join(',')).join('\r\n');
  P.report = async path => {
    const url = new URL(path, 'http://preview.invalid');
    if (url.origin !== 'http://preview.invalid') throw new Error('External report destinations are blocked.');
    const route = url.pathname, q = Object.fromEntries(url.searchParams), state = P.read(), user = P.user(state);
    if (route.startsWith('/api/wialon-reports/') && user.authMode !== 'local') throw new Error('Wialon Reports is available to local accounts only.');
    if (state.mode === 'permissions' && user.role !== 'admin') { const permission = route.includes('/sms/') ? 'reports' : route.includes('/wialon-reports/') ? 'wialonReports' : route.includes('/maintenance-reports/') ? 'maintenanceReports' : route.includes('/installations/') ? 'installations' : 'units'; if (!user.permissions[permission]) throw new Error('Demo report permission denied.'); }
    let title = q.filter === 'offline' ? 'Offline Units · More Than 12 Hours · Demo' : 'Fleet report · Demo', subtitle = '', rows = [], images = [], sensor = null;
    // EDIT BY NADA — empty-result scenario is consistent between screens and exports.
    let units = state.scenario === 'empty' ? [] : P.scopedUnits(state);
    const offlineHours = u => {
      const lastMessage = Date.parse(u.lastMessageTime || '');
      return Number.isFinite(lastMessage) ? Math.max(0, (Date.now() - lastMessage) / 3600000) : null;
    };
    if (q.filter === 'offline') units = units.filter(u => u.isOffline && offlineHours(u) > 12);
    if (['battery0', 'battery', 'battery-down', 'battery-zero', 'battery-low'].includes(q.filter)) {
      const mode = q.filter === 'battery-zero' ? 'zero' : q.filter === 'battery-low' ? 'low' : q.battery === '0v' ? 'zero' : ['down', 'low', 'zero'].includes(q.battery) ? q.battery : 'down';
      units = units.filter(unit => ObserverBattery.matches(unit, mode));
      title = 'Battery Report'; subtitle = mode === 'zero' ? 'Zero-voltage readings only' : mode === 'low' ? 'Battery readings above 0 V and below 8000 V' : 'Battery Down · 0 V or below 8000 V';
    }
    if (route.startsWith('/api/reports/') && !route.includes('sensors')) {
      if (q.connection === 'online') units = units.filter(unit => !unit.isOffline);
      if (q.connection === 'offline') units = units.filter(unit => unit.isOffline);
      if (!['battery0', 'battery', 'battery-down', 'battery-zero', 'battery-low'].includes(q.filter) && ['0v', 'down', 'low', 'zero'].includes(q.battery)) units = units.filter(unit => ObserverBattery.matches(unit, q.battery));
      if (q.search) { const term = q.search.trim().toLowerCase(); units = units.filter(unit => [unit.name, unit.accountGroup, unit.location, unit.lastMessageTime, unit.isOffline ? 'offline' : 'online'].join(' ').toLowerCase().includes(term)); }
      if (['name-asc', 'name-desc', 'battery-asc', 'battery-desc'].includes(q.sort)) {
        const direction = q.sort.endsWith('desc') ? -1 : 1;
        units.sort((left, right) => direction * (q.sort.startsWith('battery') ? (Number.parseFloat(left.batteryVolts) || 0) - (Number.parseFloat(right.batteryVolts) || 0) : String(left.name).localeCompare(String(right.name))));
      }
    }
    if (/^\/api\/reports\/(view|export|view-sensors|export-sensors|export-unit\/\d+)$/.test(route)) {
      const id = route.match(/export-unit\/(\d+)$/)?.[1]; if (id) units = units.filter(u => String(u.id) === id);
      if (route.includes('sensors')) {
        const S = globalThis.ObserverSensorReport, available = units, selected = S.selection(url), value = input => input === null || input === undefined || input === '' ? '—' : input;
        units = S.filter(available, selected); title = 'Sensor Report'; subtitle = 'Show all sensor values across all units';
        sensor = { options: S.options(available), selected, total: units.length, available: available.length };
        rows = [[
          // EDIT BY NADA — identify the recorded telephone field as Mobile Number in Sensor Report.
          'ID', 'Account', 'Unit Name', 'Device IMEI', 'Mobile Number', 'Device Type',
          'Internal Battery', 'Battery (V)', 'Mileage', 'Total Fuel', 'Fuel (L)', 'Fuel %', 'Tank Capacity'
        ], ...units.map((unit, index) => { const data = S.metadata(unit); return [
          index + 1, value(data.account), value(unit.name), value(data.imei), value(data.sim), value(data.deviceType),
          value(unit.deviceBatteryVolts), value(unit.batteryVolts), value(unit.mileageSensor), value(unit.totalFuel), value(unit.totalFuel),
          unit.fuelPercentage === null || unit.fuelPercentage === undefined ? '—' : `${unit.fuelPercentage}%`, value(unit.tankCapacity)
        ]; })];
      }
      else if (q.view === 'group') { rows = [['Account', 'Total', 'Online', 'Offline'], ...[...new Set(units.map(u => u.accountGroup))].map(group => { const subset = units.filter(u => u.accountGroup === group); return [group, subset.length, subset.filter(u => !u.isOffline).length, subset.filter(u => u.isOffline).length]; })]; }
      else {
        const value = v => v === null || v === undefined || v === '' ? '—' : v;
        rows = [[
          // EDIT BY NADA — label the recorded unit phone field as Mobile Number in Fleet reports.
          'ID', 'Unit Name', 'IMEI', 'Mobile Number', 'Account', 'Status', 'Offline duration (hours)',
          'Battery (V)', 'Internal Battery', 'Mileage', 'Total Fuel',
          'Fuel (L)', 'Fuel %', 'Fuel Detection', 'Tank Capacity'
        ], ...units.map((u, index) => [
          index + 1, value(u.name), value(u.imei || u.serialNumber), value(u.mobileNumber), value(u.accountGroup), value(u.status),
          u.isOffline && offlineHours(u) !== null ? `${offlineHours(u).toFixed(1)} h` : '—',
          value(u.batteryVolts), value(u.deviceBatteryVolts),
          value(u.mileageSensor), value(u.totalFuel), value(u.totalFuel),
          u.fuelPercentage === null || u.fuelPercentage === undefined ? '—' : `${u.fuelPercentage}%`,
          u.fuelDetection === null || u.fuelDetection === undefined ? '—' : u.fuelDetection ? 'Detected' : 'Not detected',
          value(u.tankCapacity)
        ])];
      }
    } else if (route === '/api/sms/report/export') { title = 'Messaging report · Demo'; rows = [['Recipient', 'Message', 'Channel', 'Source', 'Status', 'Created'], ...P.filteredLogs(state, q).map(l => [l.receiverMSISDN, l.smsText, l.channel, l.source, l.status, l.createdAt])]; }
    else if (route === '/api/wialon-reports/export') { title = 'Wialon sample report · Demo'; const results = P.results(state, { ...q, unitIds: url.searchParams.getAll('unitIds') }); rows = results.length ? [results[0].tables[0].headers, ...results.flatMap(r => r.tables[0].rows)] : [['No sample results']]; }
    else {
      const match = route.match(/^\/api\/(installations|maintenance-reports)\/([^/]+)\/pdf$/);
      if (!match) throw new Error('No local exporter for this path.');
      const report = state[match[1] === 'installations' ? 'installations' : 'maintenanceReports'].find(r => r._id === match[2]);
      if (!report || (state.mode === 'permissions' && user.role !== 'admin' && report.company !== user._id)) throw new Error('Demo report not found.');
      title = `${report.reportNumber} · ${report.companyName}`;
      subtitle = match[1] === 'installations' ? 'Installation report' : 'Maintenance report';
      rows = [['Vehicle', 'New IMEI', 'Serial', 'SIM', 'Old IMEI', 'Notes'], ...report.items.map(i => [i.unitName, i.imei, i.serialNumber, i.simNumber, i.oldImei || '', i.notes])];
      for (const id of report.items.flatMap(i => i.photos || [])) { const file = await P.getFile(id); if (file instanceof Blob) images.push({ url: URL.createObjectURL(file), label: 'Local demo attachment' }); }
      if (report.signatureFile) { const signature = await P.getFile(report.signatureFile); if (typeof signature === 'string') images.push({ url: signature, label: 'Local demo signature' }); }
    }
    const report = { title, subtitle, rows, images, ...(sensor ? { sensor } : { fleet: route.startsWith('/api/reports/') }), requestedFormat: q.format || (route.endsWith('/pdf') ? 'pdf' : 'view'), lang: q.lang === 'ar' ? 'ar' : 'en' };
    return ObserverReportLanguage.report(report, report.lang);
  };
  P.download = (name, text, type) => { const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  // Render with the browser's Arabic shaping and local Cairo font, then embed each
  // page as a JPEG in the PDF. This preserves Arabic glyphs and RTL table order.
  P.pdf = async report => {
    await document.fonts.load('600 20px Cairo'); await document.fonts.ready;
    const rtl = report.lang === 'ar', headers = report.rows[0] || ['—'], landscape = headers.length > 8;
    const width = landscape ? 1754 : 1240, height = landscape ? 1240 : 1754, margin = 50, bottom = height - 75, lineHeight = landscape ? 24 : 28;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'), fontSize = landscape ? 16 : 19, pages = [];
    const weights = headers.map(header => /الحساب|ملاحظات|الرسالة|Account|Notes|Message|IMEI|Serial|التسلسلي/i.test(header) ? 1.65 : 1);
    const totalWeight = weights.reduce((sum, n) => sum + n, 0), widths = weights.map(n => (width - margin * 2) * n / totalWeight);
    let y = 0, pageNumber = 0;
    const font = bold => { ctx.font = `${bold ? 750 : 600} ${fontSize}px Cairo`; ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left'; ctx.textBaseline = 'top'; };
    const wrap = (value, maxWidth) => {
      const output = []; for (const paragraph of String(value ?? '—').split(/\r?\n/)) {
        let line = ''; for (const word of paragraph.split(/(\s+)/)) {
          if (ctx.measureText(line + word).width <= maxWidth) { line += word; continue; }
          if (line.trim()) output.push(line.trim()); line = '';
          for (const character of word) { if (ctx.measureText(line + character).width > maxWidth && line) { output.push(line); line = ''; } line += character; }
        } output.push(line.trim());
      } return output.length ? output : ['—'];
    };
    const rowLines = (row, bold) => { font(bold); return headers.map((_, index) => wrap(row[index] ?? '—', widths[index] - 20)); };
    const drawRow = (lines, bold, offset = 0, count = Math.max(...lines.map(cell => cell.length))) => {
      const rowHeight = count * lineHeight + 18; let x = rtl ? width - margin : margin; font(bold);
      lines.forEach((cell, index) => {
        const left = rtl ? x - widths[index] : x; ctx.fillStyle = bold ? '#e4eed9' : '#fbfdf7'; ctx.fillRect(left, y, widths[index], rowHeight);
        ctx.strokeStyle = '#b8cba6'; ctx.strokeRect(left, y, widths[index], rowHeight); ctx.fillStyle = '#294c37';
        cell.slice(offset, offset + count).forEach((line, n) => ctx.fillText(line, rtl ? left + widths[index] - 10 : left + 10, y + 9 + n * lineHeight));
        x += rtl ? -widths[index] : widths[index];
      }); y += rowHeight;
    };
    const finishPage = () => { pages.push(Uint8Array.from(atob(canvas.toDataURL('image/jpeg', .94).split(',')[1]), character => character.charCodeAt(0))); };
    const newPage = () => {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); pageNumber++;
      ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#577c48'; ctx.font = '800 24px Cairo';
      ctx.fillText('OBSERVER', rtl ? width - margin : margin, 35);
      ctx.font = '750 29px Cairo'; ctx.fillStyle = '#294c37'; y = 82;
      for (const line of wrap(report.title, width - margin * 2)) { ctx.fillText(line, rtl ? width - margin : margin, y); y += 42; }
      if (report.subtitle) { ctx.font = '600 20px Cairo'; ctx.fillText(report.subtitle, rtl ? width - margin : margin, y); y += 35; }
      y += 16; ctx.font = '600 16px Cairo'; ctx.fillText(`${rtl ? 'صفحة' : 'Page'} ${pageNumber}`, rtl ? width - margin : margin, height - 45);
      drawRow(rowLines(headers, true), true);
    };
    newPage();
    for (const row of report.rows.slice(1)) {
      const lines = rowLines(row, false), lineCount = Math.max(...lines.map(cell => cell.length)); let offset = 0;
      while (offset < lineCount) {
        let fit = Math.floor((bottom - y - 18) / lineHeight);
        if (fit < 1) { finishPage(); newPage(); fit = Math.floor((bottom - y - 18) / lineHeight); }
        const count = Math.min(lineCount - offset, Math.max(1, fit)); drawRow(lines, false, offset, count); offset += count;
      }
    }
    for (const image of report.images || []) {
      const img = await new Promise((resolve, reject) => { const node = new Image(); node.onload = () => resolve(node); node.onerror = reject; node.src = image.url; });
      const ratio = Math.min((width - 2 * margin) / img.width, 480 / img.height, 1), imageHeight = img.height * ratio;
      if (y + imageHeight + 55 > bottom) { finishPage(); newPage(); }
      y += 20; font(false); ctx.fillStyle = '#294c37'; ctx.fillText(image.label || '', rtl ? width - margin : margin, y); y += 30;
      ctx.drawImage(img, rtl ? width - margin - img.width * ratio : margin, y, img.width * ratio, imageHeight); y += imageHeight;
    }
    finishPage();
    const encode = text => new TextEncoder().encode(text), objects = [null, encode('<< /Type /Catalog /Pages 2 0 R >>'), null];
    const join = parts => { const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let index = 0; for (const part of parts) { output.set(part, index); index += part.length; } return output; };
    const pageIds = [];
    pages.forEach((jpeg, index) => {
      const pageId = 3 + index * 3, contentId = pageId + 1, imageId = pageId + 2, pageWidth = landscape ? 842 : 595, pageHeight = landscape ? 595 : 842;
      const stream = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /PageImage Do Q`;
      pageIds.push(pageId);
      objects[pageId] = encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /PageImage ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      objects[contentId] = encode(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      objects[imageId] = join([encode(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, encode('\nendstream')]);
    });
    objects[2] = encode(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    const parts = [encode('%PDF-1.4\n% Observer report\n')], offsets = [0]; let size = parts[0].length;
    for (let id = 1; id < objects.length; id++) { offsets[id] = size; const entry = join([encode(`${id} 0 obj\n`), objects[id], encode('\nendobj\n')]); parts.push(entry); size += entry.length; }
    parts.push(encode(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`));
    return join(parts);
  };
  P.word = async report => {
    const images = []; for (const image of report.images || []) { try { if (image.url.startsWith('data:')) images.push(image.url); else { const blob = await fetch(image.url).then(response => response.blob()); images.push(await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); })); } } catch { /* Keep the document downloadable if an optional image cannot be embedded. */ } }
    const direction = report.lang === 'ar' ? 'rtl' : 'ltr';
    return `<!doctype html><html lang="${report.lang === 'ar' ? 'ar' : 'en'}" dir="${direction}"><head><meta charset="utf-8"><title>${P.html(report.title)}</title><style>@page{size:A4 landscape;margin:18mm}body{font-family:Cairo,Arial,sans-serif;color:#294c37}h1{font-size:24px}table{width:100%;border-collapse:collapse;font-size:10pt}th,td{border:1px solid #b9cda8;padding:7px;text-align:${direction === 'rtl' ? 'right' : 'left'}}th{background:#e5efda}tr:nth-child(even){background:#f6f9f0}img{display:block;max-width:520px;max-height:260px;margin:18px 0;border:1px solid #c7d9b6}</style></head><body><h1>${P.html(report.title)}</h1>${report.subtitle ? `<p>${P.html(report.subtitle)}</p>` : ''}<table><thead><tr>${report.rows[0].map(cell => `<th>${P.html(cell)}</th>`).join('')}</tr></thead><tbody>${report.rows.slice(1).map(row => `<tr>${row.map(cell => `<td>${P.html(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>${images.map((url, index) => `<img src="${url}" alt="${report.lang === 'ar' ? 'مرفق التقرير' : 'Report attachment'} ${index + 1}">`).join('')}</body></html>`;
  };
  P.reportHtml = report => `<header class="report-summary"><h1>${P.html(report.title)}</h1>${report.subtitle ? `<p>${P.html(report.subtitle)}</p>` : ''}</header><div class="report-table-scroll" role="region" aria-label="${report.lang === 'ar' ? 'بيانات التقرير' : 'Report values'}" tabindex="0"><table><thead><tr>${report.rows[0].map(c => `<th scope="col">${P.html(c)}</th>`).join('')}</tr></thead><tbody>${report.rows.length === 1 && report.sensor ? `<tr><td colspan="${report.rows[0].length}" class="sensor-report-empty">${report.lang === 'ar' ? 'لا توجد وحدات مطابقة للفلاتر المحددة' : 'No units match the selected filters.'}</td></tr>` : report.rows.slice(1).map(row => `<tr>${row.map(c => `<td>${P.html(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${report.images.map(i => `<figure><img src="${P.html(i.url)}" alt="${P.html(i.label)}"><figcaption>${P.html(i.label)}</figcaption></figure>`).join('')}</div>`;
})();
