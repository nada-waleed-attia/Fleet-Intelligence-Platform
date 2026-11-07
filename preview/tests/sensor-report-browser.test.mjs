// EDIT BY NADA — Sensor Report UI regression tests use an isolated local server and browser profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewServer } from '../serve.mjs';
import { browser, until } from './browser.mjs';

test('Sensor Report navigation, captured fields, independent multi-filters and exports', { timeout: 90000 }, async () => {
  const port = 4186, server = createPreviewServer(port);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let b;
  try {
    b = await browser(`http://observer-preview.localhost:${port}`);
    const frame = code => b.evaluate(code, true), shell = code => b.evaluate(code);
    const settled = async expectedRows => until(async () => await shell(`!document.getElementById('report-content').hasAttribute('aria-busy') && document.querySelectorAll('#report-content tbody tr:not(:has(.sensor-report-empty))').length === ${expectedRows}`), 'sensor results update');
    const toggle = async (category, value) => shell(`(()=>{const input=[...document.querySelectorAll('#report-content [data-sensor-filter="${category}"]')].find(input=>input.value===${JSON.stringify(value)});const menu=input.closest('details');if(!menu.open)menu.querySelector('summary').click();input.focus();input.click()})()`);
    const clear = async category => shell(`(()=>{const input=document.querySelector('#report-content [data-sensor-filter="${category}"]');input.closest('details').querySelector('.sensor-filter-bulk button:last-child').click()})()`);
    const checked = category => shell(`[...document.querySelectorAll('#report-content [data-sensor-filter="${category}"]:checked')].map(input=>input.value)`);
    const rows = () => shell("[...document.querySelectorAll('#report-content tbody tr:not(:has(.sensor-report-empty))')].map(row=>[...row.cells].map(cell=>cell.textContent))");

    // EDIT BY NADA — the overview card has no duplicate filters and opens only the sensor route.
    await b.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, [...b.sessions][0]);
    await b.navigate('observer-reports.html');
    assert.equal(await frame("document.querySelectorAll('.card.featured .sensor-report-filters').length"), 0);
    assert.equal(await frame("document.querySelectorAll('.card.featured .sensor-tag').length"), 0);
    await frame("document.querySelector('.btn-sensor-view').click()");
    await until(async () => await shell("!document.getElementById('report-panel').hidden"), 'correct report opens');
    assert.equal(await shell("document.querySelector('#report-content h1').textContent"), 'Sensor Report');
    assert.equal(await shell('document.title'), 'Sensor Report');
    assert.ok(b.requests.some(url => url.includes('/pages/observer-reports.html')));
    assert.ok(await shell("[...document.querySelectorAll('#report-content th')].some(cell=>cell.textContent==='Device Type')"));
    assert.equal(await shell("[...document.querySelectorAll('#report-content th')].some(cell=>cell.textContent==='Wialon ID')"), false);

    // EDIT BY NADA — the stock preview has no captured types; show a fallback, not fake device options.
    assert.equal(await shell("document.querySelectorAll('#report-content [data-sensor-filter=deviceTypes]').length"), 0);
    assert.ok((await rows()).every(row => row[5] === '\u2014'));
    const expectedAccounts = await shell("[...new Set(ObserverPreview.scopedUnits(ObserverPreview.read()).map(unit=>unit.accountGroup).filter(Boolean))].sort()");
    assert.deepEqual((await shell("[...document.querySelectorAll('#report-content [data-sensor-filter=accounts]')].map(input=>input.value)")).sort(), expectedAccounts);
    await shell("document.getElementById('report-back').click()");
    assert.notEqual(await shell('document.title'), 'Sensor Report');

    // EDIT BY NADA — both overview export buttons show Sensor Report without downloading or prompting first.
    await shell('globalThis.__sensorCardDownloads=0;ObserverPreview.download=()=>{__sensorCardDownloads++;}');
    for (const action of ['excel', 'pdf']) {
      await frame(`document.querySelector('.featured-actions .btn-${action}').click()`);
      await until(() => shell('!document.getElementById("report-panel").hidden'), `Sensor ${action} opens viewer`);
      assert.equal(await shell('document.querySelector("#report-content h1").textContent'), 'Sensor Report');
      assert.equal(await shell('document.querySelectorAll("#report-content tbody tr").length'), 24);
      assert.ok(await shell('!!document.querySelector("#report-content .sensor-report-filters")'));
      assert.equal(await shell('__sensorCardDownloads'), 0);
      assert.equal(await shell('document.getElementById("units-export-dialog").open'), false);
      await shell('document.getElementById("report-back").click()');
    }

    // EDIT BY NADA — explicit test-only fixtures stay in this disposable browser profile.
    // No device models or account names are added to application fixtures, APIs, or integration code.
    await shell(`ObserverPreview.mutate(state=>{state.units=state.units.slice(0,6).map((unit,index)=>({...unit,
      name:'Test unit '+(index+1),deviceType:['Test device A',' Test device B ','Test device A','Test device B',null,'Unknown HW (999)'][index],
      accountGroup:['Test account X','Test account X','Test account Y',' Test account Y ','Test account Y','Test account Z'][index],
      serialNumber:'TEST-IMEI-'+(index+1)}))})`);
    await frame("document.querySelector('.btn-sensor-view').click()"); await settled(6);
    assert.deepEqual(await shell("[...document.querySelectorAll('#report-content [data-sensor-filter=deviceTypes]')].map(input=>input.value)"), ['Test device A', 'Test device B']);
    assert.deepEqual(await shell("[...document.querySelectorAll('#report-content [data-sensor-filter=accounts]')].map(input=>input.value)"), ['Test account X', 'Test account Y', 'Test account Z']);
    assert.equal((await rows()).find(row => row[2] === 'Test unit 6')[5], '\u2014');
    assert.equal((await rows()).find(row => row[2] === 'Test unit 3')[3], 'TEST-IMEI-3');

    // EDIT BY NADA — each category uses OR, the categories combine with AND, and menus keep focus.
    await toggle('deviceTypes', 'Test device A'); await settled(2);
    assert.ok(await shell("document.querySelector('#report-content .sensor-filter-menu[open]').contains(document.activeElement)"));
    await toggle('deviceTypes', 'Test device B'); await settled(4);
    await toggle('accounts', 'Test account X'); await settled(2);
    await toggle('accounts', 'Test account Y'); await settled(4);
    await toggle('deviceTypes', 'Test device B'); await settled(2);
    assert.ok((await rows()).every(row => row[5] === 'Test device A'));
    await clear('deviceTypes'); await settled(5);
    assert.deepEqual(await checked('accounts'), ['Test account X', 'Test account Y']);
    await toggle('deviceTypes', 'Test device A'); await settled(2);
    await clear('accounts'); await settled(2);
    assert.deepEqual(await checked('deviceTypes'), ['Test device A']);
    await toggle('accounts', 'Test account Y'); await settled(1);
    assert.ok(await shell("document.querySelector('.sensor-filter-count').textContent.startsWith('1 units')"));

    // EDIT BY NADA — remaining CSV and print/PDF output use the active filtered rows; JSON is hidden.
    await shell("window.__sensorDownloads=[];ObserverPreview.download=(name,data,type)=>__sensorDownloads.push({name,text:typeof data==='string'?data:'',type});window.__sensorPrinted=[];window.print=()=>{__sensorPrinted=[...document.querySelectorAll('#report-content tbody tr')].map(row=>row.textContent)}");
    await shell("document.getElementById('report-csv').click()"); await until(async () => await shell('__sensorDownloads.length===1'), 'filtered CSV export');
    const csv = await shell('__sensorDownloads[0].text'); assert.equal(csv.split('\r\n').length, 2); assert.ok(csv.includes('Test unit 3')); assert.ok(!csv.includes('Test unit 1'));
    // EDIT BY NADA — Sensor Report no longer offers the JSON download button.
    assert.equal(await shell("getComputedStyle(document.getElementById('report-json')).display"), 'none');
    await shell("document.getElementById('report-print').click()"); await until(async () => await shell('__sensorPrinted.length===1'), 'filtered print');
    const pdf = await b.call('Page.printToPDF', { landscape: true, printBackground: true }, [...b.sessions][0]); assert.ok(Buffer.from(pdf.data, 'base64').subarray(0, 8).toString().startsWith('%PDF-'));

    // EDIT BY NADA — empty intersections, rapid changes and resetting retain a coherent result set.
    await clear('accounts'); await settled(2); await toggle('accounts', 'Test account Z'); await settled(0);
    assert.ok(await shell("document.querySelector('.sensor-report-empty').textContent.includes('No units match')"));
    await clear('accounts'); await settled(2);
    await shell("(()=>{const values=[...document.querySelectorAll('#report-content [data-sensor-filter=accounts]')];values.find(input=>input.value==='Test account X').click();values.find(input=>input.value==='Test account Y').click()})()"); await settled(2);
    assert.deepEqual(await checked('accounts'), ['Test account X', 'Test account Y']);
    await shell("document.querySelector('.sensor-filter-footer button').click()"); await settled(6);
    assert.deepEqual(await checked('deviceTypes'), []); assert.deepEqual(await checked('accounts'), []);
    const accounts = (await rows()).map(row => row[1]); assert.deepEqual(accounts, [...accounts].sort());

    // EDIT BY NADA — preserve language controls and the existing layout at phone widths.
    await shell("document.querySelector('[data-report-lang=ar]').click()"); assert.equal(await shell('document.title'), 'Sensor Report');
    assert.equal(await shell("document.getElementById('report-content').dir"), 'rtl');
    await b.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, [...b.sessions][0]);
    const mobile = await shell("({width:innerWidth,content:document.documentElement.scrollWidth,filters:document.querySelector('.sensor-report-filters').getBoundingClientRect().toJSON()})");
    assert.ok(mobile.content <= mobile.width); assert.ok(mobile.filters.left >= 0 && mobile.filters.right <= mobile.width);
    assert.deepEqual(b.exceptions, []); assert.deepEqual(b.external, []);
  } finally { if (b) await b.close(); await new Promise(resolve => server.close(resolve)); }
});
