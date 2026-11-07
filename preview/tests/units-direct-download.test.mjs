// EDIT BY NADA — verify Units-only language selection, direct files, cancellation and active export filters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewServer } from '../serve.mjs';
import { browser, until } from './browser.mjs';

test('Units removes zero-only choice and downloads translated filtered reports without a viewer', async () => {
    const port = 4191, server = createPreviewServer(port);
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    const b = await browser(`http://observer-preview.localhost:${port}`);
    const frame = expression => b.evaluate(expression, true);
    const shell = expression => b.evaluate(expression);
    const open = async format => {
        await frame('document.querySelector(".units-export-actions .' + (format === 'pdf' ? 'pdf-btn' : 'excel-btn') + '").click()');
        await until(() => shell('document.getElementById("units-export-dialog").open'), 'language dialog');
        assert.equal(await shell('document.getElementById("report-panel").hidden'), true);
    };
    const choose = async lang => {
        await shell('document.querySelector("#units-export-dialog input[value=' + lang + ']").click();document.getElementById("units-export-download").click()');
        await until(async () => !(await shell('document.getElementById("units-export-dialog").open')), 'language dialog closes');
    };
    try {
        await b.navigate('units.html', '?filter=battery0');
        await until(async () => await frame('document.querySelectorAll("#tbody tr").length') === 24, 'fleet directory');
        assert.equal(await frame('document.getElementById("f-batt").value'), 'all');
        const options = await frame('[...document.getElementById("f-batt").options].map(option=>({value:option.value,label:option.textContent.trim()}))');
        assert.ok(!options.some(option => option.value === '0v' || option.label.includes('Battery =')));
        assert.ok(options.some(option => option.value === 'down'));
        assert.ok(!(await frame('document.querySelector("#f-batt").closest(".units-select-wrap").textContent')).includes('Battery ='));
        // EDIT BY NADA — inspect actual generated output at the shared download boundary; write no test files to Downloads.
        await shell(`globalThis.unitsDownloads=[];globalThis.unitsReportCalls=[];
            const report=ObserverPreview.report;
            ObserverPreview.report=async path=>{unitsReportCalls.push(path);return report(path);};
            ObserverPreview.download=(name,body,type)=>unitsDownloads.push({name,type,text:typeof body==='string'?body:null,magic:body instanceof Uint8Array?Array.from(body.slice(0,5)):null,size:body.length});`);
        await frame('document.getElementById("f-search").value="DT-";document.getElementById("f-status").value="offline";document.getElementById("units-sort").value="name-desc";document.getElementById("units-sort").dispatchEvent(new Event("change"));render()');
        const expected = await frame('[...document.querySelectorAll("#tbody tr")].filter(row=>!row.hidden&&row.cells.length===9).map(row=>row.cells[2].textContent.trim())');
        assert.deepEqual(expected, ['DT-016', 'DT-013', 'DT-010']);
        const originalUrl = await shell('location.href');
        await open('xlsx');
        assert.equal(await shell('unitsDownloads.length'), 0);
        assert.equal(await shell('unitsReportCalls.length'), 0, 'no report generated before language choice');
        await choose('ar'); await until(async () => await shell('unitsDownloads.length') === 1, 'Arabic CSV downloaded');
        const csv = await shell('unitsDownloads[0]');
        assert.match(csv.name, /-ar\.csv$/); assert.match(csv.type, /^text\/csv/); assert.match(csv.text, /اسم الوحدة/);
        assert.equal(csv.text.trim().split('\r\n').length, 4);
        const exportedNames = csv.text.trim().split('\r\n').slice(1).map(row => row.split(',')[1].replaceAll('"', ''));
        assert.deepEqual(exportedNames, expected);
        const params = new URL('http://test.invalid' + await shell('unitsReportCalls[0]')).searchParams;
        assert.equal(params.get('lang'), 'ar'); assert.equal(params.get('connection'), 'offline');
        assert.equal(params.get('search'), 'DT-'); assert.equal(params.get('sort'), 'name-desc');
        assert.equal(await shell('location.href'), originalUrl);
        assert.equal(await shell('document.getElementById("report-panel").hidden'), true);
        await open('xlsx'); await shell('document.querySelector("#units-export-dialog button[value=cancel]").click()');
        await until(async () => !(await shell('document.getElementById("units-export-dialog").open')), 'cancel closes dialog');
        assert.equal(await shell('unitsDownloads.length'), 1); assert.equal(await shell('unitsReportCalls.length'), 1);
        await open('pdf'); await choose('en'); await until(async () => await shell('unitsDownloads.length') === 2, 'English PDF downloaded');
        const pdf = await shell('unitsDownloads[1]');
        assert.match(pdf.name, /-en\.pdf$/); assert.equal(pdf.type, 'application/pdf');
        assert.deepEqual(pdf.magic, [37,80,68,70,45]); assert.ok(pdf.size > 1000);
        assert.equal(await shell('document.getElementById("report-panel").hidden'), true);
        assert.equal(await shell('location.href'), originalUrl);
        assert.equal(await frame('document.getElementById("f-search").value'), 'DT-');
        // EDIT BY NADA — narrow-screen language choice remains within the viewport and Escape cancels it.
        await b.call('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:false }, [...b.sessions][0]);
        await open('xlsx'); assert.ok(await shell('document.getElementById("units-export-dialog").getBoundingClientRect().width<=innerWidth'));
        await b.call('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 }, [...b.sessions][0]);
        await b.call('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 }, [...b.sessions][0]);
        await until(async () => !(await shell('document.getElementById("units-export-dialog").open')), 'Escape cancels');
        assert.equal(await shell('unitsDownloads.length'), 2);
        assert.deepEqual(b.exceptions, []); assert.deepEqual(b.external, []);
    } finally { await b.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

// EDIT BY NADA — Observer Reports cards must show their filtered report before any explicit export.
test('Observer Reports fleet cards open a viewer and download only from inside it', async () => {
    const port = 4191, server = createPreviewServer(port);
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    const b = await browser(`http://observer-preview.localhost:${port}`);
    const frame = expression => b.evaluate(expression, true), shell = expression => b.evaluate(expression);
    try {
        await b.navigate('observer-reports.html');
        await shell(`globalThis.cardDownloads=[];globalThis.cardReportPaths=[];globalThis.cardPrints=0;
            const report=ObserverPreview.report;
            ObserverPreview.report=async path=>{cardReportPaths.push(path);return report(path);};
            ObserverPreview.download=(name,body,type)=>cardDownloads.push({name,body,type});
            window.print=()=>{cardPrints++;};`);
        const originalUrl = await shell('location.href');
        for (const [card, filter] of [['all', 'all'], ['battery0', 'battery'], ['offline', 'offline']]) {
            for (const action of ['excel', 'pdf']) {
                await frame(`document.querySelector('[data-report="${card}"] .btn-${action}').click()`);
                await until(() => shell('!document.getElementById("report-panel").hidden'), `${card} ${action} viewer`);
                assert.equal(await shell('cardDownloads.length'), 0, 'card does not download before viewing');
                assert.equal(await shell('document.getElementById("units-export-dialog").open'), false);
                const path = new URL('http://test.invalid' + await shell('cardReportPaths.at(-1)'));
                assert.equal(path.pathname, '/api/reports/view');
                assert.equal(path.searchParams.get('filter'), filter);
                assert.equal(path.searchParams.get('view'), 'unit');
                assert.equal(path.searchParams.has('download'), false);
                assert.equal(path.searchParams.has('format'), false);
                assert.equal(await shell('document.querySelector("#report-content th:nth-child(2)").textContent'), 'Unit Name');
                const rows = await shell('[...document.querySelectorAll("#report-content tbody tr")].map(row=>[...row.cells].map(cell=>cell.textContent))');
                assert.ok(rows.length > 0);
                if (card === 'battery0') assert.ok(rows.every(row => Number(row[7]) >= 0 && Number(row[7]) < 8000));
                if (card === 'offline') assert.ok(rows.every(row => row[5] === 'Offline' && parseFloat(row[6]) > 12));
                assert.equal(await shell('location.href'), originalUrl);
                await shell('document.getElementById("report-back").click()');
            }
        }
        // EDIT BY NADA — zero/low reading choices and Unit/Group mode survive the view-first action.
        for (const range of ['zero', 'low']) {
            await frame(`document.getElementById('observer-battery-filter').value='${range}';document.querySelector('[data-report="battery0"] .btn-excel').click()`);
            await until(() => shell('!document.getElementById("report-panel").hidden'), `${range} battery viewer`);
            const values = await shell('[...document.querySelectorAll("#report-content tbody tr")].map(row=>Number(row.cells[7].textContent))');
            assert.ok(values.length > 0);
            assert.ok(values.every(value => range === 'zero' ? value === 0 : value > 0 && value < 8000));
            await shell('document.getElementById("report-back").click()');
        }
        await frame(`document.querySelector('[data-report="all"] .actions').dataset.mode='group';document.querySelector('[data-report="all"] .btn-pdf').click()`);
        await until(() => shell('!document.getElementById("report-panel").hidden'), 'group report viewer');
        assert.equal(await shell('document.querySelector("#report-content th").textContent'), 'Account');
        assert.equal(await shell('cardDownloads.length'), 0);
        await shell('document.getElementById("report-csv").click()');
        await until(async () => await shell('cardDownloads.length') === 1, 'explicit viewer CSV download');
        assert.match(await shell('cardDownloads[0].body'), /Account/);
        await shell('document.getElementById("report-print").click()');
        await until(async () => await shell('cardPrints') === 1, 'explicit viewer print/PDF');
        assert.deepEqual(b.exceptions, []); assert.deepEqual(b.external, []);
    } finally { await b.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
