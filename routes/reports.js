const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { BATTERY_FILTERS, matchesBattery, batteryMode } = require('../lib/batteryFilter');

const {
    getUnitsForUser,
    getStcanUnitsForUser
} = require('../lib/wialon');

const {
    requireAuth,
    requireAdmin,
    requirePermission
} = require('../middleware/auth');

const {
    sendReportEmail,
    isConfigured
} = require('../lib/mailer');

const User = require('../models/User');
const InstallationReport = require('../models/InstallationReport');

// =====================================================
// SETTINGS
// =====================================================

// Set to false to hide the "Generated: ..." line everywhere
const SHOW_GENERATED = true;

const ALLOWED_FILTERS = ['all', 'offline', ...BATTERY_FILTERS];

const BRAND = {
    primary: 'FF1976D2',
    primaryHex: '#1976d2',
    dark: 'FF12233B',
    accentPink: 'FFE91E63',
    accentAmber: 'FFFFC107',
    accentTeal: 'FF26A69A',
    zebra: 'FFF4F7FB',
    danger: 'FFD32F2F',
    warn: 'FFF57C00',
    ok: 'FF2E7D32',
    grey: 'FF888888'
};

// =====================================================
// HELPERS
// =====================================================

// Current date/time in Cairo (correct for summer/winter time)
function cairoNow() {
    return new Date().toLocaleString('en-GB', {
        timeZone: 'Africa/Cairo'
    });
}

function todayStamp() {
    return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {

    if (value === null || value === undefined) {
        return '';
    }

    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getFleetReportTitle(filter) {

    if (filter === 'battery-zero') return 'Battery = 0V Report';
    if (filter === 'battery-low') return 'Battery > 0V and < 8000V Report';
    if (BATTERY_FILTERS.includes(filter)) return 'Battery Down Report (0V or below 8000V)';

    if (filter === 'offline') {
        return 'Offline Units Report';
    }

    return 'All Units Report';
}

function normalizeFilter(value, query = {}) {

    const filter = String(value || 'all');

    if (!ALLOWED_FILTERS.includes(filter)) return 'all';
    if (BATTERY_FILTERS.includes(filter)) { const mode = batteryMode(filter, query); return mode === 'zero' ? 'battery-zero' : mode === 'low' ? 'battery-low' : filter; }
    return filter;
}

function filterFleetUnits(units, filter, query = {}) {
    let filtered = units.filter(unit => matchesBattery(unit, batteryMode(filter, query)));
    if (filter === 'offline' || query.connection === 'offline') filtered = filtered.filter(unit => unit.isOffline);
    if (query.connection === 'online') filtered = filtered.filter(unit => !unit.isOffline);
    if (query.search) { const term = String(query.search).trim().toLowerCase(); filtered = filtered.filter(unit => [unit.name, unit.accountGroup, unit.location, unit.lastMessageTime, unit.isOffline ? 'offline' : 'online'].join(' ').toLowerCase().includes(term)); }
    if (['name-asc', 'name-desc', 'battery-asc', 'battery-desc'].includes(query.sort)) { const direction = query.sort.endsWith('desc') ? -1 : 1; filtered.sort((left, right) => direction * (query.sort.startsWith('battery') ? (Number.parseFloat(left.batteryVolts) || 0) - (Number.parseFloat(right.batteryVolts) || 0) : String(left.name).localeCompare(String(right.name)))); }
    return filtered;
}

// view=group sorts rows by account then unit name
function applyViewMode(units, query) {

    if (String(query.view || '').toLowerCase() !== 'group') {
        return units;
    }

    return [...units].sort((a, b) => {

        const byAccount = String(a.accountGroup || '')
            .localeCompare(String(b.accountGroup || ''));

        if (byAccount !== 0) {
            return byAccount;
        }

        return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

function sendJsonError(res, error) {

    if (res.headersSent) {

        if (!res.writableEnded) {
            res.end();
        }

        return;
    }

    res.removeHeader('Content-Disposition');

    res.status(500).json({
        success: false,
        error: error.message
    });
}

// =====================================================
// ENRICH UNITS WITH INSTALLATION SERIAL / SIM DATA
// =====================================================

async function enrichWithInstallationData(units) {

    if (!units.length) {
        return units;
    }

    const idsAsStrings = units.map(u => String(u.id));

    const idsAsNumbers = units
        .map(u => Number(u.id))
        .filter(n => Number.isFinite(n));

    const reports = await InstallationReport.find({
        'items.unitId': { $in: [...idsAsStrings, ...idsAsNumbers] }
    })
        .sort({ installationDate: -1 })
        .lean();

    const latestByUnitId = {};

    reports.forEach(report => {
        (report.items || []).forEach(item => {

            const unitId = String(item.unitId);

            if (!idsAsStrings.includes(unitId)) {
                return;
            }

            if (!latestByUnitId[unitId]) {
                latestByUnitId[unitId] = item;
            }
        });
    });

    return units.map(unit => {

        const installItem = latestByUnitId[String(unit.id)];

        if (!installItem) {
            return unit;
        }

        return {
            ...unit,
            serialNumber: installItem.serialNumber || unit.serialNumber,
            mobileNumber: installItem.simNumber || unit.mobileNumber
        };
    });
}

// =====================================================
// FLEET EXCEL WORKBOOK
// =====================================================

function addStripe(sheet, cells) {

    const colors = [
        BRAND.accentPink,
        BRAND.accentAmber,
        BRAND.accentTeal
    ];

    cells.forEach((ref, i) => {
        sheet.getCell(ref).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: colors[i] }
        };
    });
}

function buildFleetWorkbook(units, filter) {

    const workbook = new ExcelJS.Workbook();

    workbook.creator = 'Observer Fleet';
    workbook.created = new Date();

    const sheetTitle =
        BATTERY_FILTERS.includes(filter)
            ? 'Battery Report'
            : filter === 'offline'
                ? 'Offline Units Report'
                : 'Fleet Report';

    const sheet = workbook.addWorksheet(sheetTitle);

    sheet.mergeCells('A1:C1');

    sheet.getCell('A1').value = 'OBSERVER';
    sheet.getCell('A1').font = {
        bold: true,
        size: 18,
        color: { argb: BRAND.primary }
    };

    sheet.getCell('A2').value = 'Fleet Management Report';
    sheet.getCell('A2').font = {
        italic: true,
        size: 10,
        color: { argb: BRAND.grey }
    };

    if (SHOW_GENERATED) {
        sheet.getCell('A3').value = `Generated: ${cairoNow()}`;
        sheet.getCell('A3').font = {
            size: 9,
            color: { argb: 'FFAAAAAA' }
        };
    }

    addStripe(sheet, ['E1', 'F1', 'G1']);

    sheet.addRow([]);

    const headerRowIndex = 5;

    sheet.getRow(headerRowIndex).values = [
        'ID',
        'Unit Name',
        'IMEI',
        // EDIT BY NADA — this field contains the unit mobile number, not a SIM identifier.
        'Mobile Number',
        'Account',
        'Status',
        'Last Message',
        'Location (lat,lng)',
        'Offline Days',
        'Battery (V)',
        'Device Battery (V)'
    ];

    sheet.columns = [
        { key: 'rowId', width: 8 },
        { key: 'name', width: 24 },
        { key: 'serialNumber', width: 22 },
        { key: 'mobileNumber', width: 20 },
        { key: 'accountGroup', width: 22 },
        { key: 'status', width: 12 },
        { key: 'lastMessageTime', width: 22 },
        { key: 'location', width: 22 },
        { key: 'offlineDays', width: 14 },
        { key: 'batteryVolts', width: 12 },
        { key: 'deviceBatteryVolts', width: 18 }
    ];

    const headerRow = sheet.getRow(headerRowIndex);

    headerRow.font = {
        bold: true,
        color: { argb: 'FFFFFFFF' }
    };

    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: BRAND.primary }
    };

    units.forEach((u, index) => {

        const row = sheet.addRow({
            rowId: index + 1,
            serialNumber: u.imei || u.serialNumber || '—',
            mobileNumber: u.mobileNumber || '—',
            accountGroup: u.accountGroup,
            name: u.name,
            status: u.status,
            lastMessageTime: u.lastMessageTime,
            location: u.location,
            offlineDays: u.offlineDays,
            batteryVolts: u.batteryVolts,
            deviceBatteryVolts: u.deviceBatteryVolts
        });

        if (u.batteryStatus === 'zero') {
            row.getCell('batteryVolts').font = {
                color: { argb: BRAND.danger },
                bold: true
            };
        }
    });

    sheet.autoFilter = {
        from: { row: headerRowIndex, column: 1 },
        to: { row: headerRowIndex, column: 11 }
    };

    return workbook;
}

// =====================================================
// SENSOR EXCEL WORKBOOK
// =====================================================

function buildSensorWorkbook(units) {

    const workbook = new ExcelJS.Workbook();

    workbook.creator = 'Observer Fleet';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Sensor Overview');

    sheet.mergeCells('A1:D1');

    sheet.getCell('A1').value = 'OBSERVER';
    sheet.getCell('A1').font = {
        bold: true,
        size: 18,
        color: { argb: BRAND.primary }
    };

    sheet.mergeCells('A2:D2');

    sheet.getCell('A2').value = 'STCAN Sensor Overview Report';
    sheet.getCell('A2').font = {
        italic: true,
        size: 11,
        color: { argb: BRAND.grey }
    };

    if (SHOW_GENERATED) {
        sheet.getCell('A3').value = `Generated: ${cairoNow()}`;
        sheet.getCell('A3').font = {
            size: 9,
            color: { argb: 'FFAAAAAA' }
        };
    }

    sheet.getCell('A4').value = `Total STCAN units: ${units.length}`;
    sheet.getCell('A4').font = {
        size: 9,
        bold: true,
        color: { argb: BRAND.primary }
    };

    addStripe(sheet, ['F1', 'G1', 'H1']);

    sheet.addRow([]);

    const headerRowIndex = 6;

    sheet.getRow(headerRowIndex).values = [
        'Unit Name',
        'Device Type',
        'Serial Number',
        'Mobile Number',
        'Internal Battery (V)',
        'Battery (V)',
        'Mileage Sensor (km)',
        'Total Fuel (L)',
        'Fuel Percentage (%)',
        'Fuel Detection (L)',
        'Tank Capacity (L)'
    ];

    sheet.columns = [
        { key: 'name', width: 18 },
        { key: 'deviceType', width: 20 },
        { key: 'serialNumber', width: 20 },
        { key: 'mobileNumber', width: 18 },
        { key: 'deviceBatteryVolts', width: 18 },
        { key: 'batteryVolts', width: 14 },
        { key: 'mileageSensor', width: 18 },
        { key: 'totalFuel', width: 16 },
        { key: 'fuelPercentage', width: 16 },
        { key: 'fuelDetection', width: 16 },
        { key: 'tankCapacity', width: 16 }
    ];

    const headerRow = sheet.getRow(headerRowIndex);

    headerRow.height = 22;

    headerRow.font = {
        bold: true,
        color: { argb: 'FFFFFFFF' },
        size: 10
    };

    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: BRAND.primary }
    };

    headerRow.alignment = {
        vertical: 'middle',
        horizontal: 'center'
    };

    headerRow.eachCell(cell => {
        cell.border = {
            bottom: { style: 'thin', color: { argb: BRAND.dark } }
        };
    });

    units.forEach((u, idx) => {

        const row = sheet.addRow({
            name: u.name,
            deviceType: u.deviceType,
            serialNumber: u.serialNumber,
            mobileNumber: u.mobileNumber,
            deviceBatteryVolts: u.deviceBatteryVolts,
            batteryVolts: u.batteryVolts,
            mileageSensor: u.mileageSensor,
            totalFuel: u.totalFuel,
            fuelPercentage: u.fuelPercentage,
            fuelDetection: u.fuelDetection,
            tankCapacity: u.tankCapacity
        });

        if (idx % 2 === 1) {
            row.eachCell(cell => {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: BRAND.zebra }
                };
            });
        }

        row.getCell('name').font = { bold: true };

        const fuelPct = Number(u.fuelPercentage);

        if (Number.isFinite(fuelPct) && fuelPct > 0) {
            row.getCell('fuelPercentage').font = {
                bold: true,
                color: {
                    argb:
                        fuelPct < 20
                            ? BRAND.danger
                            : fuelPct < 40
                                ? BRAND.warn
                                : BRAND.ok
                }
            };
        }

        ['mileageSensor', 'totalFuel', 'fuelDetection', 'tankCapacity']
            .forEach(key => {

                const cell = row.getCell(key);

                if (Number(cell.value) === 0) {
                    cell.font = { color: { argb: 'FFB0B0B0' } };
                }
            });

        row.eachCell(cell => {
            cell.border = {
                bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } }
            };
        });
    });

    sheet.autoFilter = {
        from: { row: headerRowIndex, column: 1 },
        to: { row: headerRowIndex, column: 11 }
    };

    sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }];

    return workbook;
}

// =====================================================
// PDF HELPERS
//
// Arabic text: PDFKit's Helvetica cannot draw Arabic. If you
// put a Tajawal (or any Arabic) font at
//   public/assets/fonts/Tajawal-Regular.ttf
//   public/assets/fonts/Tajawal-Bold.ttf
// the PDFs will use it for cells that contain Arabic. If the
// files are missing, everything still works (Helvetica only).
// =====================================================

const ARABIC_AVAILABLE = true;

const AR_RANGE =
    '\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF';

const AR_TEST = new RegExp(`[${AR_RANGE}]`);

// Arabic letters, plus anything between Arabic letters that is
// not a Latin letter (spaces, punctuation, digits).
const AR_RUN = new RegExp(
    `[${AR_RANGE}]+(?:[^${AR_RANGE}A-Za-z]+[${AR_RANGE}]+)*`,
    'g'
);

const AR_WORD = new RegExp(`([${AR_RANGE}]+)`);

const MIRROR = {
    '(': ')', ')': '(',
    '[': ']', ']': '[',
    '{': '}', '}': '{',
    '<': '>', '>': '<'
};

function reverseNeutral(token) {

    return token
        .split(/(\d+)/)
        .filter(part => part !== '')
        .reverse()
        .map(part =>
            /^\d+$/.test(part)
                ? part
                : [...part].reverse().map(c => MIRROR[c] || c).join('')
        )
        .join('');
}

// Splits a string into pieces in visual left-to-right order.
// Inside an Arabic run the word order is reversed so Arabic
// reads correctly; Latin text and numbers stay as they are.
function bidiPieces(text) {

    const pieces = [];

    let last = 0;
    let match;

    AR_RUN.lastIndex = 0;

    while ((match = AR_RUN.exec(text)) !== null) {

        let run = match[0];
        let end = match.index + run.length;

        let unmatched =
            (run.match(/[(\[{]/g) || []).length -
            (run.match(/[)\]}]/g) || []).length;

        while (unmatched > 0 && /[)\]}]/.test(text.charAt(end))) {
            run += text.charAt(end);
            end += 1;
            unmatched -= 1;
        }

        const trailingNumber = /^\s*\d+/.exec(text.slice(end));

        if (trailingNumber) {
            run += trailingNumber[0];
            end += trailingNumber[0].length;
        }

        if (match.index > last) {
            pieces.push(text.slice(last, match.index));
        }

        run
            .split(AR_WORD)
            .filter(token => token !== '')
            .reverse()
            .forEach(token => {
                pieces.push(
                    AR_TEST.test(token)
                        ? token
                        : reverseNeutral(token)
                );
            });

        last = end;

        AR_RUN.lastIndex = end;
    }

    if (last < text.length) {
        pieces.push(text.slice(last));
    }

    return pieces;
}

function createPdfDoc(res, filename) {

    const doc = new PDFDocument({
        margin: 28,
        layout: 'landscape',
        size: 'A4',
        bufferPages: true
    });

    res.setHeader('Content-Type', 'application/pdf');

    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
    );

    try {
        doc.registerFont(
            'ArabicRegular',
            Buffer.from(ARABIC_FONT_REGULAR_B64, 'base64')
        );

        doc.registerFont(
            'ArabicBold',
            Buffer.from(ARABIC_FONT_BOLD_B64, 'base64')
        );
    } catch (error) {
        console.error('⚠️ Arabic font load failed:', error.message);
    }

    doc.on('error', error => {

        console.error('❌ PDF stream error:', error.message);

        if (!res.writableEnded) {
            res.end();
        }
    });

    doc.pipe(res);

    return doc;
}

function addPageNumbers(doc, makeLabel) {

    const range = doc.bufferedPageRange();

    for (let i = 0; i < range.count; i++) {

        doc.switchToPage(range.start + i);

        const originalBottom = doc.page.margins.bottom;

        doc.page.margins.bottom = 0;

        doc.font('Helvetica')
            .fontSize(8)
            .fillColor('#999999')
            .text(
                makeLabel(i + 1, range.count),
                0,
                doc.page.height - 28,
                {
                    width: doc.page.width,
                    align: 'center',
                    lineBreak: false
                }
            );

        doc.page.margins.bottom = originalBottom;
    }
}

// Draws a value on ONE line. Shrinks the font a little if it
// is too wide, then cuts it with "..." so it never overlaps.
// Cells with Arabic use the embedded Tajawal font + bidi pieces.
function drawCell(doc, rawText, x, y, rowHeight, width, opts) {

    const {
        font = 'Helvetica',
        size = 8.5,
        minSize = 6,
        color = '#222222',
        align = 'left'
    } = opts || {};

    const maxWidth = width - 8;

    let text = String(rawText);

    const useArabic = AR_TEST.test(text);

    const fontName = useArabic
        ? (font === 'Helvetica-Bold' ? 'ArabicBold' : 'ArabicRegular')
        : font;

    const piecesOf = value =>
        useArabic ? bidiPieces(value) : [value];

    const measure = value =>
        piecesOf(value).reduce(
            (sum, piece) => sum + doc.widthOfString(piece),
            0
        );

    let fontSize = size;

    doc.font(fontName).fontSize(fontSize);

    while (fontSize > minSize && measure(text) > maxWidth) {
        fontSize -= 0.5;
        doc.fontSize(fontSize);
    }

    if (measure(text) > maxWidth) {

        let cut = text;

        while (cut.length > 1 && measure(cut + '...') > maxWidth) {
            cut = cut.slice(0, -1);
        }

        text = cut + '...';
    }

    const total = measure(text);

    let cursor = x + 4;

    if (align === 'center') {
        cursor += Math.max(0, (maxWidth - total) / 2);
    } else if (align === 'right') {
        cursor += Math.max(0, maxWidth - total);
    }

    const textY = y + (rowHeight - fontSize) / 2;

    doc.fillColor(color);

    piecesOf(text).forEach(piece => {

        doc.text(piece, cursor, textY, { lineBreak: false });

        cursor += doc.widthOfString(piece);
    });
}

function drawBand(doc, subtitle, bandHeight) {

    const pageWidth = doc.page.width;
    const marginX = 28;

    doc.rect(0, 0, pageWidth, bandHeight).fill(BRAND.primaryHex);

    doc.fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('OBSERVER', marginX, 16, { lineBreak: false });

    doc.font('Helvetica')
        .fontSize(10)
        .text(subtitle, marginX, bandHeight - 28, { lineBreak: false });

    const stripeColors = ['#e91e63', '#ffc107', '#26a69a'];

    let sx = pageWidth - marginX - 90;

    stripeColors.forEach(color => {
        doc.rect(sx, 24, 26, 6).fill(color);
        sx += 30;
    });
}

function drawTableHeader(doc, columns, tableX, tableWidth, y, headerHeight) {

    doc.rect(tableX, y, tableWidth, headerHeight).fill(BRAND.primaryHex);

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);

    let x = tableX;

    columns.forEach(col => {

        const oneLine = doc.widthOfString(col.label) <= col.width - 8;

        doc.text(
            col.label,
            x + 4,
            y + (oneLine ? 9 : 4),
            { width: col.width - 8, align: col.align }
        );

        x += col.width;
    });

    return y + headerHeight;
}

function drawRowLine(doc, tableX, tableWidth, y) {

    doc.moveTo(tableX, y)
        .lineTo(tableX + tableWidth, y)
        .strokeColor('#e0e0e0')
        .lineWidth(0.5)
        .stroke();
}

// =====================================================
// SENSOR PDF
// =====================================================

function buildSensorPdf(units, res, filename) {

    const doc = createPdfDoc(res, filename);

    const pageWidth = doc.page.width;
    const marginX = 28;

    const columns = [
        { key: '#', label: '#', width: 24, align: 'center' },
        { key: 'name', label: 'Unit Name', width: 150, align: 'left' },
        { key: 'deviceType', label: 'Device Type', width: 84, align: 'left' },
        { key: 'serialNumber', label: 'Serial Number', width: 84, align: 'left' },
        { key: 'mobileNumber', label: 'Mobile Number', width: 76, align: 'left' },
        { key: 'deviceBatteryVolts', label: 'Int. Batt. (V)', width: 56, align: 'center' },
        { key: 'batteryVolts', label: 'Battery (V)', width: 46, align: 'center' },
        { key: 'mileageSensor', label: 'Mileage (km)', width: 60, align: 'center' },
        { key: 'totalFuel', label: 'Total Fuel (L)', width: 56, align: 'center' },
        { key: 'fuelPercentage', label: 'Fuel %', width: 40, align: 'center' },
        { key: 'fuelDetection', label: 'Fuel Det. (L)', width: 54, align: 'center' },
        { key: 'tankCapacity', label: 'Tank Cap. (L)', width: 50, align: 'center' }
    ];

    const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);

    const tableX = Math.max(marginX, (pageWidth - tableWidth) / 2);

    const headerHeight = 26;
    const rowHeight = 20;

    function drawPageHeader() {

        drawBand(doc, 'STCAN Sensor Overview Report', 68);

        doc.fillColor('#333333').font('Helvetica').fontSize(9);

        if (SHOW_GENERATED) {
            doc.text(
                `Generated: ${cairoNow()}`,
                marginX,
                78,
                { lineBreak: false }
            );
        }

        doc.text(
            `Total STCAN units: ${units.length}`,
            pageWidth - marginX - 160,
            78,
            { width: 160, align: 'right', lineBreak: false }
        );
    }

    function fuelColor(value) {

        const v = Number(value);

        if (!Number.isFinite(v) || v <= 0) {
            return '#9a9a9a';
        }

        if (v < 20) {
            return '#d32f2f';
        }

        if (v < 40) {
            return '#f57c00';
        }

        return '#2e7d32';
    }

    drawPageHeader();

    let y = drawTableHeader(doc, columns, tableX, tableWidth, 100, headerHeight);

    const bottomLimit = doc.page.height - 40;

    units.forEach((u, idx) => {

        if (y + rowHeight > bottomLimit) {

            doc.addPage();

            drawPageHeader();

            y = drawTableHeader(doc, columns, tableX, tableWidth, 100, headerHeight);
        }

        if (idx % 2 === 1) {
            doc.rect(tableX, y, tableWidth, rowHeight).fill('#f4f7fb');
        }

        let x = tableX;

        columns.forEach(col => {

            let value = col.key === '#' ? idx + 1 : u[col.key];

            let color = '#222222';

            if (col.key === '#') {
                color = '#8a8a8a';
            }

            if (col.key === 'fuelPercentage') {

                color = fuelColor(value);

                value = value != null ? `${value}%` : '0%';

            } else if (
                ['mileageSensor', 'totalFuel', 'fuelDetection', 'tankCapacity']
                    .includes(col.key) &&
                Number(value) === 0
            ) {
                color = '#b0b0b0';
            }

            if (value === undefined || value === null || value === '') {
                value = '-';
            }

            drawCell(doc, value, x, y, rowHeight, col.width, {
                font: col.key === 'name' ? 'Helvetica-Bold' : 'Helvetica',
                size: 8.5,
                minSize: 6.5,
                color,
                align: col.align
            });

            x += col.width;
        });

        drawRowLine(doc, tableX, tableWidth, y + rowHeight);

        y += rowHeight;
    });

    addPageNumbers(doc, (page, total) => `Page ${page} of ${total}`);

    doc.end();
}

// =====================================================
// FLEET PDF
// =====================================================

function buildFleetPdf(units, filter, res, filename) {

    const doc = createPdfDoc(res, filename);

    const pageWidth = doc.page.width;
    const marginX = 28;

    const title = getFleetReportTitle(filter);

    const columns = [
        { key: '#', label: 'ID', width: 24, align: 'center' },
        { key: 'name', label: 'Unit Name', width: 100, align: 'left' },
        { key: 'serialNumber', label: 'IMEI', width: 90, align: 'left' },
        // EDIT BY NADA — keep the Fleet PDF column aligned with the Excel and screen report label.
        { key: 'mobileNumber', label: 'Mobile Number', width: 80, align: 'left' },
        { key: 'accountGroup', label: 'Account', width: 90, align: 'left' },
        { key: 'status', label: 'Status', width: 45, align: 'left' },
        { key: 'lastMessageTime', label: 'Last Message', width: 75, align: 'left' },
        { key: 'location', label: 'Location', width: 70, align: 'left' },
        { key: 'offlineDays', label: 'Offline Days', width: 40, align: 'center' },
        { key: 'batteryVolts', label: 'Battery (V)', width: 50, align: 'center' },
        { key: 'deviceBatteryVolts', label: 'Device Battery', width: 55, align: 'center' }
    ];

    const scale = Math.min(1, (pageWidth - marginX * 2) / columns.reduce((sum, column) => sum + column.width, 0));
    columns.forEach(column => { column.width *= scale; });

    const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);

    const tableX = Math.max(marginX, (pageWidth - tableWidth) / 2);

    const headerHeight = 26;
    const rowHeight = 21;

    function drawPageHeader() {

        doc.save().rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff').restore();
        drawBand(doc, title, 70);

        doc.fillColor('#333333').font('Helvetica').fontSize(9);

        if (SHOW_GENERATED) {
            doc.text(
                `Generated: ${cairoNow()}`,
                marginX,
                80,
                { lineBreak: false }
            );
        }

        doc.text(
            `Total units: ${units.length}`,
            pageWidth - marginX - 150,
            80,
            { width: 150, align: 'right', lineBreak: false }
        );
    }

    drawPageHeader();

    let y = drawTableHeader(doc, columns, tableX, tableWidth, 105, headerHeight);

    const bottomLimit = doc.page.height - 40;

    units.forEach((unit, index) => {

        if (y + rowHeight > bottomLimit) {

            doc.addPage();

            drawPageHeader();

            y = drawTableHeader(doc, columns, tableX, tableWidth, 105, headerHeight);
        }

        if (index % 2 === 1) {
            doc.rect(tableX, y, tableWidth, rowHeight).fill('#f4f7fb');
        }

        let x = tableX;

        columns.forEach(col => {

            let value = col.key === '#' ? index + 1 : col.key === 'serialNumber' ? unit.imei || unit.serialNumber : unit[col.key];

            if (value === undefined || value === null || value === '') {
                value = '-';
            }

            let textColor = '#222222';

            if (col.key === '#') {
                textColor = '#8a8a8a';
            }

            if (col.key === 'status') {

                const s = String(value).toLowerCase();

                if (s === 'offline') {
                    textColor = '#d32f2f';
                }

                if (s === 'online') {
                    textColor = '#2e7d32';
                }
            }

            if (
                col.key === 'batteryStatus' &&
                String(value).toLowerCase() === 'zero'
            ) {
                textColor = '#d32f2f';
            }

            if (col.key === 'batteryVolts' && Number(value) === 0) {
                textColor = '#d32f2f';
            }

            drawCell(doc, value, x, y, rowHeight, col.width, {
                font: col.key === 'name' ? 'Helvetica-Bold' : 'Helvetica',
                size: 8,
                minSize: 6.5,
                color: textColor,
                align: col.align
            });

            x += col.width;
        });

        drawRowLine(doc, tableX, tableWidth, y + rowHeight);

        y += rowHeight;
    });

    addPageNumbers(
        doc,
        (page, total) => `Observer Fleet Report • Page ${page} of ${total}`
    );

    doc.end();
}

function sendFleetPdf(units, filter, res, sessionUser) {

    const filename = `observer-fleet-${filter}-${todayStamp()}.pdf`;

    buildFleetPdf(units, filter, res, filename);

    console.log(
        `📄 PDF export: ${filename} (${units.length} rows) by ${sessionUser.username}`
    );
}

// =====================================================
// HTML REPORT PAGE RENDERER
// =====================================================

function renderReportPage({
    pageTitle,
    subtitle,
    accentRgba,
    accentHex,
    maxWidth,
    actionsHtml,
    statsHtml,
    statsColumns,
    headers,
    rowsHtml,
    emptyText,
    footerHtml
}) {

    const headCells = headers
        .map(h => `<th>${escapeHtml(h)}</th>`)
        .join('');

    const body =
        rowsHtml ||
        `<tr><td colspan="${headers.length}" style="text-align:center;padding:40px;">${escapeHtml(emptyText)}</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Observer | ${escapeHtml(pageTitle)}</title>
<style>
* { box-sizing: border-box; }
body {
    margin: 0;
    padding: 30px;
    font-family: "Segoe UI", Arial, sans-serif;
    color: #eef2f6;
    background:
        radial-gradient(circle at 80% -10%, ${accentRgba}, transparent 35%),
        #07101d;
}
.container { max-width: ${maxWidth}px; margin: auto; }
.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    margin-bottom: 24px;
    padding: 22px;
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 16px;
    background: rgba(15,23,34,.88);
}
.brand { display: flex; align-items: center; gap: 14px; }
.logo { width: 46px; height: 46px; border-radius: 10px; object-fit: cover; }
h1 { margin: 0; font-size: 21px; font-weight: 800; }
.subtitle { margin-top: 5px; color: #8b98a8; font-size: 13px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
button, a {
    text-decoration: none;
    border: 1px solid rgba(255,255,255,.15);
    background: #101a28;
    color: #fff;
    padding: 10px 14px;
    border-radius: 9px;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
}
a:hover, button:hover {
    border-color: ${accentHex};
    background: ${accentRgba};
}
.summary {
    display: grid;
    grid-template-columns: repeat(${statsColumns}, 1fr);
    gap: 14px;
    margin-bottom: 18px;
}
.stat {
    padding: 18px;
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 14px;
    background: #101923;
}
.stat-label {
    color: #8491a1;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .08em;
}
.stat-value { font-size: 24px; font-weight: 800; margin-top: 6px; }
.table-wrap {
    overflow: auto;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,.08);
    background: #101923;
}
table { width: 100%; border-collapse: collapse; min-width: 1100px; }
thead { background: #1976d2; }
th { text-align: left; padding: 13px 12px; font-size: 11px; white-space: nowrap; }
td {
    padding: 12px;
    border-bottom: 1px solid rgba(255,255,255,.06);
    font-size: 12px;
    color: #b8c2ce;
    white-space: nowrap;
}
tbody tr:nth-child(even) { background: #0d1722; }
.unit { color: #fff; font-weight: 800; }
.danger { color: #ff5b5b !important; font-weight: 800; }
.ok { color: #35d07f !important; font-weight: 800; }
.fuel { color: #35d07f; font-weight: 800; }
.footer { text-align: center; color: #697687; font-size: 11px; padding: 22px; }
@media (max-width: 700px) {
    body { padding: 15px; }
    .header { align-items: flex-start; flex-direction: column; }
    .summary { grid-template-columns: 1fr; }
}
@media print {
    body { background: white; color: #111; padding: 0; }
    .header { color: #111; background: white; border: 1px solid #ddd; }
    .actions { display: none; }
}
</style>
</head>
<body>
<div class="container">

    <div class="header">
        <div class="brand">
            <img class="logo" src="/assets/logo-icon.jpg" alt="Observer">
            <div>
                <h1>Observer</h1>
                <div class="subtitle">${escapeHtml(subtitle)}</div>
            </div>
        </div>
        <div class="actions">
            ${actionsHtml}
            <button onclick="window.print()">🖨 Print</button>
            <button onclick="history.back()">← Back</button>
        </div>
    </div>

    <div class="summary">
        ${statsHtml}
    </div>

    <div class="table-wrap">
        <table>
            <thead><tr>${headCells}</tr></thead>
            <tbody>${body}</tbody>
        </table>
    </div>

    <div class="footer">${footerHtml}</div>

</div>
</body>
</html>`;
}

// =====================================================
// TEMP DEBUG: GET /api/reports/debug-installation-reports
// Admin only. Safe to delete.
// =====================================================

router.get(
    '/debug-installation-reports',
    requireAdmin,
    async (req, res) => {

        try {

            const total = await InstallationReport.countDocuments();

            const sample = await InstallationReport.find({})
                .sort({ installationDate: -1 })
                .limit(3)
                .lean();

            let firstItemKeys = [];
            let firstItemSample = null;

            if (
                sample.length &&
                Array.isArray(sample[0].items) &&
                sample[0].items.length
            ) {
                firstItemKeys = Object.keys(sample[0].items[0]);
                firstItemSample = sample[0].items[0];
            }

            res.json({
                success: true,
                totalDocuments: total,
                sampleCount: sample.length,
                sampleDocuments: sample,
                firstItemKeys,
                firstItemSample
            });

        } catch (error) {

            console.error('❌ Debug installation reports error:', error.message);

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

// =====================================================
// GET /api/reports/export
// filter = all | battery0 | offline
// format = xlsx (default) | pdf
// view = unit | group
// =====================================================

router.get(
    '/export',
    requireAuth,
    requirePermission('units'),
    async (req, res) => {

        try {

            const filter = normalizeFilter(req.query.filter, req.query);

            const format = String(req.query.format || 'xlsx').toLowerCase();

            const sessionUser = req.session.user;

            let units = await getUnitsForUser(sessionUser);

            units = filterFleetUnits(units, filter, req.query);
            units = applyViewMode(units, req.query);

            if (format === 'pdf') {
                sendFleetPdf(units, filter, res, sessionUser);
                return;
            }

            const workbook = buildFleetWorkbook(units, filter);

            const filename = `observer-fleet-${filter}-${todayStamp()}.xlsx`;

            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );

            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${filename}"`
            );

            await workbook.xlsx.write(res);

            res.end();

            console.log(
                `📊 Excel export: ${filename} (${units.length} rows) by ${sessionUser.username}`
            );

        } catch (error) {

            console.error('❌ Export error:', error.message);

            sendJsonError(res, error);
        }
    }
);

// =====================================================
// GET /api/reports/export-pdf
// =====================================================

router.get(
    '/export-pdf',
    requireAuth,
    requirePermission('units'),
    async (req, res) => {

        try {

            const filter = normalizeFilter(req.query.filter, req.query);

            const sessionUser = req.session.user;

            let units = await getUnitsForUser(sessionUser);

            units = filterFleetUnits(units, filter, req.query);
            units = applyViewMode(units, req.query);

            sendFleetPdf(units, filter, res, sessionUser);

        } catch (error) {

            console.error('❌ PDF export error:', error.message);

            sendJsonError(res, error);
        }
    }
);

// =====================================================
// GET /api/reports/view
// =====================================================

router.get(
    '/view',
    requireAuth,
    requirePermission('units'),
    async (req, res) => {

        try {

            const filter = normalizeFilter(req.query.filter, req.query);

            const sessionUser = req.session.user;

            let units = await getUnitsForUser(sessionUser);

            units = filterFleetUnits(units, filter, req.query);
            units = applyViewMode(units, req.query);

            const title = getFleetReportTitle(filter);

            const rows = units
                .map(u => {

                    const batteryClass =
                        Number(u.batteryVolts) === 0 ? 'danger' : '';

                    const statusClass =
                        String(u.status).toLowerCase() === 'offline'
                            ? 'danger'
                            : 'ok';

                    return `
<tr>
    <td>${escapeHtml(u.accountGroup)}</td>
    <td class="unit">${escapeHtml(u.name)}</td>
    <td class="${statusClass}">${escapeHtml(u.status)}</td>
    <td>${escapeHtml(u.lastMessageTime)}</td>
    <td>${escapeHtml(u.location)}</td>
    <td>${escapeHtml(u.offlineDays)}</td>
    <td class="${batteryClass}">${escapeHtml(u.batteryVolts)}</td>
    <td>${escapeHtml(u.deviceBatteryVolts)}</td>
    <td>${escapeHtml(u.batteryStatus)}</td>
</tr>`;
                })
                .join('');

            const generated = cairoNow();

            const generatedStat = SHOW_GENERATED
                ? `
        <div class="stat">
            <div class="stat-label">Generated</div>
            <div class="stat-value" style="font-size:16px">${escapeHtml(generated)}</div>
        </div>`
                : '';

            const html = renderReportPage({
                pageTitle: title,
                subtitle: title,
                accentRgba: 'rgba(25,118,210,.18)',
                accentHex: '#1976d2',
                maxWidth: 1400,
                statsColumns: SHOW_GENERATED ? 3 : 2,
                actionsHtml: `
            <a href="/api/reports/export?filter=${encodeURIComponent(filter)}">📊 Excel</a>
            <a href="/api/reports/export-pdf?filter=${encodeURIComponent(filter)}">📄 PDF</a>`,
                statsHtml: `
        <div class="stat">
            <div class="stat-label">Report</div>
            <div class="stat-value" style="font-size:18px">${escapeHtml(title)}</div>
        </div>
        <div class="stat">
            <div class="stat-label">Total Units</div>
            <div class="stat-value">${units.length}</div>
        </div>${generatedStat}`,
                headers: [
                    'Account',
                    'Unit Name',
                    'Status',
                    'Last Message',
                    'Location',
                    'Offline Days',
                    'Battery (V)',
                    'Device Battery (V)',
                    'Battery Status'
                ],
                rowsHtml: rows,
                emptyText: 'No units found',
                footerHtml: SHOW_GENERATED
                    ? `Observer Fleet Management System • Generated ${escapeHtml(generated)}`
                    : 'Observer Fleet Management System'
            });

            res.send(html);

        } catch (error) {

            console.error('❌ View report error:', error.message);

            if (!res.headersSent) {
                res.status(500).send('Unable to generate report.');
            }
        }
    }
);

// =====================================================
// GET /api/reports/export-sensors
// format = xlsx | pdf
// =====================================================

router.get(
    '/export-sensors',
    requireAuth,
    requirePermission('units'),
    async (req, res) => {

        try {

            const format = String(req.query.format || 'xlsx').toLowerCase();

            const sessionUser = req.session.user;

            const rawUnits = await getStcanUnitsForUser(sessionUser);

            const units = await enrichWithInstallationData(rawUnits);

            const stamp = todayStamp();

            if (format === 'pdf') {

                const filename = `observer-sensor-overview-${stamp}.pdf`;

                buildSensorPdf(units, res, filename);

                console.log(
                    `📄 PDF sensor export: ${filename} (${units.length} rows) by ${sessionUser.username}`
                );

                return;
            }

            const workbook = buildSensorWorkbook(units);

            const filename = `observer-sensor-overview-${stamp}.xlsx`;

            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );

            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${filename}"`
            );

            await workbook.xlsx.write(res);

            res.end();

            console.log(
                `📊 Excel sensor export: ${filename} (${units.length} rows) by ${sessionUser.username}`
            );

        } catch (error) {

            console.error('❌ Sensor export error:', error.message);

            sendJsonError(res, error);
        }
    }
);

// =====================================================
// GET /api/reports/view-sensors
// =====================================================

router.get(
    '/view-sensors',
    requireAuth,
    requirePermission('units'),
    async (req, res) => {

        try {

            const sessionUser = req.session.user;

            const rawUnits = await getStcanUnitsForUser(sessionUser);

            const units = await enrichWithInstallationData(rawUnits);

            const rows = units
                .map(u => {

                    const batteryClass =
                        Number(u.batteryVolts) === 0 ? 'danger' : '';

                    return `
<tr>
    <td class="unit">${escapeHtml(u.name)}</td>
    <td>${escapeHtml(u.deviceType)}</td>
    <td>${escapeHtml(u.serialNumber)}</td>
    <td>${escapeHtml(u.mobileNumber)}</td>
    <td>${escapeHtml(u.deviceBatteryVolts)}</td>
    <td class="${batteryClass}">${escapeHtml(u.batteryVolts)}</td>
    <td>${escapeHtml(u.mileageSensor)}</td>
    <td>${escapeHtml(u.totalFuel)}</td>
    <td class="fuel">${escapeHtml(u.fuelPercentage)}%</td>
    <td>${escapeHtml(u.fuelDetection)}</td>
    <td>${escapeHtml(u.tankCapacity)}</td>
</tr>`;
                })
                .join('');

            const generated = cairoNow();

            const generatedStat = SHOW_GENERATED
                ? `
        <div class="stat">
            <div class="stat-label">Generated</div>
            <div class="stat-value" style="font-size:16px">${escapeHtml(generated)}</div>
        </div>`
                : '';

            const html = renderReportPage({
                pageTitle: 'Sensor Overview',
                subtitle: 'STCAN Sensor Overview',
                accentRgba: 'rgba(38,166,154,.16)',
                accentHex: '#26a69a',
                maxWidth: 1450,
                statsColumns: SHOW_GENERATED ? 2 : 1,
                actionsHtml: `
            <a href="/api/reports/export-sensors?format=xlsx">📊 Excel</a>
            <a href="/api/reports/export-sensors?format=pdf">📄 PDF</a>`,
                statsHtml: `
        <div class="stat">
            <div class="stat-label">STCAN Units</div>
            <div class="stat-value">${units.length}</div>
        </div>${generatedStat}`,
                headers: [
                    'Unit Name',
                    'Device Type',
                    'Serial Number',
                    'Mobile Number',
                    'Internal Battery (V)',
                    'Battery (V)',
                    'Mileage (km)',
                    'Total Fuel (L)',
                    'Fuel %',
                    'Fuel Detection (L)',
                    'Tank Capacity (L)'
                ],
                rowsHtml: rows,
                emptyText: 'No STCAN units found',
                footerHtml: 'Observer Fleet Management System'
            });

            res.send(html);

        } catch (error) {

            console.error('❌ Sensor view error:', error.message);

            if (!res.headersSent) {
                res.status(500).send('Unable to generate sensor report.');
            }
        }
    }
);

// =====================================================
// GET /api/reports/export-unit/:id
// Single unit Excel report
// =====================================================

router.get(
    '/export-unit/:id',
    requireAuth,
    requirePermission('units'),
    async (req, res) => {

        try {

            const sessionUser = req.session.user;

            const unitId = Number(req.params.id);

            const units = await getUnitsForUser(sessionUser);

            const unit = units.find(u => u.id === unitId);

            if (!unit) {

                return res.status(404).json({
                    success: false,
                    error: 'Unit not found or you do not have access to it'
                });
            }

            const workbook = new ExcelJS.Workbook();

            workbook.creator = 'Observer Fleet';
            workbook.created = new Date();

            const sheet = workbook.addWorksheet(
                String(unit.name || '').substring(0, 28) || 'Unit Report'
            );

            sheet.columns = [
                { header: 'Field', key: 'field', width: 22 },
                { header: 'Value', key: 'value', width: 30 }
            ];

            sheet.getRow(1).font = {
                bold: true,
                color: { argb: 'FFFFFFFF' }
            };

            sheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: BRAND.primary }
            };

            const rows = [
                ['Account', unit.accountGroup],
                ['Unit Name', unit.name],
                ['Status', unit.status],
                ['Last Message', unit.lastMessageTime],
                ['Location (lat,lng)', unit.location],
                ['Offline Days', unit.offlineDays],
                ['Battery (V)', unit.batteryVolts],
                ['Device Battery (V)', unit.deviceBatteryVolts],
                ['Battery Status', unit.batteryStatus],
                ['Has Mileage Sensor', unit.hasMileage ? 'Yes' : 'No'],
                ['Has Fuel Sensor', unit.hasFuel ? 'Yes' : 'No']
            ];

            if (SHOW_GENERATED) {
                rows.push(['Report Generated', cairoNow()]);
            }

            rows.forEach(([field, value]) =>
                sheet.addRow({ field, value })
            );

            const safeUnitName = String(unit.name || 'unit')
                .replace(/[^a-z0-9]/gi, '_');

            const filename = `observer-${safeUnitName}-${todayStamp()}.xlsx`;

            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );

            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${filename}"`
            );

            await workbook.xlsx.write(res);

            res.end();

            console.log(
                `📊 Unit report export: ${filename} by ${sessionUser.username}`
            );

        } catch (error) {

            console.error('❌ Unit export error:', error.message);

            sendJsonError(res, error);
        }
    }
);

// =====================================================
// POST /api/reports/send-email/:userId
// Admin only
// =====================================================

router.post(
    '/send-email/:userId',
    requireAdmin,
    async (req, res) => {

        try {

            if (!isConfigured()) {

                return res.status(400).json({
                    success: false,
                    error:
                        'SMTP is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM to your .env file first.'
                });
            }

            const targetUser = await User.findById(req.params.userId);

            if (!targetUser) {

                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }

            if (!targetUser.reportEmail) {

                return res.status(400).json({
                    success: false,
                    error: 'This user has no reportEmail set yet.'
                });
            }

            const asSessionUser = {
                role: targetUser.role,
                wialonAccounts: targetUser.wialonAccounts,
                assignedUnitNames: targetUser.assignedUnitNames
            };

            const units = await getUnitsForUser(asSessionUser);

            const filter = normalizeFilter((req.body || {}).filter, req.body || {});

            const filteredUnits = filterFleetUnits(units, filter, req.body || {});

            const workbook = buildFleetWorkbook(filteredUnits, filter);

            const buffer = await workbook.xlsx.writeBuffer();

            const stamp = todayStamp();

            const filename =
                `observer-fleet-${targetUser.username}-${stamp}.xlsx`;

            await sendReportEmail({
                to: targetUser.reportEmail,
                subject: `Observer Fleet Report - ${stamp}`,
                text:
                    `Hi ${targetUser.displayName || targetUser.username},\n\nPlease find attached your fleet report generated on ${stamp}.\n\n— Observer Fleet System`,
                attachmentBuffer: buffer,
                attachmentName: filename
            });

            console.log(
                `📧 Report emailed to ${targetUser.reportEmail} (${targetUser.username})`
            );

            res.json({
                success: true,
                sentTo: targetUser.reportEmail
            });

        } catch (error) {

            console.error('❌ Send email error:', error.message);

            sendJsonError(res, error);
        }
    }
);


// =====================================================
// EMBEDDED FONT: Tajawal (c) 2017 Boutros International,
// SIL Open Font License 1.1. Subset to Latin + Arabic.
// Do not edit these two blocks.
// =====================================================

const ARABIC_FONT_REGULAR_B64 = [
    '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',
    'FQL1Q3xDOQpCeSBFE0M4BgM/UmInQmNSLCkBBJQ6Iyv+8AEIkCMa/qUBxi87SUk1MlsAAQBOAAABzAHSABEAACEjETQjIgYHESMR',
    'MxczNjMyFQHMQnwkRhNDOAYDO1mpAQqOIhr+pAHGMDzDAAIAMP/0AeUB0gAPAB0AACUUBwYjIicmNTQ3NjMyFxYFFBcWMzI2NTQn',
    'JiMiBgHlRD1ZZz81QjxdaT4z/pMtKD1CUSwoPkJR4mxFPU5CXm5EPk9CX1czLWVSVjQwZwACAE7/SgHrAdIAEAAeAAATMxc2MzIX',
    'FhUUBwYjIicVIxMVFhYzMjY1NCcmIyIGTjUJOFxiOTBGOVFYMkNDDEcmRVQuJj4nSgHGMT1KP117RTg24AIB1x8qZFNdMiouAAAC',
    'ADD/RwHMAdIAEAAeAAABMxEjNQYjIicmNTQ3NjMyFwM1JiYjIgYVFBcWMzI2AZkzQjdXYDoyRzlUXC4EDkYnQ1MuJjspSgHG/YHp',
    'PEo/X3pEODr+49YgK2dRXTIqLQABAE4AAAF2AdIADgAAAQcmIyIHESMRMxczNjMyAXY3Iic5LEM5BgI7PkkBnyYeO/6kAcYwPAAB',
    'ADD/9AFvAdIAIgAAASYjIgYVFBYXFhYVFAYjIic2NzY3FjMyNTQmJyY1NDYzMhcBPDI7KC0pOlJAWUZcRAMHBwU6Q2ktPY5TQU09',
    'AYIaIx4gIxEZPjg7STIFDA0HIE8gJBAoYzVEKwAAAQAq//QBRQJLABQAABMDFDMyNxcGIyImNREjNTM1NxUzFbIBOyEgGDE2NTpF',
    'RkKLAY/+5EkRJSJCOwEeN2MihTcAAQBO//QBvAHGABIAAAERIycHBiMiJjURMxEUMzI2NxEBvDQGAz1XSVRDbiJFFAHG/jo0AT9n',
    'WwEQ/vyTIhsBWgAAAQAPAAABqgHGAAYAADMjAzMTEzP+RKtIhoVIAcb+iQF3AAEADwAAAqUBxgAMAAAzIwMzExMzExMzAyMD7UiW',
    'SHJtTWhySJdIagHG/ogBeP6IAXj+OgF1AAEADQAAAZ4BxgALAAABBxcjJwcjNyczFzcBl5eeSnyAS6WNSmp0AcbZ7by86typqQAA',
    'AQAP/0EBugHGABAAAAEDBiMiJzcWMzI3NyMDMxMTAbrGLU8yMhYiGjIlEhGvR5CMAcb99XokJBJdLAHG/n8BgQAAAQAZAAABgQHG',
    'AAkAACEhNQEhNSEVASEBgf6YARP+/gFR/u4BGDoBVTc6/qsAAAEAMP91AUAChQAiAAA3NTY2NTU0NjMzFSMiBhUVFAcWFhUVFBYz',
    'MxUjIicmNTU0JjAxOT9TFBQyHmc3MB4yFBRcHhg64joDTkAwX0k6KkQwfzAZUUUyRSo5LiRWMj5PAAEAWv9NAJgClgADAAATESMR',
    'mD4Clvy3A0kAAQA5/3UBSQKFACIAAAEVBgYVFRQGIyM1MzI2NTU0NjcmNTU0JiMjNTMyFxYVFRQWAUkxOT9TFBQyHi84Zx4yFBRb',
    'Hxg4ARw6Bk8+MmBIOSpFMkVRGTB/MEQqOi4kVjBATgABACoAvAG5ATEAEwAANyc2MzIXFjMyNxcGIyInJicmIyJEGh1GJE4+Gy8W',
    'HBhAIksHEC8fLccSWCMcMxJXIAMHFQABAEYAlgDZASwABwAANyI1NDMyFRSQSkpJlktLS0sAAAMAWv/7AfsAUAAJABMAHQAANxQV',
    'FCMiNTYzMhcUFRQjIjU2MzIXFBUUIyI1NjMyrikrAikppykrAikppikrAikpKAEBKywpKAEBKywpKAEBKywpAAEARgCrATcA6QAD',
    'AAA3NTMVRvGrPj4AAAEARgCrAigA6QADAAA3NSEVRgHiqz4+AAIAKgAAAfAChQAWACIAAAEjESMRIzUzNTQ2MzIXByYjIhUVIREj',
    'AzQ2MzIWFRQGIyImAaL1QkFBOjU2MRghIDsBOEMJGRISGhkTEhkBkP5wAZA2QjtCIiURSj/+OgJaERoaERMZGQAAAgAqAAAB4AKF',
    'ABQAGAAAEzM1NDYzMhcHJiMiFRUzFSMRIxEjJREjESpBOjU2MRghIDtyckJBAbZCAcZCO0IiJRFKPzb+cAGQ9f17AmEAAwBM/+IC',
    '8AJ5AAYAGgAeAAATESM1Byc3ATU3NjU0IyIHJzYzMhYVFAcHMxUDASMB6zdDJWQBYWg9PyYqGjc8Mj5GQoeN/oA1AYACef7F9Tom',
    'Wv2HNFgzIjUdHzE3LTo+OTQCef1pApcAAAQATP/iAvQCeQAKAA0AFAAYAAAlNzMVMxUjFSM1IzczNQERIzUHJzchASMBAdqmODw8',
    'N6dCZf5qN0MlZAG5/oA1AYB3x8ozQUEzfwGG/sX1OiZa/WkClwAEAEz/4gMQAoUACgANAC0AMQAAJTczFTMVIxUjNSM3MzUlNTMy',
    'NTQjIgcnNjMyFhUUBgcWFRQGIyInNxYzMjU0IyUBIwEB9qc3PDw3p0Jl/fAoOTkmKhk0PjI5Hhc7RDQ4MxslJkE/Ac/+gDUBgHfH',
    'yjNBQTN/3DMnKRccLi4oFycGEUEqNS0eFy8yqv1pApcAAAEAQf/7AKMArwAMAAA3Mh0CFAYjIjU1NxV2LRsVMh9bLQEBFhs/aQxU',
    'AAIAU//7ALUBpgAMABYAABMyHQIUBiMiNTU3FRMUFRQjIjU2MzKILRsVMh88KSsCKSkBUi0BARYbP2kMVP7WAQErLCkAAgAw//cB',
    'XQKSAB0AJwAANzY1NCYnJicmNTQ2MzIXFSYjIgYVFBcWFxYWFRQHFxQVFCMiNTYzMtoSIzQbDT1aR04+SEAsNysJFj8vEQkpKwIp',
    'KXslHyE2LxgNPk5EWDZEPTUqMysJFDpPLyMlVwEBKywpAAABACP/ygHPAZYAHQAAFzU2NyY1NDY3NjMyFxUmIyIHBhUUFzYzNjcV',
    'BiMiIyVEM09EDw9XOD5ODAtaPw0Xg01Uh4Q2QBwLRlRRawwDR0NNAhJ2XDgBAjc+NwACAA4AAADrAwUAEQAVAAATBiMiJyYjIgcn',
    'NjMyFxYzMjcDETcR6x4kFx8WDBIXGh8jFBwYEBAZd0MC7TAVDyATMRMRH/0AAmIj/XsAAgAjAAAA0AMgABMAFwAAEzczJjU0NjMy',
    'FxUmIyIGFRQXMwcDETcRIxMZCiscFhUTExAXD1cTY0MCkyMRExwqDiUOFA4SESP9bQI6I/2jAAADADz/QgGdAr4AEwAwADsAAAEH',
    'IzczJjU0NjMyFxUmIyIGFRQXEwYjIicmNTQ3NjMyFxYVFRQGBwYjIic1FjMyNzYTNCMiBhUUFjMyNwE3E5sTGgoqHRYVFBMQFg57',
    'KkJXMSo4MVFTLSdOSBgcOjc0MykfRgNkOEE+NU8bAlUkJBISHCkNJg8VDhER/dAYQzlXaTs0NC1L3F15EQccOxwSIwFUdVJIRlMs',
    'AAIAIf8UAM8ChQADABcAADMRNxEHNzMmNTQ2MzIXFSYjIgYVFBczB1pDfBMaCiodFhUUExAWDlgTAmIj/XvsJBISHCkNJg8VDhER',
    'JAACADr/QgKNAeEAFABDAAATNzMmNTQ2MzIXFSYjIgcGFRQXMwcFJiMiBhUVFhYXFhYVFAcGIyInJjU0NzcGFRQXFjMyNzY1NCYn',
    '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',
    'NCxJ/mk7LAdNRGh/RjcsQTA5NVFfNCtDAmM1LUR2WkUiAXJrAjAqKCgq/hKZaXRNQmEcVS8oHWk8NlpFYFY+DUlTWDk1OC5LAQ8j',
    's15iFFQzLG5TfAAAAgAUAAADFwKFAA4AGwAANzYzMhcWFRUUIyE3MxE3ATQnJiMiBwYHITI2Nfd1wXBCOJD9jSGEPgHdNS1EdVtF',
    'IQGIMCTh101CYSOlPgIkI/5DVDMscVV3LTwAAwAUAAADFwKFAA4AGwAjAAA3NjMyFxYVFRQjITczETcBNCcmIyIHBgchMjY1AyI1',
    'NDMyFRT3dcFwQjiQ/Y0hhD4B3TUtRHVbRSEBiDAkrCkpJ+HXTUJhI6U+AiQj/kNUMyxxVXctPAGJKigoKgABAEb+iQH3AbgAKQAA',
    'AQYjIicmNTQ2NyY1NDc2NzIXFSYjIgYVFBcWMzMVIyIHBhUUFxYzMzI3AfdSZ3hGOkA3ZkU2S2Y7PV4+TC4sSrGvYTImNTJRAnJF',
    '/r00Sz5VPmQZOoxlOy8BUUJWU0JNLi0+NSg7SC4rMwACAEb+iQH3AoIABwAxAAABIjU0MzIVFBMGIyInJjU0NjcmNTQ3NjcyFxUm',
    'IyIGFRQXFjMzFSMiBwYVFBcWMzMyNwErKSknpVJneEY6QDdmRTZLZjs9Xj5MLixKsa9hMiY1MlECckUCMCooKCr8jTRLPlU+ZBk6',
    'jGU7LwFRQlZTQk0uLT41KDtILiszAAH/9gAAAH4APgADAAAjNTMVCog+PgADAFoAAANXAn8ABwAhACwAAAEiNTQzMhUUASInJjU1',
    'NxUUMyEmNTQ3NjMyFxYVFRQHBiMTNCMiBhUUFjMyNQK3KSkn/iNRLihDcgEeNzgxUVMtJzMtSmdkOT8+M2sCLSooKCr90zYwS4Mj',
    'nns1aWw7NTQtS2BTLyoBBnVUSkhXdAAABABG/0ICjgJ/AAcADwAzAD4AAAEiNTQzMhUUMyI1NDMyFRQTFAcGIyInJjU0NzcGFRQX',
    'FjMyNzY1BiMiJyY1NDc2MzIXFhUHNCMiBhUUFjMyNwGwKSknSykpJ0VUTYWaTjosQTA/PWl4OjAlRlYyKjgxUVMtJ0NkOEA9NVEZ',
    'Ai0qKCgqKigoKv4EdEA7WkNiVj4NSVNbNjU3LUsiRDlWaTs0NC1LBnVSSEdSLgAAAgBaAAADCgKFABIAJgAAATcRFAcGIyEiJjU1',
    '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',
    'TwIwKigoKv3QPi45k0g3XKd2Pjo6AAAB/6P/QQFvAawAGAAAJTMVIyInBgcGIyInNRYzMjc2NRE3FTcVFAFMIys+KQh+ICQ6NjM1',
    'KiBGQgE+Ph6mLAscOxwTKnMBXSMBAfxyAAAC/6P/QQFvAoIABwAgAAATIjU0MzIVFBMzFSMiJwYHBiMiJzUWMzI3NjURNxU3FRS2',
    'KSknbyMrPikIfiAkOjYzNSogRkIBAjAqKCgq/g4+HqYsCxw7HBMqcwFdIwEB/HIAAAEARv9CBXgBrAA4AAAlMxUjIicGIyMiJwYj',
    'IyInBgcGIyInJjU0NzcGFRQXFjMyNzY1ETcVFDMzMjU1NxUUMzMyNTU3FRQFPjpBXC8vWjVbLS1bNTssB01EaH9GNyxBMDk1UV80',
    'K0NvJG9CbyVuQz4+Pz8+Ph1pPDZaRWBWPg1JU1g5NTguSwEPI7NycrQk2HJy2SP4dgAAAf/2AAADbgGsACUAACM1MzI1NTcVFDMz',
    'MjU1NxUUMzMyNTU3FRQHBgcjIicGIyMiJwYjCj1vQ24lbkNvJG9DMSxLN10qK1s3XSsqXT5ykCOzcnK0JNhyctkj/lMvKwFCQkJC',
    'AAH/9gAABBoBrAAqAAAjNTMyNTU3FRQzMzI1NTcVFDMzMjU1NxUUMzMVIyInBiMjIicGIyMiJwYjCj1vQ24lbkNvJG9DcjpBXyws',
    'XDddKitbN10rKl0+cpAjs3JytCTYcnLZI/h2PkNDQkJCQgAABABG/0IFeALBAAcADwAXAFAAAAEiNTQzMhUUByI1NDMyFRQ3NDMy',
    'FRQjIgEzFSMiJwYjIyInBiMjIicGBwYjIicmNTQ3NwYVFBcWMzI3NjURNxUUMzMyNTU3FRQzMzI1NTcVFANkJSUkXSgoKCIpJycp',
    'Ack6QVwvL1o1Wy0tWzU7LAdNRGh/RjcsQTA5NVFfNCtDbyRvQm8lbkMCdyYkJCZoKSkpKSkpKSn+Lz4/Pz4+HWk8NlpFYFY+DUlT',
    'WDk1OC5LAQ8js3JytCTYcnLZI/h2AAAE//YAAANuAsEABwAPABcAPQAAASI1NDMyFRQHIjU0MzIVFDMiNTQzMhUUATUzMjU1NxUU',
    'MzMyNTU3FRQzMzI1NTcVFAcGByMiJwYjIyInBiMCByQkJFwpKSdLKCgo/Y09b0NuJW5DbyRvQzEsSzddKitbN10rKl0CdyYkJCZo',
    'KSkpKSkpKSn98T5ykCOzcnK0JNhyctkj/lMvKwFCQkJCAAAE//YAAAQaAsEABwAPABcAQgAAASI1NDMyFRQHIjU0MzIVFDMiNTQz',
    'MhUUATUzMjU1NxUUMzMyNTU3FRQzMzI1NTcVFDMzFSMiJwYjIyInBiMjIicGIwIHJCQkXCkpJ0soKCj9jT1vQ24lbkNvJG9DcjpB',
    'XywsXDddKitbN10rKl0CdyYkJCZoKSkpKSkpKSn98T5ykCOzcnK0JNhyctkj+HY+Q0NCQkJCAAIARv9CBXoBuAAuADoAACUzFSMi',
    'JwYjISInBgcGIyInJjU0NzcGFRQXFjMyNzY1ETcVFBc2NzYzMhcWFRUUIzI1NTQnJiMiBwYHBVcjK1otLVv+aTssB01EaH9GNyxB',
    'MDk1UV80K0NJJF1ni3BCOK5rNS1EdlpFIj4+PT0daTw2WkVgVj4NSVNYOTU4LksBDyOzXhCZaXRNQmEacHYUVDMsblN8AAAC//YA',
    'AANwAbgAGwAnAAAlNjc2MzIXFhUVFAcGIyEiJwYjIzUzMjU1NxUUJTU0JyYjIgcGByEyARMlXGeLcEI4NCxJ/mlaLS9ZKyNuQwJj',
    'NS1EdVtFIwFza0KaaHRNQmEcVS8oPT0+cpAjs15iFFQzLG5UewAAAv/2AAAEAQG4ACAALAAAJTMVIyInBiMhIicGIyM1MzI1NTcV',
    'FBc2NzYzMhcWFRUUIzI1NTQnJiMiBwYHA94jK1otLVv+aVotL1krI25DSSVcZ4twQjiuazUtRHVbRSM+Pj09PT0+cpAjs14Qmmh0',
    'TUJhGnB2FFQzLG5UewAAAwBG/0IFegKCAAcANgBCAAABIjU0MzIVFAEzFSMiJwYjISInBgcGIyInJjU0NzcGFRQXFjMyNzY1ETcV',
    'FBc2NzYzMhcWFRUUIzI1NTQnJiMiBwYHA/opKScBNiMrWi0tW/5pOywHTURof0Y3LEEwOTVRXzQrQ0kkXWeLcEI4rms1LUR2WkUi',
    'AjAqKCgq/g4+PT0daTw2WkVgVj4NSVNYOTU4LksBDyOzXhCZaXRNQmEacHYUVDMsblN8AAAD//YAAANwAoIABwAjAC8AAAEiNTQz',
    'MhUUATY3NjMyFxYVFRQHBiMhIicGIyM1MzI1NTcVFCU1NCcmIyIHBgchMgKVKSkn/lclXGeLcEI4NCxJ/mlaLS9ZKyNuQwJjNS1E',
    'dVtFIwFzawIwKigoKv4Smmh0TUJhHFUvKD09PnKQI7NeYhRUMyxuVHsAAAP/9gAABAECggAHACgANAAAASI1NDMyFRQBMxUjIicG',
    'IyEiJwYjIzUzMjU1NxUUFzY3NjMyFxYVFRQjMjU1NCcmIyIHBgcClSkpJwEiIytaLS1b/mlaLS9ZKyNuQ0klXGeLcEI4rms1LUR1',
    'W0UjAjAqKCgq/g4+PT09PT5ykCOzXhCaaHRNQmEacHYUVDMsblR7AAACABQAAAOoAoUAFQAiAAAlFSMiJwYjITczETcRNjMyFxYV',
    'FRQzJzQnJiMiBwYHITI2NQOoK1QuJFD9jSGEPnXBcEI4b7I1LUR1W0UhAYgwJD4+NjY+AiQj/lzXTUJhGnCKVDMscVV3LTwAAv/2',
    'AAAC/QKFAA4AGwAANzYzMhcWFRUUIyE1MxE3ATQnJiMiBwYHITI2Nd11wXBCOJD9iak+Ad01LUR1W0UhAYgwJOHXTUJhI6U+AiQj',
    '/kNUMyxxVXctPAAAAv/2AAADjgKFABUAIgAAJRUjIicGIyE1MxE3ETYzMhcWFRUUMyc0JyYjIgcGByEyNjUDjitULiRQ/YmpPnXB',
    'cEI4b7I1LUR1W0UhAYgwJD4+NjY+AiQj/lzXTUJhGnCKVDMscVV3LTwAAAMAFAAAA6gChQAVACIAKgAAJRUjIicGIyE3MxE3ETYz',
    'MhcWFRUUMyc0JyYjIgcGByEyNjUDIjU0MzIVFAOoK1QuJFD9jSGEPnXBcEI4b7I1LUR1W0UhAYgwJKwpKSc+PjY2PgIkI/5c101C',
    'YRpwilQzLHFVdy08AYkqKCgqAAP/9gAAAv0ChQAOABsAIwAANzYzMhcWFRUUIyE1MxE3ATQnJiMiBwYHITI2NQMiNTQzMhUU3XXB',
    'cEI4kP2JqT4B3TUtRHVbRSEBiDAkrSkpJ+HXTUJhI6U+AiQj/kNUMyxxVXctPAGJKigoKgAAA//2AAADjgKFABUAIgAqAAAlFSMi',
    'JwYjITUzETcRNjMyFxYVFRQzJzQnJiMiBwYHITI2NQMiNTQzMhUUA44rVC4kUP2JqT51wXBCOG+yNS1EdVtFIQGIMCStKSknPj42',
    'Nj4CJCP+XNdNQmEacIpUMyxxVXctPAGJKigoKgAAAgBH/okCoQG4ACcAMAAAJQYHBwYGFRQWMzMyNxUGIyInJjU0NjcmJzU2MzIW',
    'FxUGBxYzMxUjIgMWFzY3JiMjIgE5ChcCUjdbSAJyRVJnbEA1RmpXYWiNQoIyRXQaHPL2O+9pUGdXUGwDZxkGDQEuQjdCVTM9NEc8',
    'VEdWOzuKKZJORidfWgY+ARCKKkhuaQAAAf/2AAAB9gG4ABcAACUVITUzJjU0NzY3MhcVJiMjIgYVFBcWMwH2/gCoP0U3Smc6PF4D',
    'PEsuLEo+Pj5AamU7LwFRQlZSQ00uLQAC//YAAALAAbgAFwAgAAAhIyInBiMjNTMyNyYnNTYzMhcVBgcWMzMlFhc2NyYjIyICwPc2',
    'ODk29vIUFU9daI2Mal1OFBTy/eBpUlFrUGwDZhcXPgM5gymSlCeDOQPTjCoqjWkAAwBH/okCoQKCAAcALwA4AAABIjU0MzIVFAMG',
    'BwcGBhUUFjMzMjcVBiMiJyY1NDY3Jic1NjMyFhcVBgcWMzMVIyIDFhc2NyYjIyIBQykpJzEKFwJSN1tIAnJFUmdsQDVGaldhaI1C',
    'gjJFdBoc8vY772lQZ1dQbANnAjAqKCgq/ekGDQEuQjdCVTM9NEc8VEdWOzuKKZJORidfWgY+ARCKKkhuaQAC//YAAAH2AoIABwAf',
    'AAABIjU0MzIVFBMVITUzJjU0NzY3MhcVJiMjIgYVFBcWMwEiKSknrf4AqD9FN0pnOjxeAzxLLixKAjAqKCgq/g4+PkBqZTsvAVFC',
    'VlJDTS4tAAAD//YAAALAAoIABwAfACgAAAEiNTQzMhUUASMiJwYjIzUzMjcmJzU2MzIXFQYHFjMzJRYXNjcmIyMiAVopKScBP/c2',
    'ODk29vIUFU9daI2Mal1OFBTy/eBpUlFrUGwDZgIwKigoKv3QFxc+AzmDKZKUJ4M5A9OMKiqNaQAAAwBaAAADxQJ/AAcAJAAzAAAB',
    'IjU0MzIVFBMzFSMiJwYjISImNTU3FRQzISY1NDc2MzIXFhUUBzY2NTQmIyIGFRQWFxc3ArMpKSc8r9oiHBwi/o1KWENuATlONjFQ',
    'WzIqszNAQDc3QUEzBAICLSooKCr+ET4HB11PgyOedkhlYTkzQjdUZT8SXDdCTU1BN10SAQEAAAP/9gAAAcoCgAAHABkAJAAAASI1',
    'NDMyFRQBNTMmNTQ3NjMyFxYVFQYHBiMTNCMiBhUUFjMyNQEmKSkn/qmqNzgxUVMtJwEwLExnZTg/PTNsAi4qKCgq/dI+N2dsOzU0',
    'LUthUS4sAQZ1U0tJVnAAA//2AAACNgJ/AAcAHQAsAAABIjU0MzIVFBMzFSMiJwYjIzUzJjU0NzYzMhcWFRQHNjY1NCYjIgYVFBYX',
    'FzcBGSkpJz+34iIcHCLiuE82MVBbMiqzM0FBNzdAQDMEAgItKigoKv4RPgcHPklkYTkzQjdUZT8SXTZCTU1BN10SAQEAAAQARv9C',
    'AvgCfwAHAA8AMQA7AAABIjU0MzIVFDMiNTQzMhUUEwYhIicmNTQ3NwYVFBcWMzI3JyYnJjU0NzYzMhcWFRUzFSc1NCMiBhUUFhcB',
    'rCkpJ0spKSdHGP70mk46LEEwPz1pyhUbjTw2ODFRUy0naq1kOT9VaQItKigoKiooKCr9075aQ2JWPg1JU1s2NYECBjk0Zmw7NTQt',
    'S84+Psh1VEpTRwQAAAT/9gAAAcoCfwAHAA8AIQAsAAATIjU0MzIVFDMiNTQzMhUUATUzJjU0NzYzMhcWFRUGBwYjEzQjIgYVFBYz',
    'MjXrKSknSykpJ/5yqjc4MVFTLScBMCxMZ2U4Pz0zbAItKigoKiooKCr90z43Z2w7NTQtS2FRLiwBBnVTS0lWcAAABP/2AAACNgJ/',
    'AAcADwAlADQAABMiNTQzMhUUMyI1NDMyFRQTMxUjIicGIyM1MyY1NDc2MzIXFhUUBzY2NTQmIyIGFRQWFxc33ikpJ0spKScIt+Ii',
    'HBwi4rhPNjFQWzIqszNBQTc3QEAzBAICLSooKCoqKCgq/hE+Bwc+SWRhOTNCN1RlPxJdNkJNTUE3XRIBAQACAFoAAAObAoUAFwAr',
    'AAAlMxUjIicGIyEiJjU1NxUUMyEyNRE3ERQBMhYVFAYjIzczMjU0IyIHNTczBwN5IitaLS1b/ptKWENuAU9tQ/6kKTAnIHwTZiY6',
    'HhVSKkU+Pj09XU+DI552dgGuI/4rcgGfLCUhJyMmLgwiXFAAAf/2AAABmwKFABoAABM2MzIXFhUVFAcGIyM1MzI1NTQnJiMiBzU3',
    'M5QKC1pAWDQtSPz1bTowSjY140UBnQEsP3UTVC8oPnUKUSgkE0L8AAAB//YAAAIiAoUAHwAAJTMVIyInBiMjNTMyNTU0JyYjIgc1',
    'NzMHNjMyFxYVFRQCCRkhWi0tW/z1bTwwSDY140XNCgtgQFI+Pj09PnUKUikiE0L86AExP3AOcgABAEb/QgLeAoUAHwAAJTMVIyIn',
    'BgcGIyInJjU0NzcGFRQXFjMyNzY1ETcRFRQCuyMrQCsITUVpgkY3LEIxOTZTYDUtQj4+IGo9N1lFYFc8D0hWWDg1OjBNAiwj/ioC',
    'bwAB//YAAADHAoUACwAAIzUzMjURNxEUBwYjChxyQzIvTT52Aa4j/i5VMS0AAAH/9gAAAVgChQAQAAAlMxUjIicGIyM1MzI1ETcR',
    'FAE1IytcLS9cIxxyQz4+Pz8+dgGuI/4rcgAAAgAU/sUCfQG4AB0AKAAAJTMVIyInBgcjIhUVBzU0NzY3JjU0NzYzMhcWFRUUJzU0',
    'IyIGFRQWMzICWyIrWS0uWn9uQzEsSS84MVFTLSdDZDk/PDVrPj48OwFypiPLUy8rATxibDs1NC1LXHJuWnVUSktUAAAC//YAAAHo',
    'AbgAFQAgAAATNDc2MzIXFhUUBwYjIicGIyM1MzI1FxQzMjY1NCYjIhWHMyxIXTIrNzBNXi4tWisjbkNsNDw/OWQBDFUvKEQ6Xms8',
    'NTw8PnIEblRLSlR1AAAC//b/7AKNAbgAGwAkAAAlMxUjIicGIyInBiMjNTMyNTU0NzYzMhcWFRUUBzI2NTQjIhUUAmsiK1stMmZn',
    'MS5bKyNuODFSXjErujdAd3g+Pj9TUj4+ciJzPTZGPGQichRbTqioqQACAEb/QgLUAhwABwAmAAABIjU0MzIVFAEzFSMiJwYHBiMi',
    'JyY1NDc3BhUUFxYzMjc2NRE3FRQBPykpJwFLIys+KQdNRGh/RjcsQTA5NVFfNCtDAcoqKCgq/nQ+HWk8NlpFYFY+DUlTWDk1OC5L',
    'AVgj/HIAAAL/9gAAAMsCggAHABMAABMiNTQzMhUUAzUzMjU1NxUUBwYjpCkpJ9UjbkMxLUsCMCooKCr90D5y2SP+VC8rAAAC//YA',
    'AAFbAoIABwAYAAATIjU0MzIVFBMzFSMiJwYjIzUzMjU1NxUUnSkpJ3QjK1otL1krI25DAjAqKCgq/g4+PT0+ctkj/HIAAAIAHgAA',
    'AhAB6AAVACIAACUzFSMiJwYjIicmNTQ3NjMyFzU3ERQDJiMiBhUUFjMyNyY1Ae4iK2sqNExWMio4MUhBLENDLD8yPz8zQSsCPj5U',
    'NkE3UmA6MyY2I/7IcgEFNVFAQU45EgsAA//2AAACGwHZABcAKAAyAAATNjYzMhcWFRUUBwYjIyInBiMjNTMmNTQFNTQnJiMiBzYz',
    'MhYVFAczMiU2NTQmIyIGFRRbFXVPZUM/NCxJYyMeHiGZgDYBmTovP1QsDw9ATjZGbP72WzEqKjIBJVNhR0RpOVUvKAoKPjZPOkkx',
    'WjQpQQNVRk82CR5gLzk4MGAAA//2AAACrQHZABwALQA3AAAlMxUjIicGIyMiJwYjIzUzJjU0NzY2MzIXFhUVFCMyNTU0JyYjIgc2',
    'MzIWFRQHJzY1NCYjIgYVFAKKIytbLS1bYyMeHiGZgDYbFXVPZUM/rmw6Lz9ULA8PQE42WFsxKioyPj49PQoKPjZPOihTYUdEaTVy',
    'djFaNClBA1VGTzYJHmAvOTgwYAACADz/QgIRAbgAHwApAAAlFSMGBgcGIyInNRYzMjc2NjUnJicmNTQ3NjMyFxYVFSc0IyIGFRQX',
    'FjMCEWoBU0IYHDo3NDMpHx8qVW83LTgyVFcuKENqO0GTLCc+PkJlEAccOxwSEEEgAwVBN1xsOzU0LUvOx3ZTS5UHAwAAAQBG/0IC',
    'kADiABkAACEGBwYjIicmNTQ3NwYVFBcWMzI3NjcjNzMVAo0IUk98mk46LEEwPzxqbT4uCGYgjVY1M1pDYlY+DUlTXDc1LiIyPj4A',
    'AAMARv6dApAA4gAZACEAKQAAIQYHBiMiJyY1NDc3BhUUFxYzMjc2NyM3MxUBIjU0MzIVFDMiNTQzMhUUAo0IUk98mk46LEEwPzxq',
    'bT4uCGYgjf6ZKSknSygoKFY1M1pDYlY+DUlTXDc1LiIyPj7+nSkpKSkpKSkpAAP/7v9FAMoBrAALABMAGwAAIzUzMjU1NxUUBwYj',
    'ByI1NDMyFRQzIjU0MzIVFAojbkMxLUsKKSknSykpJz5y2SP+VC8ruyooKCoqKCgqAAP/9v9FAVsBrAAQABgAIAAAJTMVIyInBiMj',
    'NTMyNTU3FRQHMhUUIyI1NDMyFRQjIjU0ATgjK1otL1krI25DdSgoKJooKCg+Pj09PnLZI/xypykpKSkpKSkpAAIAFAAAAgkChQAP',
    'ACEAAAE3ERQHBiMhNzMRNxEzMjUDBiMiJyYjIgcnNjMyFxYzMjcBx0IyLk3+uCCZQkZycx4kFx8WDBIXGh8jFBwYEBAZAmIj/i5V',
    'MS0+AaIj/jt2AbgwFQ8gEzETER8AAAIAFAAAApsChQAWACgAACUzFSMiJwYjITczETcRMzI1ETcVNxUUAwYjIicmIyIHJzYzMhcW',
    'MzI3AngjK1wtL1z+uCCZQkZyQgG2HiQXHxYMEhcaHyMUHBgQEBk+Pj8/PgGiI/47dgGuI9oB/HICLjAVDyATMRMRHwAAAgAUAAAC',
    'CQLiABMAIwAAAQcjNzMmNTQ2MzIXFSYjIgYVFBcXNxEUBwYjITczETcRMzI1ATkTmxMaCiodFhUUExAWDuZCMi5N/rggmUJGcgJ5',
    'JCQSEhwpDSYPFQ4RERcj/i5VMS0+AaIj/jt2AAACABQAAAKbAuIAEwAqAAABByM3MyY1NDYzMhcVJiMiBhUUFwEzFSMiJwYjITcz',
    'ETcRMzI1ETcVNxUUATkTmxMaCiodFhUUExAWDgGXIytcLS9c/rggmUJGckIBAnkkJBISHCkNJg8VDhER/cU+Pz8+AaIj/jt2Aa4j',
    '2gH8cgACABT/HgIJAoUADwAjAAABNxEUBwYjITczETcRMzI1AyYjIgYVFBczByM3MyY1NDYzMhcBx0IyLk3+uCCZQkZypxQTEBYO',
    'WBObExoKKh0WFQJiI/4uVTEtPgGiI/47dv7EDxUOEREkJBISHCkNAAIAFP8eApsChQAWACoAACUzFSMiJwYjITczETcRMzI1ETcV',
    'NxUUByYjIgYVFBczByM3MyY1NDYzMhcCeCMrXC0vXP64IJlCRnJCAeoUExAWDlgTmxMaCiodFhU+Pj8/PgGiI/47dgGuI9oB/HLG',
    'DxUOEREkJBISHCkNAAABABQAAAIJAoUADwAAATcRFAcGIyE3MxE3ETMyNQHHQjIuTf64IJlCRnICYiP+LlUxLT4BoiP+O3YAAQAU',
    'AAACmwKFABYAACUzFSMiJwYjITczETcRMzI1ETcVNxUUAngjK1wtL1z+uCCZQkZyQgE+Pj8/PgGiI/47dgGuI9oB/HIAAQAAASQA',
    'gAAQAAAAAAABAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAZACwAXACbAOgBKgE3AU4BZgGEAZgBtAHAAdIB4gIRAiMCSQJ+ApgCwwL9',
    'Aw8DWAORA7AD2gPuBAIEFARMBKUEvgT2BR8FSQVfBXIFnwW2BcMF2gXzBgEGKAZDBnYGmAbQBvkHKwc9B1YHaQeJB6UHuQfRB+IH',
    '8QgCCBUIIggvCF0IjAi1COUJFAk0CXEJjQmqCdIJ6gn3CicKRApzCqMK0wruCyMLRAtlC3YLkQuqC8sL4gwSDB8MUAxxDIEMqwy3',
    'DMMM9w0eDVMNfw3IDd0N/w45DmYOjA60DwkPLw+PD5wPww/9EDAQbBCyEO4RNBFLEW0RiRGvEfYSWhKpEwMTMBNnE6MT6RP0FDUU',
    'jBTFFOwVHxVQFXYVsRX2Fk4WYxaPFqMWsBbTFuAXBxcnF0YXZheGF5MXoBe0F9wYCBg6GE8YYhh1GJ8YvBkjGUEZTRmHGdoZ/hoz',
    'GmgasRrxGyIbWRu2HAAcVBxkHHQcjRymHMkc6x0AHRsdZR29HgkePR5rHq8e3B8JH1MfsR/NH+kgZSCUIMUhHiFOIZIhwiH3Ig0i',
    'OyJZIn0ixCL8IyUjUyOVI8cj/yRRJHckrCT0JRElPCWPJbgl7iYOJjkmYCaRJt0nDydGJ7AoAShWKKko5CkjKYEpxyoRKkYqcyqo',
    'KucrHitdK6Uryiv8LE4sfiy8LQYtPS1+LdIuEi5bLpkuwS7uLx4vNC9QL4ovui/tMCcwRzBsMKAw6DE0MXIxmzHXMf4yKzJhMp4y',
    '1TMUM0sziTOmM8oAAAABAAAAAbMzxeqVKF8PPPUAAwPoAAAAANbecNMAAAAA1uANOv+j/okFegPjAAAAAwACAAAAAAAAAPAAGADw',
    'AAAA2ABCARQARgHxAA8CFABEArwAMgIxADwAvgBGAXAAWwFwAEoBTAAdAgYAKgDEAC0BFAAZAQgAWgFH/+cCKAAwAXcAHgHgADIB',
    '8AAvAikAIwIDAD4CCwA+AacAKgIYAD4CCwBDAOAAWgC6ACoCBQAqAf0AKgIFADQBggAqAroAMAIxAA8CGABaAiwAMgJnAFoCDgBW',
    'AgEAVgJSADICiQBaAP4AWgDu/6sCBQBaAdQAWgMEAFoCfgBaAoQAMgIGAFoChAAyAgkAWgH6ADMCDgAZAngAWgIjAA8DaAAPAjQA',
    'DwISAA8B0QAZAV0AWwFH/9oBXQBIAZcAIwGKAAUAsQAZAecAMAIVAE4B1wAwAhUAMAHvADABUAAqAhoANQIVAE4A6ABJAOv/wAG+',
    'AE4A3wBOAz4ATgIVAE4CFQAwAhsATgIaADABiABOAZ8AMAFvACoCCgBOAbkADwK0AA8BqwANAckADwGaABkBeQAwAPIAWgF5ADkB',
    '4wAqAR8ARgIzAFoBfQBGAm4ARgI4ACoCLgAqAz8ATAM0AEwDWgBMANsAQQDkAFMBrQAwAgEAIwD3AA4A9wAjAe0APAD3ACECyQA6',
    'APcAWgNlAFoCAABIA2UAWgNlAFoCbgBGAm4ARgJuAEYBwQAKAcEACgE3/6MBN/+jBSYARgUmAEYFMQBGBTEARgNfABQDXwAUAikA',
    'RgIpAEYAdP/2A6cAWgLeAEYDZABaAqMARgI8ABQCnQBGAgAARgHtADwCyQBGAskARgAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAA',
    'AAAAAAABAAAAAwAA//8AAP//AOMAKADPAEYBgwBBAisARgF+ACgBsQAkAYMAGQHfABQB3wAUAZYAIwKFAGQBVgBKA2UAWgAAAAAD',
    'ZQBaA6cAWgOSAFoAAAABAp8AKgOHACoDkgBaAST/8QFR//YDuwBaAhr/9gIs//YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABJP/2',
    'AVH/9gPKAEYDnQBGAAAACAAAAAAAAAACAAAAAgAAAAAAAAA4A8oARgPKAEYBhQA8AYUAcgVmAB4BJAAOASQAIwIHADwBJABSAnkA',
    'RgET//YBUf/2ASQAWgN+AFoBJP/2AVH/9gIGAB4DfgBaAST/9gFR//YDfgBaAST/9gFR//YCrABGAir/9gKH//YCwABGAir/9gKH',
    '//YCwABGAir/9gKH//YCAwAKAgMACgFl/6MBZf+jBW4ARgPI//YEEP/2BW4ARgPI//YEEP/2BXAARgO4//YD9//2BXAARgO4//YD',
    '9//2A54AFANF//YDhP/2A54AFANF//YDhP/2ApcARwIo//YCtv/2ApcARwIo//YCtv/2A7sAWgIa//YCLP/2Au4ARgIa//YCLP/2',
    'A5EAWgHX//YCGP/2AtQARgEh//YBTv/2AnMAFAIz//YCg//2AsoARgEk//YBUf/2AgYAHgJk//YCo//2AgcAPAJ5AEYCeQBGAST/',
    '7gFR//YCYwAUApEAFAJjABQCkQAUAmMAFAKRABQCYwAUApEAFAABAAACg/6bAMgFcP+j/vgFegABAAAAAAAAAAAAAAAAAAABJAAD',
    'AaUBkAAFAAACigJYAAAASwKKAlgAAAFeADIAVwAAAAAFAAAAAAAAAIAAIAOAAAAAAAAACAAAAAAxYm91AEAAIP78AoP+mwDIA/gB',
    'dwAAAEAAAAAAAcYCeSAiACAAAgAAAAIAAAADAAAAFAADAAEAAAAUAAQB8AAAAHgAQAAFADgAfgCgBgwGGwYfBjoGVQZqBm4GcAZ+',
    'BqQgFCAiICb7Wftt+7f76fxa/GP8lv0//fL+gv6E/ob+iP6M/o7+kv6U/pj+nP6g/qT+qP6q/qz+rv6w/rT+uP68/sD+xP7I/sz+',
    '0P7U/tj+3P7g/uT+6P7s/u7+8P78//8AAAAgAKAGDAYbBh8GIQZABmAGbQZwBn4GpCATICIgJvtX+2v7svvo/Fn8XvyV/T798v6C',
    '/oT+hv6I/or+jv6Q/pT+lv6a/p7+ov6m/qr+rP6u/rD+sv62/rr+vv7C/sb+yv7O/tL+1v7a/t7+4v7m/ur+7v7w/vL////h/2H6',
    'XfpP+kz6S/pG+jz6Ovo5+iz6B+BP4D7gOwVZBUgFBATUBGUEYgQxA4oC2AJJAkgCRwJGAkUCRAJDAkICQQJAAj8CPgI9AjwCOwI6',
    'AjkCOAI3AjYCNQI0AjMCMgIxAjACLwIuAi0CLAIrAioCKQIoAicAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAALEwALgBJBiFjR0AAAAAAAcAWgADAAEECQAAAG4AAAADAAEECQABAA4AbgADAAEECQACAA4AfAADAAEECQADADQA',
    'igADAAEECQAEAA4AbgADAAEECQAFABoAvgADAAEECQAGAB4A2AAoAGMAKQAgADIAMAAxADcAIABiAHkAIABCAG8AdQB0AHIAbwBz',
    'ACAASQBuAHQAZQByAG4AYQB0AGkAbwBuAGEAbAAuACAAQQBsAGwAIAByAGkAZwBoAHQAcwAgAHIAZQBzAGUAcgB2AGUAZAAuAFQA',
    'YQBqAGEAdwBhAGwAUgBlAGcAdQBsAGEAcgAxAC4AMAAwADAAOwAxAGIAbwB1ADsAVABhAGoAYQB3AGEAbAAtAFIAZQBnAHUAbABh',
    'AHIAVgBlAHIAcwBpAG8AbgAgADEALgA3ADAAMABUAGEAagBhAHcAYQBsAC0AUgBlAGcAdQBsAGEAcgADAAAAAAAA/7UAMgAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAAEAAgAIAAL//wAPAAEAAAAMAAAAAAAAAAIACwBsAIUAAQCHAJAAAQCRAJsAAwCoAKgAAQCpAKkAAwCq',
    'AKsAAQCtAK0AAwCwALUAAQC2ALsAAwDAAMUAAwDKASMAAQAAAAEAAAAKACIATgABREZMVAAIAAQAAAAA//8AAwAAAAEAAgADa2Vy',
    'bgAUbWFyawAcbWttawAkAAAAAgAAAAEAAAACAAIAAwAAAAIABAAFAAYADgfgCNwO3BD2EY4AAgAAAAIACgXcAAEAcgAEAAAANADc',
    'APIA+AEGAQwBbgEqATABbgE+AUQBbgF4Aa4BvAHWAfQCGgIgAjYCcAKaArQC6gL4AxYDNAOCA4gDygQABCIFqgRUBFoE9gRoBHoE',
    'kASaBKAEpgSwBPYE/AUaBVAFfgWEBaoFwAXAAAIAEQAJAAkAAAANABEAAQAUABgABgAaABoACwAiACUADAAnACgAEAArAC0AEgAw',
    'ADoAFQA8ADwAIABCAEQAIQBHAEcAJABMAEwAJQBOAFEAJgBTAFUAKgBXAFoALQBcAFwAMQBiAGMAMgAFACsASwBH/+cASwBBAGT/',
    '5wBl/+cAAQAS/+cAAwAS/90AGP/nADr/vwABABL/3QAHADcAbgA4AG4AOQA3ADoAbgA7AC0ASgBBAEsAQQABABj/9gADABL/5wBi',
    'ACMAYwAjAAEAYwAZAAoADf+/AA7/5wAP/8kAEgAZABQACgAV/8kAGAAZABv/8QAc//EAYv/nAAIAYgAZAGMAGQANACT/7AAo/+wA',
    'Mv/sADX/vwA3/9MAOP/dAET/9gBF//EASP/xAFL/8QBV/+cAV//sAFj/7AADACL/7AA5/+cAOv/2AAYAJP/sAEL/9gBE/+cARv/n',
    'AFD/5wBW//sABwAi/+cANf/xADf/7AA4/+wAOf/dADr/yQBZ/+cACQAN/7UAD/+1ACL/2ABC/9MARP/YAEb/2ABQ/9gAU//sAFb/',
    '7AABACIACgAFAET/9gBG//YASv/2AFD/9gBW/+wADgAiAAoAJP/nACj/5wAw/+cAMv/nADoADwBC//EARP/iAEb/4gBK/+wAUP/i',
    'AFb/7ABX/9MAWP/xAAoAIgAPACT/5wAo//EAMP/xADL/8QA1/78ANv/TADf/zgA4/9MAOv/JAAYAD//2ADX/3QA3//EAOP/7ADn/',
    '5wBZ/+cADQAN/7UAD/+1ABD/5wAi/78AOv/xAEL/7ABE/+IARf/iAEb/4gBI/+IAUP/iAFL/4gBU/+IAAwA3//YAOP/2ADr/7AAH',
    'ACIADwA6//YARP/xAEb/8QBQ//EAVv/2AFoAFAAHACT/8QAo//YAMv/2ADX/8QBX/+cAWP/nAFr/7AATAA3/pgAP/6YAIv/JACT/',
    '7AAo/+wAMP/sADL/7AA4ABQAOwAUAEL/0wBE/78ARv+/AFD/vwBU/8kAVv/JAFf/5wBY//YAWv/2AFv/8QABAA//5wAQAA3/tQAP',
    '/7UAEP/sACL/yQAk//YAKP/2ADD/9gAy//YANwAKADgACgA6AAoAQv/dAET/0wBG/9MAUP/TAFb/8QANAA3/vwAP/78AIv/TADL/',
    '7AA3AAoAOAAKADoACgBC/90ARP/dAEb/3QBQ/90AU//nAFb/5wAIABAANwAk//EAKP/xADD/8QAy/+cARP/sAEb/7ABQ/+wADAAO',
    '/78AD/+/ABD/7AAk/+wAKP/sADL/7AA3AAoAOAAKAET/vwBX/+cAYv+/AGP/vwABAFj/9gADAA3/5wAP/+cAVP/xAAQARP/sAEX/',
    '8QBI//EAUv/xAAUARP/nAEb/5wBI//YAUP/nAFb/9gACAFf/9gBY//YAAQBV//YAAQBX//EAAgAN/+cAVP/xABEADf+1AA//yQBC',
    '/+wARP/nAEX/7ABG/+cASP/sAEr/9gBO//YAT//2AFD/5wBS/+wAVP/xAFb/8QBXABkAWAAZAFoADwABAET/9gAHAET/9gBF//YA',
    'Rv/2AEj/9gBQ//YAUv/2AFsACgANAA3/yQAP/9MAOAAKAEL/9gBE//YARf/2AEb/9gBI//YAUP/2AFL/9gBXAAoAWAAKAFoACgAL',
    'AA3/yQBC//YARP/2AEX/9gBG//YASP/2AFD/9gBS//YAVwAKAFgACgBaAAoAAQBaAA8ACQAP/90AQ//2AET/9gBF//EASP/xAFL/',
    '8QBXAAoAWAAKAFoACgAFACsASwBH/+cASwA3AGT/5wBl/+cABAARABkAFQAjABcAGQA6/78AAgFIAAQAAAFkAaoADAANAAD/7P/2',
    '//b/9v/x/8kAFAAAAAAAAAAAAAAAAP/2AAAAAAAAAAAAAAAA//b/0wAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/5//x/+cAAAAAAAD/',
    '7P+//78AAAAAAAoAAP/J//b/v//JAAAAAAAAAAAAAAAA/+cAAAAAAAAAAAAAAAAAAAAAAAD/9v/2AAAAAAAAAAAAAAAAAAAAAP/2',
    'AAAAAAAAAAAAAAAA//EAAP/xAAD/9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//b/9gAAAAAAAAAAAAAAAP/d//YAAAAAAAD/7P/sAAAAAAAAAAAAAAAA',
    'AAAAAAAAAAEADAANACIAMAA0ADYAOgBCAEYARwBQAFQAWgACAAsADQANAAQAMAAwAAYANAA0AAEANgA2AAIAOgA6AAMAQgBCAAcA',
    'RgBGAAgARwBHAAsAUABQAAkAVABUAAUAWgBaAAoAAgAMAA0ADQAKACIAIgAIADAAMAABADQANAAJADYANgAFADoAOgAGADsAOwAH',
    'AEIAQgALAEYARgACAFAAUAADAFQAVAAMAFYAVgAEAAIACQACAAoALAABAHIABQAAAAQAEgASABoAGgABAHAAeAB4AAEAcABkAGQA',
    'AgBQAAUAAABcAHIABAAEAAAAAAAeAB4AQQBBAFoAWgAAAAAAHgAeAEEAQQBaAFoAAAAAAB4AHgBBAEEAWgBaAAAAAAAeAB4AQQBB',
    'AFoAWgABAAQAfAB9AOgA6QACAAMAfQB9AAIA6ADoAAEA6QDpAAMAAgAPAG0AbwACAHEAcQADAHIAcgACAHwAfQACAIQAhQABAIgA',
    'iAACAIoAigACAIwAjAACAI4AjgACAI8AkAADANQA1AACAN4A3gABAOEA4QABAOQA5AABARoBGgACAAQAAQABAAgAAQYMAAwAAgAu',
    'APIAAgAFAGwAhQAAAIcAkAAaAKgAqAAkALwAvQAlAMsBGwAnABcAAQBeAAEAZAAAAGoAAQBwAAEGhgAAAHYAAQmAAAEAfAABAIIA',
    'AQCIAAAAjgABBqoAAQmAAAEAlAABAJoAAACgAAEApgAAAKwAAQCyAAEAuAABAL4AAQmAAAEJgAABAIYCLwABAIwCNQABAGz/egAB',
    'AIACJQABAFD/nAABAFkCJQABAJICmgABAHICmAABAFX/nAABAFACZwABAIQCggABAFf/dAABAIUCOwABAE3/sgABAKwCKQABAJQC',
    'LwABAIkCHQB4AeIB6AHuApAB7gKcBMoB9AH6AgACrgIGAgwCzAISAhgEvgIeAvYCJAL2AioDJgMaAxQDGgMmAywDRAM+A0QDSgIw',
    'BQADVgNcA54CNgN0AjwDngJCA54CSAPCA7YDwgPIA9oCTgPyAlQETAJaBC4ENARMBFIElARqBIgEjgJgAmYEvgJsBMoE0ATWAnIE',
    '4gJyBEwCeAJ+AooChAKKApYCkAKWApwEygKiAqgCzAKuArQEoAK6BKwCwALGAswC0gLYBO4E9AT6BQAEvgLeAvYC5ASgAuoErALw',
    'AvYC/ASgAwIErAMIAxQDGgMOAyADDgMgAxQDGgMyAyADMgMgAyYDLAMyAzgDMgM4A0QDPgNEA0oDVgNQA1YDXAOeA2IDaANuA2gD',
    'bgN0A3oDgAOGA4ADhgOeA4wDqgOYA5IDmAOeA6QDqgOwA6oDsAPCA7YDzgO8A84DvAPCA8gDzgPUA84D1APaA+AD/gPmBAoD7APy',
    'A/gD/gQEBAoEEAQWBBwEQAQiBEAEKAQuBDQEQAQ6BEAERgRMBFIEWARkBF4EZASUBGoEoARwBKwEdgSIBI4EfASCBIgEjgSUBJoE',
    'oASmBKwEsgS+BLgEvgTEBL4ExATKBNAE1gTcBOIE6ATuBPQE+gUAAAEA/P+JAAEBJAHoAAEAXv+1AAEBCALuAAEAZP7UAAEAkAK+',
    'AAEAzAI1AAEAcv+1AAEBmf7yAAEB1QHRAAEBEgLcAAEBxAKBAAEBugLYAAEAOf7UAAEBawIZAAEBdwIsAAEBigH5AAEBbAI6AAEB',
    'QwI1AAEBVgLoAAEC2QLrAAEBKf7UAAEBbQKKAAEBKgI1AAEB8AI1AAEB+QHRAAEAmv+SAAEArv+SAAEAuAI1AAEAmgM5AAEAgv+1',
    'AAEApAN1AAEBAgLoAAEAqv7UAAEBW/7UAAEA/gI1AAEAlQMMAAEAvwMMAAEArv+1AAEApAK+AAEBkP7yAAEBsQHRAAEBHALcAAEB',
    'rAKBAAEAnwLuAAEAvwLuAAEBmv9iAAEBxgLkAAEAmwMlAAEAzQMlAAEA9v7yAAEBJ/41AAEBZgI1AAEBKQI1AAEBI/5EAAEBcALt',
    'AAEBFP+SAAEBNQLtAAEA9QI1AAEAuf+SAAEA/wLtAAEAvgI1AAEAKv7UAAEAyALuAAEBawH7AAEB+P+SAAECJgINAAEDdf+SAAEB',
    'gwJVAAECDP+SAAECGgMCAAEBlgHWAAECKv+SAAECpgI1AAEDYf+SAAEBfgJAAAECFv+SAAECngLtAAECOQI1AAECLgI1AAEBvf+S',
    'AAECOALuAAEBsv+SAAECLgLuAAEBMv5KAAEBVgI1AAEBPAI1AAEBdgI1AAEBHv5KAAEBYALoAAEBO/+SAAEBPgLoAAEBWf+SAAEB',
    'bgLoAAEB0/+SAAEBigJuAAEBSQLrAAEBPwLrAAEBb/7UAAECCgLZAAEBSALrAAEBJ/+SAAEBPgLrAAEBwf+SAAEByAKFAAEA2/+S',
    'AAEBCf+SAAEA9QLVAAEBHAHFAAEApQK+AAEAxQK+AAEBKv+SAAEBSAIpAAEBPv+SAAEBYAIpAAEBPf7UAAEBTwKKAAEAQf+NAAEA',
    'rQLuAAEAl/+NAAEAsQLoAAEBKAI1AAEA+f+NAAEBRgI1AAEA9P7UAAEBDwI1AAEBZP7WAAEBUgFhAAEBWP4nAAEBdQFhAAEAVP7y',
    'AAEApQI1AAEAjv7yAAEAzQI1AAUAAQABAAgAAQAMADQAAgA+AQ4AAgAGAJEAmwAAAKkAqQALAK0ArQAMALYAtgANALgAuwAOAMAA',
    'xAASAAIAAQEcASMAAAAXAAAAXgAAAGQAAQBqAAAAcAAAAHYAAQB8AAADcAAAAIIAAACIAAAAjgABAJQAAACaAAAAoAAAAKYAAACs',
    'AAEAsgAAALgAAQC+AAAAxAAAAMoAAANwAAADcAAAA3AAAQB6AikAAQCYAhcAAQBa/8wAAQCMAg0AAQCMAhcAAQBQ/6oAAQBTAhMA',
    'AQCSAoIAAQB4AoYAAQA+/7IAAQAtAqcAAQB8Ah0AAQA5AkIAAQBvAlgAAQA//4cAAQB0AhUAAQBA/6cAAQCOAhcAAQCCAh0ACAAS',
    'ACgARABmAIgApADAAOIAAgAKAL4AEADKAAEB3ALKAAEA+ALSAAIACgAQABYAtAABAe4CvgABAcD/tQABAP4C0gACAAoAEAAWABwA',
    'AQHmAvAAAQGt/7UAAQD6AxcAAQDW/7UAAgAKABAAFgAcAAEB4AL2AAEBs/+1AAEA+gMFAAEA0v+1AAIAQgAKABAAFgABAY7/SgAB',
    'AOkCaQABANT+9gACACYACgAQABYAAQGu/20AAQDvAmkAAQDO/vAAAgAKABAAFgAcAAEB6AK+AAEBlP+1AAEA/gJpAAEAv/+1AAIA',
    'CgAQABYAHAABAd0CsAABAbn/tQABAQYCXwABAMb/tQAGAAAAAQAIAAEADAAaAAEAKgBeAAEABQCTAJYAmwC5ALsAAQAGAJMAlgCb',
    'ALcAuQC7AAUAAAAWAAAAHAAAACIAAAAoAAAALgABAFoBnQABAFABxgABAEkByQABAFEB0gABAEwBogAGAA4AFAAaACAAJgAsAAEA',
    'WgDwAAEAVAE5AAEAPwEEAAEADgEVAAEASwECAAEARgDFAAYAAAABAAgAAQAMADQAAQBeAQIAAQASAJEAkgCUAJUAlwCYAJkAmgCp',
    'AK0AtgC4ALoAwADBAMIAwwDEAAEAEwCRAJIAlACVAJcAmACZAJoAqQCtALYAtwC4ALoAwADBAMIAwwDEABIAAABWAAAASgAAAFAA',
    'AABWAAAAXAAAAGIAAABoAAAAbgAAAHQAAAB6AAAAgAAAAIYAAACMAAAAkgAAAJ4AAACeAAAAmAAAAJ4AAQCMAf8AAQCAAgEAAQCG',
    'AgsAAQCCAf8AAQBZAfsAAQCMAlIAAQBsAlYAAQAnAnEAAQB2AfkAAQA/AiMAAQB0AjsAAQB/Ag0AAQCTAhcAAQCIAgsAAQCCAhcA',
    'EwAoAC4ANAA6AEAARgBMAFIAWABeAGQAagBwAHYAiAB8AIIAiACOAAEAkQLPAAEAjALKAAEAjgJ/AAEAjALWAAEAjAKnAAEAZAK0',
    'AAEAlgLsAAEAfgMiAAEALQM4AAEAjgNvAAEAMwK1AAEALP+QAAEAegLFAAEAdAL8AAEAiANeAAEAggMVAAEAggN3AAEAggMOAAAA',
    'AQAAAAoAOgCqAANERkxUABRhcmFiABRsYXRuABQABAAAAAD//wAJAAAAAQACAAMABAAFAAYABwAIAAlhYWx0ADhjY21wAEBkbGln',
    'AEZmaW5hAExmcmFjAFJpbml0AFhsaWdhAF5tZWRpAGRybGlnAGoAAAACAAAAAQAAAAEAAgAAAAEABwAAAAEABQAAAAEACQAAAAEA',
    'AwAAAAEACAAAAAEABAAAAAEABgAKABYAJgA2AOQBJgGWAjYCmAK8AvYABwAAAAEACAABAAEAAAMUAAcAAAABAAgAAQADAAADTgAE',
    'AAAAAQAIAAEAlgAIABYAIAAqADQAPgBIAFIAjAABAAQArQACAJcAAQAEAMAAAgCXAAEABADBAAIAlwABAAQAwgACAJcAAQAEAMMA',
    'AgCXAAEABADEAAIAlwAHABAAFgAcACIAKAAuADQArQACAJEAwAACAJIAwQACAJMAwgACAJQAwwACAJUAxAACAJYAxQACAKkAAQAE',
    'AMUAAgCXAAIAAgCRAJcAAACpAKkABwABAAAAAQAIAAIAfAAaANAA1ADYANsA3gDhAOQA6wDuAPEA9AD3APoA/QEAAQMBBgEJAQwB',
    'DwESARUAvAEaALEAtAABAAAAAQAIAAIAOgAaANEA1QDZANwA3wDiAOUA7ADvAPIA9QD4APsA/gEBAQQBBwEKAQ0BEAETARYAvQEb',
    'ALIAtQACAAcAcQBxAAAAcwBzAAEAdQB5AAIAfgCFAAcAhwCNAA8AjwCQABYAqgCrABgAAQAAAAEACAACAF4ALADLAMwAzQDOAM8A',
    '0gDTANYA1wDaAN0A4ADjAOYA5wDoAOkA6gDtAPAA8wD2APkA/AD/AQIBBQEIAQsBDgERARQBFwEYARkArACwALMAxgDHAR0BHwEh',
    'ASMAAgAJAG0AhQAAAIcAkAAZAKgAqAAjAKoAqwAkAL4AvwAmARwBHAAoAR4BHgApASABIAAqASIBIgArAAQAAAABAAgAAQBQAAMA',
    'agAMAC4ABAAKABAAFgAcARwAAgDLAR4AAgDMASAAAgDOASIAAgDSAAQACgAQABYAHAEdAAIAywEfAAIAzAEhAAIAzgEjAAIA0gAB',
    'AAMAcgEMAQ0ABAAAAAEACAABABYAAQAIAAEABADKAAQBDAENARQAAQABAHIABAAAAAEACAABACwAAQAIAAQACgASABgAHgCvAAMA',
    'RwBKAK4AAgBHAGQAAgBKAGUAAgBNAAEAAQBHAAQAAAABAAgAAQAsAAIACgAgAAIABgAOAGYAAwAQABMAZwADABAAFQABAAQAaAAD',
    'ABAAFQABAAIAEgAUAAIAJgAQAMsAzADNAM4A0gDWAOYA5wDoAOkBFwEYAR0BHwEhASMAAQAQAG0AbgBvAHAAcgB0AHoAewB8AH0A',
    'jgCPARwBHgEgASIAAQD2ABgANgA+AEYATgBWAF4AZgBuAHYAfgCGAI4AlgCeAKYArgC2AL4AxgDOANYA3gDmAO4AAwDQANEAzwAD',
    'ANQA1QDTAAMA2ADZANcAAwDbANwA2gADAN4A3wDdAAMA4QDiAOAAAwDkAOUA4wADAOsA7ADqAAMA7gDvAO0AAwDxAPIA8AADAPQA',
    '9QDzAAMA9wD4APYAAwD6APsA+QADAP0A/gD8AAMBAAEBAP8AAwEDAQQBAgADAQYBBwEFAAMBCQEKAQgAAwEMAQ0BCwADAQ8BEAEO',
    'AAMBEgETAREAAwEVARYBFAADARoBGwEZAAMAvAC9AKwAAgAHAHEAcQAAAHMAcwABAHUAeQACAH4AhQAHAIcAjQAPAJAAkAAWAKgA',
    'qAAXAAA='
].join('');

const ARABIC_FONT_BOLD_B64 = [
    'AAEAAAAPAIAAAwBwR0RFRgg9B/gAAH0UAAAAUkdQT1Nyw+aaAAB9aAAAEepHU1VC4rLj+AAAj1QAAAYCT1MvMqGKZEoAAHk4AAAA',
    'YGNtYXAxZVQuAAB5mAAAAgRnYXNwAAgAEwAAfQgAAAAMZ2x5ZmuNhdYAAAD8AABwrmhlYWQRvXC3AAB0KAAAADZoaGVhCDQECwAA',
    'eRQAAAAkaG10eITlHMkAAHRgAAAEtGxvY2G4QNSuAABxzAAAAlxtYXhwCT4AgQAAcawAAAAgbmFtZRfaMBUAAHuoAAABPnBvc3T/',
    '/wADAAB86AAAACBwcmVwP3EZPQAAe5wAAAAKAAIAQ//qANcCeQADABIAADcRMxEXFBUUBiMiJjU1NjYzMhZKfg8oISIpAikgISix',
    'Acj+OH0BASAoKSICHyYoAAACAEYBsQEeAoUAAwAHAAATNTcVFzU3FUZaI1sBsaMxozGjMaMAAAIABQAAAdgCYQAcACAAACUHIzcj',
    'ByM2NyM1MzcjNTM3MwczNzMHMxUjBzMVJwczNwFJHVYeWBxXDRBBVBtRaCFWIVUkVSJLYRtb7RpWHIODg4M/RGV3ZJ6enp5kd2Xc',
    'd3cAAwBA/7YB8wK8ACEAJgArAAABFRYXByYnFRYVFAcGBxUjNSYnNjc2NxYWMzUmJjU0Njc1EzY1NCcDBhUUFwEqX1o4SjfJQTVT',
    'MVdiChYRCQpgFV5PXVAxPj4xJSUCvDgDPFEfAo1Nhl80KwI/Pwk9Dx0WDQgYsiVXQUZaCTr9rwU/NSABEA8sJBgABQA0//0C2QJN',
    'AAMADwAbACcAMwAAMwEzARMUBiMiJjU0NjMyFgc0JiMiBhUUFjMyNgUUBiMiJjU0NjMyFgc0JiMiBhUUFjMyNsEBL2L+0Q5EOTxE',
    'RTs3RkkfFxcfHhgYHgHxRDk8REU7N0ZKHhcYHh4YFx4CTf2zAa1LWldNSVRXRyc1NCgrNzfeS1pYTElVWEcnNTMpKzc3AAIAJv/0',
    'AisChQAtADcAAAEzFRQHFhcjJicmJwYjIicmNTQ3JjU0NjMyFwYHBgcmIyIGFRQXFhcWFxYXNjUHBhUUMzI3JicmAXF+Mi5AkAYI',
    'Cgc0ZGI0KFxIWk5PVQsaCAU5NB0kJAYEEyA+IAyxGUoqFREkKQFJJ11NNEQGCwwHMD4vQ2dLSElJVUAQJw0HHh4YHysHBRcoTiUT',
    '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',
    'JjU0NjMyFhUUEwYjIicmNTQ3JjU0NzYzMhcVJiMGBhUUFjMzFSMiBhUUFjMyNwE+HiQkHh4jlFdqe0xFXU1KO09tQEdaLjVFPLOx',
    'R09TR2FYAiEkHx0kIx5D/KA4TERqeEM/dmk/MlxvVgE5Lzc/eUI7O0Y2AAAB/+IAAACSAHkAAwAAIzUzFR6weXkAAwBaAAADhAKY',
    'AAoAJQAvAAABIiY1NDYzMhYVFAEiJyY1NTcVFBYzMyY1NDc2MzIXFhUVFAcGIxM0IyIGFRQzMjUC2B4kJB4eI/4FXjcvfiYu+B48',
    'NVdZMiszMlM6OCQpSjsCFCQfHSQjHkP97EA4VmVDoDMqKkRuQDg5MU9aVjMxARZCOjNyQQAABABG/0ICuwKYAAkAEwA1AD8AAAEi',
    'JjU0MzIWFRQzIiY1NDMyFhUUExQHBiMiJyY1NDc3BhUUFxYzMjcGIyInJjU0NzYzMhcWFSc0IyIGFRQzMjcBuR4kQh4jWR4kQh4j',
    'J1pTkKZUPiV4KDIyX6oQFiVcNy08NVdZMit+OCQpTCkQAhQkH0EjHkMkH0EjHkP+LHtEP19HZ087GURLTywtag5GOlFuPzg5MU8C',
    'QjoyahYAAAIAWgAAAycChQAVACYAAAE3ERQHBiMhIicmNTU3FRQWMyEyNjUDFhUUIyM3MzI1NCMiBzU3MwKqfTkxTv6bVTArfSEm',
    'AUYmIM9IT5QfbxstHhpWSQJDQv41WzMsOTJPZkKgKCEiJwEyDElSOhsiEDJfAAEARv9BAnoChQAVAAAlFAcGIyInJjU0NzcGFRQW',
    'MzI2NRE3AnpYTnaOTjwkfClXSklWfVOATkReSGNOPBxBVEpXUkcB70MAAAIAFP7FAh8BzQAYACIAABM1NDc2NyY1NDc2MzIXFhUV',
    'BgYHIyIGFRUBNCMiBhUUMzI1FDIsShs8NVdZMisBYlmLJiABDzgkKUs6/sX5VTMsBipFbkA4OTFPd0pSASEnsQIPQjozcjgAAgBG',
    '/0ICYQI1AAoAIQAAASImNTQ2MzIWFRQTFAcGIyInJjU0NzcGFRQXFjMyNjURNwFMHiQkHh4j1FNKc4dKOiV4KCspQkVNfgGxJB8d',
    'JCMeQ/6PeEc/X0pkTzsZREtMLy1GPwE6QgACAEYAAAHXAc0ADwAYAAAhIicmNTQ2NxYXFhUUBwYjJzMyNTQnBhUUAQlfNi5oYGY0',
    'Lzw0VAsNRk1MQDdWWoYgIklAVWM4MnlTXywsXVUAAAIAPP9EAboBzQAZACMAACUGIyInJjU0NzYzMhcWFRUUBwYjIic1FjMyEzQj',
    'IgYVFDMyNwE8HyFcNy08NVdZMis+OmQ/PDY2YQ05JClMKBIdBkU6Um4/ODkxT9Z2REAibR8BYkI6MmoUAAABAEb/QgK3AcQALgAA',
    'ASYjIgYVFBYXFhcWFRQHBiMiJyY1NDc3BhUUFxYzMjc2NTQmJyYnJjU0NzYzMhcCg0hCHycvRkYcLV9VhaZUPiV4KDIyX2AyKiM2',
    'VyEtPS49ZjkBEkIjHSQoGRcXJUJnPDVfR2dPOxlES08sLR4aKBUbEx8hLUpYMSZHAAADAEb+ZQK3AcQALgA5AEMAAAEmIyIGFRQW',
    'FxYXFhUUBwYjIicmNTQ3NwYVFBcWMzI3NjU0JicmJyY1NDc2MzIXASImNTQ2MzIWFRQzIiY1NDMyFhUUAoNIQh8nL0ZGHC1fVYWm',
    'VD4leCgyMl9gMiojNlchLT0uPWY5/rgeJCQeHiNZHiRCHiMBEkIjHSQoGRcXJUJnPDVfR2dPOxlES08sLR4aKBUbEx8hLUpYMSZH',
    '/OglHh0kIx5DJB9BIx5DAAACAAACNQFMA1IAAwAHAAATNyUHBTclBxctAQgt/uEtAQctAsJgMGC9YS9gAAIAAQJFAV8DMwAVAB0A',
    'ABMmNTQ2MzIWFRQGIyInByc3MxYzMjM3NjU0IyIVFLoSNSYnNU4/PTMVTDgeKjYBAU4SFBUCmBcfKjs7LDxLJiM0VzsaDhQaGhYA',
    'AAIAAAI1AUwDUgADAAcAABM3JQcFNyUHFy0BCC3+4S0BBy0CwmAwYL1hL2AAAQAAAjUBNALFAAMAABE3JQctAQctAjVhL2AAAAIA',
    'AAI1ATsDNwANABUAABE3NyY1NDYzMhYVFAYHNzY1NCMiFRQnaw41Jig0MygCExQVAjVTFBkcKzs6LCxBBlgOExsbFAABAAACNQE0',
    'AsUAAwAAETclBy0BBy0CNWEvYAAAAQAAAjUBFALqABoAABM3FRQGIyInBiMiJjU1NxUUMzI1NTcVFDMyNc1HMSYfFRYdJjBGERBG',
    'EBACwydnIiwODiwiKydODg0zJ1oNDgAAAgAAAjQAsQL0AAsAEwAAExYWFwYGIyImNTQ2FwYVFDMyNTRYJjIBATAoKDAyJhYWFQL0',
    'CT4nJiwsJSc/PgkXGhoWAAABAAsCnwEoAwMAEgAAAQYjIicmIyMiByc2MzIXFjMyNwEoLi0VLBkMARIeKy0tFi0YDREgAtg5GQ4j',
    'JjoZDiMAAf/8Ao0A1gM+ABIAAAM3MyY1NDYzMhcVJiMiFRQXMwcEIB4LLyEeGhgYIQ1jIAKNOhQVIC4VOhUeDxA6AAAB//wCjQDW',
    'Az4AEgAAAzczJjU0NjMyFxUmIyIVFBczBwQgHgsvIR4aGBghDWMgAo06FBUgLhU6FR4PEDoAAAEAKABZASwBXQADAAA3JzcXq4OD',
    'gVmEgIAAAQBG//EAxAI1AAMAABcRMxFGfg8CRP3/AAABAEH/8QGGAjUACgAAFxE0NjMzFSMiFRFBWEuiljEPAalIU3kr/qQAAQBG',
    '//ECSAI1ABsAAAEzFRQGIyInBiMiJxUHETMVFDMyNTUzFRQzMjUB1nJVRDooJzkYEX5+KChyKScCNXs/TxwcBPxDAkR7IyNdXSMj',
    'AAABACgAAAGfAjUAIwAAMyInJjU0NyY1NTQ1NDc2MzMVIyIGFRQWMzMVIyIGFRYWMzMX4V0zKTwxNjRMb2EfKCgfSE4iKgEqIWVJ',
    'Oi9BSTQqPgEBAUUwLnEiGhsiVyUdHCRyAAIAIP/2AbEB8AATABsAABMWFxYVFBUGBwYjIicmJzQ1NDc2FwYHFDMyNzTqZDYtAjc0',
    'Wmg2KgI7N1hhAmNfAgHwOGFPUwUCWDEvPDBMAgNgWlJER2xgXm0AAAEAGf/xAV4CNQAKAAAXETQjIzUzMhYVEeEylqJLWA8BoCt5',
    'U0j+mwABABQAAAIHAjUABwAAMwMzEzMTMwO8qH94AnqAqwI1/msBlf3LAAEAFAAAAgcCNQAHAAAzEzMTIwMjAxSooKuAegJ4AjX9',
    'ywGV/msAAgAj//EBhwJAABAAHAAABTUGIyInJjU0NzYzMhcWFREDNCMiBhUUFzIzMjcBCR8hHBlxOzFLTzEtfjMbITgDARsYD+EN',
    'CiaJYTUsMzBO/qYBXjsqIkgFEQAABQA0//0C2QJNAAMADwAbACcAMwAAMwEzARMUBiMiJjU0NjMyFgc0JiMiBhUUFjMyNgUUBiMi',
    'JjU0NjMyFgc0JiMiBhUUFjMyNsEBL2L+0Q5EOTxERTs3RkkfFxcfHhgYHgHxRDk8REU7N0ZKHhcYHh4YFx4CTf2zAa1LWldNSVRX',
    'Ryc1NCgrNzfeS1pYTElVWEcnNTMpKzc3AAEASQGYASkCjABBAAATFhcWFRQjIjU2NwcGIyImNTQ2NyInJjU0NjMyFxYXFhcmNTQz',
    'MhUUBwYHNjc2MzIWFRQHBgcGIzIXFhUUBiMiJybNAgUMJiUCFAkdFg8XIDMDCUcXDggICRsEAhMkJg8CAQEEHRMPFxAJLwMCAwhD',
    'Fw0VIAIB8gQNHwogIBMtDSwaEBQQBgEHIBEaBQYhBQImEyAgCiQFAwIFKBsQEwgFBgEBByAQGy8CAAABAFoAAAMoAbwAFQAAISIn',
    'JjU1NxUUFjMhMjY1NTcRFAcGIwEKVTArfSEmAUYmIH45Mk45Mk9mQqAoISInuEL+/lszLAAAAQAAAowARgNfAAMAABE1NxVGAoys',
    'J60ABABa/pwDKAG8ABUAHwApADEAACEiJyY1NTcVFBYzITI2NTU3ERQHBiMHIiY1NDYzMhUUMyImNTQ2MzIVFAciNTQzMhUUAQpV',
    'MCt9ISYBRiYgfjkyTuceJCQeQVkeJCQeQY88PDs5Mk9mQqAoISInuEL+/lszLN4kHh4lQ0IkHh4lQ0KGOzw8OwAABQBaAAADhAMf',
    'AAcAEQAbADYAQAAAASI1NDMyFRQHIiY1NDMyFhUUMyImNTQzMhYVFAEiJyY1NTcVFBYzMyY1NDc2MzIXFhUVFAcGIxM0IyIGFRQz',
    'MjUCzzw8O4ceJEIeI1keJEIeI/3AXjcvfiYu+B48NVdZMiszMlM6OCQpSjsCpz07Oz2TJB9BIx5DJB9BIx5D/exAOFZlQ6AzKipE',
    'bkA4OTFPWlYzMQEWQjozckEAAAEAWgAAA8gBvAAbAAAlMxUjIicGIyEiJyY1NTcVFBYzITI2NTU3FRQWA25aZkovMEr+m1UwK30h',
    'JgFGJiB+IHl5Jyc5Mk9mQqAoISInuEL7JyEAAAL/if8hAKcBvAAMABcAADMiJyY1NTcVFBYzMxUHIiY1NDYzMhYVFEFbMit+ICZa',
    '2x4kJB4eIzoyT79C+yched8kHx0kIx5DAAP/NwAAAKcCmAAKABUAIgAAAyImNTQ2MzIWFRQzIiY1NDYzMhYVFAMiJyY1NTcVFBYz',
    'MxWHHiQlHR4jWR4kJB4eIxNbMit+ICZaAhQlHh0kIx5DJB8dJCMeQ/3sOjJPv0L7JyF5AAT/OQAAAKcDIQAIABMAHgArAAADIjU0',
    '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',
    'V1kyK305TFgOHwJuOjoUFSAuFToVHg8Q/gt5WjYsIm0fLiABAQIBC0Y7VG5AODkxT5udQm1hCwMCAAACAD/+8AF4AoUADAAfAAAh',
    'IicmNRE3ERQWMzMVATczJjU0NjMyFxUmIyIVFBczBwESWzIrfiAmWv7HIB4LLyEeGhgYIQ1jIDoyTwGIQv48JyF5/vA6FBUgLhU6',
    'FR4PEDoAAAIARv9CArgCBQASACoAABM3MyY1NDYzMhcVJiMiFRQXMwcBBgcGIyInJjU0NzcGFRQXFjMyNyM3MxV0Hx4LLyEfGhgY',
    'Ig1jHwGHDFxTfKZUPiV4KDIyX5QgYD+nAVM6FBUgLxY5FR4PETr+rVw0Ll9HZ087GURLVC0uTHl5AAL/4gAAARIC5QASAB8AABM3',
    'MyY1NDYzMhcVJiMiFRQXMwcBNTMyNjU1NxEUBwYjOR8eCy8hHhoYGCENYx/+71omIH44MU8CNDoUFSAuFToVHg8QOv3MeSEnuUL+',
    '/1szLQAAAv/iAAABoALlABIAJQAAAQcjNzMmNTQ2MzIXFSYjIhUUFxMzFSMiJwYjIzUzMjY1NTcVFBYBDyC6IB4LLyEeGhgYIQ2a',
    'WmZJMDBJZlomIH4gAm46OhQVIC4VOhUeDxD+C3knJ3khJ7lC+ychAAABAFoAAAF4AoUADAAAISInJjURNxEUFjMzFQESWzIrfiAm',
    'WjoyTwGIQv48JyF5AAACAFr/IQO0AbwAGwAmAAAlMxUjIicGIyEiJyY1NTcVFBYzITI2NTU3FRQWBTIWFRQjIiY1NDYDbkZSSi8w',
    'Sv6bVTArfSEmAUYmIH4g/mMeI0EeJCR5eScnOTJPZkKgKCEiJ7hC+ych1CMeQyQfHSQAAv/i/yEBAAG8AAwAFwAAIzUzMjY1NTcR',
    'FAcGIxciJjU0NjMyFhUUHlomIH44MU9uHiQkHh4jeSEnuUL+/1szLd8kHx0kIx5DAAAC/+L/IQGgAbwAEgAdAAAlMxUjIicGIyM1',
    'MzI2NTU3FRQWBzIWFRQjIiY1NDYBRlpmSTAwSWZaJiB+IFkeI0EeJCR5eScneSEnuUL7JyHUIx5DJB8dJAAABAAeAAACPQK5AAkA',
    'EwAqADcAABMiJjU0MzIWFRQzIiY1NDMyFhUUEzMVIyInBiMiJyY1NDc2MzIXNTcRFBYnJiMiBhUUFjMyNyY1oB4kQh4jWR4kQh4j',
    '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',
    'ILogHgsvIR4aAkJD/kthOjV5AUdD/nYoMP6qFR4PEDo6FBUgLhUAAgAU/xkC+QKFABYAKQAAJTMVIyInBiMhNzMRNxEzMjY1ETcR',
    'FBYFJiMiFRQXMwcjNzMmNTQ2MzIXAp9aZk4xN1D+hz+EfjEuJ34g/uYYGCENYyC6IB4LLyEeGnl5LCx5AUdD/nYoMAFxQ/48JyH+',
    'FR4PEDo6FBUgLhUAAAEAFAAAAlkChQAQAAABNxEUBwYjITczETcRMzI2NQHbfjs3Wv6HP4R+MS4nAkJD/kthOjV5AUdD/nYoMAAA',
    'AQAUAAAC+QKFABYAACUzFSMiJwYjITczETcRMzI2NRE3ERQWAp9aZk4xN1D+hz+EfjEuJ34geXksLHkBR0P+digwAXFD/jwnIQAA',
    'AAEAAAEtAIAAEAAAAAAAAQAAAAAAAAAACAAAAAAAAAAAAAAAAAAAIAAzAGQAqQD2AUkBVgF2AZUB5QH5AhECHgI3AkcCcgKTAr4C',
    '9QMPAzcDbQN+A8cD/QQqBFMEZgR6BI0ExQUeBTwFcgWbBcIF2AXrBhYGLAY5BlAGbgZ8Bp0GtQbiBwcHNgdgB5IHowe8B88H8AgP',
    'CCYIPghPCF4IbwiACI0ImgjNCP0JIwlRCX0JnAnXCfcKFAo9ClkKZgqXCroK4QsQC0ILXguNC60LzgvkDA8MNwxhDHUMogyvDNwM',
    '+g0QDUUNUQ1dDY8NtQ3qDiAOdg6NDrQO8w8gD0gPbg+8D+EQPhBLEHwQvxD+EUYRhxG+EgQSGRI+ElkSghLPE0ITjhPpFBsUXBSR',
    'FNUU4BUlFX4VtxXbFg8WQxZrFqAW5RdFF1sXiBeeF6wXzxfdGAQYJhhGGGUYhBiRGJ4YshjaGQsZOBlMGV8ZchmfGewaSBprGnca',
    'vBsVGz8bYxuWG9Qb/Rw0HHYcnBzLHPsdMR1jHakd9h4vHm8ezR8aH24fgh+WH7Qf0h/6ICIgOSBXIKEhByFUIYkhuCH8IioiVyKn',
    'IxMjMSNNI88kASQyJIkkuiT5JSolYSV5JbEl1iYCJlAmlSbGJwAnTyeKJ88oGyhHKH8owSjfKQkpWimJKcMp4yoTKjsqcirFKwAr',
    'QSu7LB0shSzVLRAtTy2uLfguRi56Lqwu3y8iL2IvpS/tMA8wRjCcMM0xEzFdMZYx1TIwMnMyvDL8MyEzTTN7M5IzszPsNBo0TzSN',
    'NLQ04DUVNVs1pzXkNgo2SzZ6NrA26DcoN183njfVOBM4MjhXAAEAAAABszNQHx/6Xw889QADA+gAAAAA1t5s3AAAAADW4A06/zf+',
    'ZQWvBCkAAQADAAIAAAAAAAAA8AAYAPAAAAEYAEMBZABGAd0ABQI3AEADDQA0AlEAJgDmAEYBNwAmATcAIwEsAAcB8gAgALAAGQEq',
    'AA8BSABbATP/3QIzACYBcQAAAdIAIwH3AC0CMwAgAfEAGQIGACYBpQAgAhAAJgIGAEEBIABbAMcAGQHxACACBAAgAfEAIgGNACAC',
    'uAAmAkoABQIrAFACPAAoAncAUAH6AEAB7QBAAj4AKAK0AFABIQBQAQ3/oQJUAFABzwBQA0UAUALOAFACjgAoAhwAUAKOACgCDQBQ',
    'AhgALQIeAA8CiABQAjkABQMeAAUCYQAFAj0ABQHkAA8BWwBRAXQAAAFcACMBwgAZAZT/+wDiAA8B9gAmAjEAQgHdACYCMQAmAg4A',
    'JgGBACECJwAbAicARAD8ADABB/+2AfAAQgEGAEQDdgBEAigARAIQACYCJQBEAicAJgGhAEQBrAAmAY0AIAIaAEQB6QAPAswADwHf',
    'AAUB8wAPAacADwGMACYBFQBQAYwAOgH8ABkBSwAsAhgAGQGNAEkCiABJAn0AIQKHACEDTQAvA3sALwNtAC8BKgBAATAAQgHIACsC',
    'HgAjATIAEgEyADQCCgA8ATIALQLzADYBMgBaA4IAWgIdAE0DggBaA4IAWgJ3AEYCiwBGAosARgHdAAoB3QAKAWj/twFo/7cFWABG',
    'BVgARgVEAEYFRABGA4oAFAOKABQCRQBGAkUARgB0/+ID1ABaAwsARgOBAFoC1ABGAm8AFAK7AEYCHQBGAgoAPALzAEYC8wBGAAAA',
    'AAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALAAD//AAA//wBVAAoAQoARgGfAEECZgBGAbgAKAHNACABnwAZAhsAFAIb',
    'ABQByAAjAw0ANAFsAEkDggBaAAAAAAOCAFoD1ABaA6oAWgCJ/4kAif83AIn/OQJr/7cCa/+3A74ARgCJ/4kAif9GAIn/bwAAAAUD',
    'AgAhA/4AIQOqAFoBWv/XAYL/7gPnAFoCM//2Aj//9gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFa/+IBgv/iBFAARgRQAEYAAAAK',
    'AAAAAAAAAAcAAAAHAAAAAAAAACUEagBGBGoARgGwADwBsABqBaoAHgFaABIBWgA0AhcAPAFaAD8CowBGAVP/4gGC/+IBWgBaA5YA',
    'WgFa/+IBgv/iAh8AHgOWAFoBWv/iAYL/4gOWAFoBWv/iAYL/4gLRAEYCRv/iAqT/4gLlAEYCRv/iAqT/4gLlAEYCRv/iAqT/4gIa',
    'AAoCGgAKAZH/twGR/7cFkQBGBAj/4gRB/+IFkQBGBAj/4gRB/+IFhQBGA+P/4gQk/+IFhQBGA+P/4gQk/+IDzAAUA0P/4gOF/+ID',
    'zAAUA0P/4gOF/+ICrQBIAj7/4gLE/+ICrQBIAj7/4gLE/+ID5wBaAjP/4gI//+IDFwBGAjP/4gI//+IDqgBaAfP/4gIv/+IDCgBG',
    'AU3/4gF2/+ICoQAUAkz/4gKZ/+IC4wBGAVr/4gGC/+ICHwAeAof/4gLJ/+ICFwA8AqMARgKjAEYBWv/WAYL/4gKyABQC2wAUArIA',
    'FALbABQCsgAUAtsAFAKyABQC2wAUAAEAAAKD/psAyAWq/zf+mAWvAAEAAAAAAAAAAAAAAAAAAAEtAAMCAgK8AAUAAAKKAlgAAABL',
    'AooCWAAAAV4AAwEQAAAAAAgAAAAAAAAAgAAgA4AAAAAAAAAIAAAAADFib3UAIAAg/vwCg/6bAMgEKQGbAAAAQAAAAAABxgJ5ICIA',
    'IAACAAAAAgAAAAMAAAAUAAMAAQAAABQABAHwAAAAeABAAAUAOAB+AKAGDAYbBh8GOgZVBmoGbgZwBn4GpCAUICIgJvtZ+237t/vp',
    '/Fr8Y/yW/T/98v6C/oT+hv6I/oz+jv6S/pT+mP6c/qD+pP6o/qr+rP6u/rD+tP64/rz+wP7E/sj+zP7Q/tT+2P7c/uD+5P7o/uz+',
    '7v7w/vz//wAAACAAoAYMBhsGHwYhBkAGYAZtBnAGfgakIBMgIiAm+1f7a/uy++j8Wfxe/JX9Pv3y/oL+hP6G/oj+iv6O/pD+lP6W',
    '/pr+nv6i/qb+qv6s/q7+sP6y/rb+uv6+/sL+xv7K/s7+0v7W/tr+3v7i/ub+6v7u/vD+8v///+H/Yfpd+k/6TPpL+kb6PPo6+jn6',
    'LPoH4E/gPuA7BWIFUQUNBN0EbgRrBDoDkwLhAlICUQJQAk8CTgJNAkwCSwJKAkkCSAJHAkYCRQJEAkMCQgJBAkACPwI+Aj0CPAI7',
    'AjoCOQI4AjcCNgI1AjQCMwIyAjECMAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsTAAuAEk',
    'GIWNHQAAAAAABwBaAAMAAQQJAAAAbgAAAAMAAQQJAAEADgBuAAMAAQQJAAIACAB8AAMAAQQJAAMALgCEAAMAAQQJAAQAGACyAAMA',
    'AQQJAAUAGgDKAAMAAQQJAAYAGACyACgAYwApACAAMgAwADEANwAgAGIAeQAgAEIAbwB1AHQAcgBvAHMAIABJAG4AdABlAHIAbgBh',
    'AHQAaQBvAG4AYQBsAC4AIABBAGwAbAAgAHIAaQBnAGgAdABzACAAcgBlAHMAZQByAHYAZQBkAC4AVABhAGoAYQB3AGEAbABCAG8A',
    'bABkADEALgAwADAAMAA7ADEAQgBPAFUAOwBUAGEAagBhAHcAYQBsAC0AQgBvAGwAZABUAGEAagBhAHcAYQBsAC0AQgBvAGwAZABW',
    'AGUAcgBzAGkAbwBuACAAMQAuADcAMAAwAAAAAwAAAAAAAP/8AAMAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAIACAAC//8ADwABAAAA',
    'DAAAAAAAAAACAAsAbACFAAEAhwCQAAEAkQCbAAMAqACoAAEAqQCpAAMArAC1AAEAtgC2AAMAvwDEAAMAyQDNAAMA1AEkAAEBJQEs',
    'AAIAAAABAAAACgAiAE4AAURGTFQACAAEAAAAAP//AAMAAAABAAIAA2tlcm4AFG1hcmsAHG1rbWsAJAAAAAIAAAABAAAAAgACAAMA',
    'AAACAAQABQAGAA4GageaDeIP0hBqAAIAAAABAAgAAQByAAQAAAA0ANwA6gD0AQIBCAFqASYBLAFqAToBQAFqAXQBxgHUAe4CDAIy',
    'AjgCTgKIArIC2AMOAxwDOgNkA7IDxAQGBDwEXgY0BLAEtgTEBMoE5AT6BQQFCgUQBRoFZAV2BZQFygX4Bf4GNAZCBkIAAgARAAkA',
    'CQAAAA0AEQABABQAGAAGABoAGgALACIAJQAMACcAKAAQACsALQASADAAOgAVADwAPAAgAEIARAAhAEcARwAkAEwATAAlAE4AUQAm',
    'AFMAVQAqAFcAWgAtAFwAXAAxAGIAYwAyAAMAKwBLAEf/5wBLAEEAAgAS/+cANv/nAAMAEv/dABj/5wA6/78AAQAS/90ABwA3AG4A',
    'OABuADkANwA6AG4AOwAtAEoAQQBLAEEAAQAY//YAAwAS/+cAYgAjAGMAIwABAGMAGQAKAA3/vwAO/+cAD//JABIAGQAUAAoAFf/J',
    'ABgAGQAb//EAHP/xAGL/5wACAGIAGQBjABkAFAAk/+wAKP/sADD/7AAy/+wANf+/ADb/8QA3/9MAOP/dADr/yQA7ABQARP/2AEX/',
    '8QBG//YASP/xAFD/9gBS//EAVf/nAFb/9gBX/+wAWP/sAAMAIv/sADn/5wA6//YABgAk/+wAQv/2AET/5wBG/+cAUP/nAFb/+wAH',
    'ACL/5wA1//EAN//sADj/7AA5/90AOv/JAFn/5wAJAA3/tQAP/7UAIv/YAEL/0wBE/9gARv/YAFD/2ABT/+wAVv/sAAEAIgAKAAUA',
    'RP/2AEb/9gBK//YAUP/2AFb/7AAOACIACgAk/+cAKP/nADD/5wAy/+cAOgAPAEL/8QBE/+IARv/iAEr/7ABQ/+IAVv/sAFf/0wBY',
    '//EACgAiAA8AJP/nACj/8QAw//EAMv/xADX/vwA2/9MAN//OADj/0wA6/8kACQAN//YAD//2ACL/8QA1/90AN//xADj/+wA5/+cA',
    'Ov/xAFn/5wANAA3/tQAP/7UAEP/nACL/vwA6//EAQv/sAET/4gBF/+IARv/iAEj/4gBQ/+IAUv/iAFT/4gADADf/9gA4//YAOv/s',
    'AAcAIgAPADr/9gBE//EARv/xAFD/8QBW//YAWgAUAAoAIv/2ACT/8QAo//YAMP/2ADL/9gA0/9MANf/xAFf/5wBY/+cAWv/sABMA',
    'Df+mAA//pgAi/8kAJP/sACj/7AAw/+wAMv/sADgAFAA7ABQAQv/TAET/vwBG/78AUP+/AFT/yQBW/8kAV//nAFj/9gBa//YAW//x',
    'AAQADf/nAA//5wAi/+cANP/xABAADf+1AA//tQAQ/+wAIv/JACT/9gAo//YAMP/2ADL/9gA3AAoAOAAKADoACgBC/90ARP/TAEb/',
    '0wBQ/9MAVv/xAA0ADf+/AA//vwAi/9MAMv/sADcACgA4AAoAOgAKAEL/3QBE/90ARv/dAFD/3QBT/+cAVv/nAAgAEAA3ACT/8QAo',
    '//EAMP/xADL/5wBE/+wARv/sAFD/7AAUAA3/vwAO/78AD/+/ABD/7AAi/8kAJP/sACj/7AAw/+wAMv/sADT/9gA3AAoAOAAKADoA',
    'CgBC/8kARP+/AEb/vwBQ/78AV//nAGL/vwBj/78AAQBY//YAAwAN/+cAD//nAFT/8QABAET/9gAGAET/7ABF//EARv/sAEj/8QBQ',
    '/+wAUv/xAAUARP/nAEb/5wBI//YAUP/nAFb/9gACAFf/9gBY//YAAQBV//YAAQBX//EAAgAN/+cAVP/xABIADf+1AA//yQBC/+wA',
    'RP/nAEX/7ABG/+cASP/sAEr/9gBO//YAT//2AFD/5wBS/+wAVP/xAFUAGQBW//EAVwAZAFgAGQBaAA8ABABE//YARv/2AFD/9gBU',
    '//YABwBE//YARf/2AEb/9gBI//YAUP/2AFL/9gBbAAoADQAN/8kAD//TADgACgBC//YARP/2AEX/9gBG//YASP/2AFD/9gBS//YA',
    'VwAKAFgACgBaAAoACwAN/8kAQv/2AET/9gBF//YARv/2AEj/9gBQ//YAUv/2AFcACgBYAAoAWgAKAAEAWgAPAA0ADf/dAA//3QBC',
    '//YAQ//2AET/9gBF//EARv/2AEj/8QBQ//YAUv/xAFcACgBYAAoAWgAKAAMAKwBLAEf/5wBLADcABAARABkAFQAjABcAGQA6/78A',
    'AgAJAAIACgAwAAEAlgAFAAAABgAWABYAFgAWAB4AHgABAHAAawBrAAEAcABkAGQAAgBwAAUAAACAAKIABgAEAAAAAAAeAB4AQQBB',
    'AFoAWgAAAAAAHgAeAEEAQQBaAFoAAAAAAB4AHgBBAEEAWgBaAAAAAAAeAB4AQQBBAFoAWgAAAAAAHgAeAEEAQQBaAFoAAAAAAB4A',
    'HgBBAEEAWgBaAAEABgB8AH0AsACxAPEA8gACAAUAfQB9AAMAsACwAAIAsQCxAAUA8QDxAAEA8gDyAAQAAgAPAG0AbwACAHEAcQAD',
    'AHIAcgACAHwAfQACAIQAhQABAIgAiAACAIoAigACAIwAjAACAI4AjgACAI8AkAADAN0A3QACAOcA5wABAOoA6gABAO0A7QABASMB',
    'IwACAAQAAQABAAgAAQAMACgAAgBKAMYAAgAEAJEAmwAAAKkAqQALAL8AvwAMAMEAxAANAAIABQBsAIUAAACHAJAAGgCoAKgAJACs',
    'ALUAJQDUASQALwARAAEJEAABCQQAAAguAAEJCgABCRAAAAg0AAEARgABAEwAAQBSAAEAWAAAAF4AAQBkAAEAagABCaoAAABwAAEJ',
    'qgAAAHYAAQDSAhcAAQCUAhYAAQDfAqMAAQCuAo4AAQBrA1IAAQBHApAAAQCD/+0AAQEeAHEAAQEVANEAgAICAggCDgLCAg4CzgVE',
    'AtQCFAIaAuYCIAImAwQCLAMQAxYCMgM0AyIDNAM6A3wDcANqA3ADfAOCA6ADmgOgA6YCkgKYA7IDuAP6A74D0APWA/oD6AP6BAAE',
    'HgQSBB4EJAQ2AjgETgI+AkQCSgSQBJYCUAS0BMwE0gTkBOoCVgUOAxYCXAVEBUoFUAJiBVYCYgJoAm4CdAJ6AqoCsAK2AoAChgKM',
    'ApICmAOyAp4FCAUOArYCpAKqArACtgK8AsgCwgLIAs4FRALUAtoC4ALmAuwFFALyBSAC+AL+AwQDCgMQBWIFaAVuBXQDFgMcAzQD',
    'IgUUAygFIAMuAzQDOgUUA0ADRgNMA1IDcANYA14DZAN2A2oDcAOOA3YDjgN2A3wDggOOA4gDjgOUA6ADmgOgA6YDsgOsA7IDuAP6',
    'A74DxAPKA8QDygPQA9YD3APiA9wD4gP6A+gEBgP0A+4D9AP6BAAEBgQMBAYEDAQeBBIEKgQYBCoEGAQeBCQEKgQwBCoEMAQ2BDwE',
    'WgRCBGYESAROBFQEWgRgBGYEbARyBHgEhAR+BIQEigSQBJYEogScBKIEqASuBLQEugTGBMAExgTMBNIFFATYBSAE3gTkBOoE8AT2',
    'BPwFAgUIBQ4FFAUaBSAFJgUyBSwFMgU+BTgFPgVEBUoFUAVcBVYFXAViBWgFbgV0AAEA/P+JAAEBTAI1AAEAiP+1AAEAh/68AAEA',
    '0gK+AAEA9wJqAAEAnP+1AAEBtf7FAAEBXQMbAAEBfwI1AAEBcQMHAAECGv+SAAEDGAL4AAECCf+SAAEBPf7UAAEBSAJJAAECBwI1',
    'AAEB8v+SAAECKgHRAAEB2P+SAAECFgHRAAEACQMQAAH/0f9qAAEAFQONAAEAZv7UAAEBDgI1AAEA3QK7AAEAEwMQAAH/wf7FAAH/',
    '/AI1AAH/xf9qAAEAEwNBAAEA3ANcAAEAlP+1AAEA3wOqAAEBOAMbAAEAn/68AAEA3wK+AAEBaP7UAAEBKQJqAAEAtgNBAAEA1wNB',
    'AAEArv+1AAEA5gK+AAEBsv7FAAECCAHRAAEBDv+QAAEBPgMbAAECAwLKAAEAsgMQAAEA0AMQAAEBmv9bAAECGANWAAEAugONAAEA',
    'pv9qAAEAzgONAAEBJP4yAAEBEv7FAAEBRAI1AAEBSP7FAAEBMv4yAAEBggI1AAEBWQI1AAEBI/43AAEBgQMQAAEBPwMQAAEBK/+S',
    'AAEBUwMQAAEBMQI1AAEAuf+SAAEBJwMLAAEBCQI1AAEAYf7UAAEA/QMKAAEDsQIoAAECIf+SAAECZwIoAAEDeP+SAAEDtAOBAAEC',
    'J/+SAAECYwOBAAEESwI1AAECgf+SAAEC/QI1AAEDcv+SAAEESAMcAAECbv+SAAEC9QMcAAECkAI1AAECRwI1AAECFP+SAAECjwMH',
    'AAEBy/+SAAECRQMHAAEBU/5KAAEBkAI0AAEBbwI1AAEBoAI1AAEBP/5KAAEBewMHAAEBN/+SAAEBZQMHAAEBXf+SAAEBlQMHAAEB',
    '0/+SAAEDEwL4AAEBZAL4AAEBA/+SAAEBYAL4AAEBg/7UAAECPwLyAAEBZQL4AAEBIP+SAAEBYgL4AAEBwf+SAAECAAKHAAEBFP+S',
    'AAEBCf+SAAEBJgLVAAEBXv7UAAEBSwHFAAEAyQK+AAEA2QK+AAEBbf+SAAEBmAIxAAEBRv+SAAEBVgIxAAEBTf+SAAEBfwIxAAEB',
    'Uf7UAAEBiQKdAAEAVP9qAAEAqAMQAAEAmv9qAAEA2gMQAAEBOgJJAAEA9f9qAAEA1P9qAAEBdAJJAAEA+v7UAAEBNQI1AAEBf/7W',
    'AAEBZ/4DAAEBugFhAAEAZ/7FAAEAwgI1AAEAyf7FAAEA7gI1AAUAAQABAAgAAQAMADQAAgA+ASYAAgAGAJEAmwAAAKkAqQALALYA',
    'tgAMAL8AvwANAMEAxAAOAMkAzQASAAIAAQElASwAAAAXAAAAXgAAAGQAAQBqAAAAcAAAAHYAAQB8AAAAggAAAIgAAACOAAAAlAAB',
    'AJoAAACgAAAApgAAAKwAAACyAAEAuAAAAL4AAQDEAAAAygAAANAAAADWAAAA3AAAAOIAAQCxAhcAAQDAAhcAAQB/AxwAAQCsAhAA',
    'AQCsAhIAAQBuArcAAQCqAhcAAQB0AhQAAQC2Ap4AAQCUApMAAQBgAz4AAQA6ApwAAQCmAhcAAQBR/70AAQC8/9EAAQA6AKcAAQCh',
    '/9EAAQA/AO8AAQDVAjEAAQC/AiYAAQC7AhcAAQC5AhcAAQC0AicACAASABwAMgBCAFgAaAB+AKAAAgAqAHwAGgCIAAIACgCUABAA',
    'fgABAhACvgABASgC3QACAAoAXAAgAGgAAQIkAr4AAgAKAG4AEABYAAECFQLDAAEBMAMgAAIAMAAKAF4AIAABAcP/HgACAEIACgBO',
    'ABAAAQHm/1wAAQDo/tcAAgAKABAAFgAcAAECOgK+AAEBqf+1AAEBMAJpAAEAt/+1AAIACgAQABYAHAABAiYCvgABAdz/tQABASYC',
    'aQABAKP/tQAGAAAAAQAIAAEADAAaAAEAKgBeAAEABQCTAJYAmwDCAMQAAQAGAJMAlgCbAMAAwgDEAAUAAAAWAAAAHAAAACIAAAAo',
    'AAAALgABAKMDcwABAIwC5gABAFkDagABAJUAxAABAJgBEgAGAA4AFAAaACAAJgAsAAEAlAIBAAEAkwIrAAEAbQKNAAEANv/LAAEA',
    'pwAGAAEAkv/dAAYAAAABAAgAAQAMACgAAQBGAMAAAQAMAJEAkgCUAJUAlwCYAJkAmgCpAL8AwQDDAAEADQCRAJIAlACVAJcAmACZ',
    'AJoAqQC/AMAAwQDDAAwAAAAyAAAAOAAAAD4AAABEAAAASgAAAFAAAABWAAAAXAAAAGIAAABoAAAAbgAAAHQAAQDVAhEAAQDzAhcA',
    'AQDVAhQAAQDVAhcAAQDGAe0AAQB2AeYAAQC1AlAAAQB+AlIAAQBNAj0AAQBT/44AAQDE/68AAQCy/7sADQAcACIAKAAuADQAOgBA',
    'AEYATABSAFgAXgBkAAEA5wOIAAEA8wNMAAEA0gLFAAEA8wNSAAEAwwLuAAEAgQLcAAEAvwMZAAEAgAM/AAEARwM4AAEAawBSAAEA',
    'bABNAAEA7QCRAAEBHQAUAAAAAQAAAAoAPAC4AANERkxUABRhcmFiABRsYXRuABQABAAAAAD//wAKAAAAAQACAAMABAAFAAYABwAI',
    'AAkACmFhbHQAPmNhbHQARmNjbXAATGRsaWcAUmZpbmEAWGZyYWMAXmluaXQAZGxpZ2EAam1lZGkAcHJsaWcAdgAAAAIAAAABAAAA',
    'AQAJAAAAAQADAAAAAQAIAAAAAQAGAAAAAQALAAAAAQAEAAAAAQAKAAAAAQAFAAAAAQAHAAwAGgAqADoAWAEGAUgBuAJYAroC3gNC',
    'A3wABwAAAAEACAABAAEAAAOWAAcAAAABAAgAAQADAAAD9AABAAAAAQAIAAIADAADALAAsQCyAAEAAwDxAPIBGgAEAAAAAQAIAAEA',
    'lgAIABYAIAAqADQAPgBIAFIAjAABAAQAtgACAJcAAQAEAMkAAgCXAAEABADKAAIAlwABAAQAywACAJcAAQAEAMwAAgCXAAEABADN',
    'AAIAlwAHABAAFgAcACIAKAAuADQAtgACAJEAyQACAJIAygACAJMAywACAJQAzAACAJUAzQACAJYAzgACAKkAAQAEAM4AAgCXAAIA',
    'AgCRAJcAAACpAKkABwABAAAAAQAIAAIAfAAaANkA3QDhAOQA5wDqAO0A9AD3APoA/QEAAQMBBgEJAQwBDwESARUBGAEbAR4AxQEj',
    'ALoAvQABAAAAAQAIAAIAOgAaANoA3gDiAOUA6ADrAO4A9QD4APsA/gEBAQQBBwEKAQ0BEAETARYBGQEcAR8AxgEkALsAvgACAAcA',
    'cQBxAAAAcwBzAAEAdQB5AAIAfgCFAAcAhwCNAA8AjwCQABYAqgCrABgAAQAAAAEACAACAF4ALADUANUA1gDXANgA2wDcAN8A4ADj',
    'AOYA6QDsAO8A8ADxAPIA8wD2APkA/AD/AQIBBQEIAQsBDgERARQBFwEaAR0BIAEhASIArAC5ALwAzwDQASYBKAEqASwAAgAJAG0A',
    'hQAAAIcAkAAZAKgAqAAjAKoAqwAkAMcAyAAmASUBJQAoAScBJwApASkBKQAqASsBKwArAAQAAAABAAgAAQBQAAMAagAMAC4ABAAK',
    'ABAAFgAcASUAAgDUAScAAgDVASkAAgDXASsAAgDbAAQACgAQABYAHAEmAAIA1AEoAAIA1QEqAAIA1wEsAAIA2wABAAMAcgEVARYA',
    'BAAAAAEACAABABYAAQAIAAEABADTAAQBFQEWAR0AAQABAHIABgAAAAMADAAkADwAAwABAEIAAQASAAAAAQAAAAIAAQABARoAAwAB',
    'ACoAAQASAAAAAQAAAAIAAQABAPEAAwABABIAAQAiAAAAAQAAAAIAAQAGAK0ArgCvALMAtAC1AAEAAQDyAAQAAAABAAgAAQAsAAEA',
    'CAAEAAoAEgAYAB4AuAADAEcASgC3AAIARwBkAAIASgBlAAIATQABAAEARwAEAAAAAQAIAAEALAACAAoAIAACAAYADgBmAAMAEAAT',
    'AGcAAwAQABUAAQAEAGgAAwAQABUAAQACABIAFAACADgAGQDUANUA1gDXANsA3wDvAPAA8QDyASABIQC1AK0ArgCvALAAsQCyALMA',
    'tAEmASgBKgEsAAEAGQBtAG4AbwBwAHIAdAB6AHsAfAB9AI4AjwDaAN4A4gDlAPEA8gEaARwBJAElAScBKQErAAEA9gAYADYAPgBG',
    'AE4AVgBeAGYAbgB2AH4AhgCOAJYAngCmAK4AtgC+AMYAzgDWAN4A5gDuAAMA2QDaANgAAwDdAN4A3AADAOEA4gDgAAMA5ADlAOMA',
    'AwDnAOgA5gADAOoA6wDpAAMA7QDuAOwAAwD0APUA8wADAPcA+AD2AAMA+gD7APkAAwD9AP4A/AADAQABAQD/AAMBAwEEAQIAAwEG',
    'AQcBBQADAQkBCgEIAAMBDAENAQsAAwEPARABDgADARIBEwERAAMBFQEWARQAAwEYARkBFwADARsBHAEaAAMBHgEfAR0AAwEjASQB',
    'IgADAMUAxgCsAAIABwBxAHEAAABzAHMAAQB1AHkAAgB+AIUABwCHAI0ADwCQAJAAFgCoAKgAFwAA'
].join('');

// =====================================================
// EXPORT ROUTER
// =====================================================

module.exports = router;
