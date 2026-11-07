const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

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

const ALLOWED_FILTERS = ['all', 'battery0', 'offline'];

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

    if (filter === 'battery0') {
        return 'Battery = 0V Report';
    }

    if (filter === 'offline') {
        return 'Offline Units Report';
    }

    return 'All Units Report';
}

function normalizeFilter(value) {

    const filter = String(value || 'all');

    return ALLOWED_FILTERS.includes(filter) ? filter : 'all';
}

function filterFleetUnits(units, filter) {

    if (filter === 'battery0') {
        return units.filter(u => Number(u.batteryVolts) === 0);
    }

    if (filter === 'offline') {
        return units.filter(u => u.isOffline);
    }

    return units;
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
        filter === 'battery0'
            ? 'Battery Zero Report'
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
        'Account',
        'Unit Name',
        'Status',
        'Last Message',
        'Location (lat,lng)',
        'Offline Days',
        'Battery (V)',
        'Device Battery (V)',
        'Battery Status'
    ];

    sheet.columns = [
        { key: 'accountGroup', width: 22 },
        { key: 'name', width: 24 },
        { key: 'status', width: 12 },
        { key: 'lastMessageTime', width: 22 },
        { key: 'location', width: 22 },
        { key: 'offlineDays', width: 14 },
        { key: 'batteryVolts', width: 12 },
        { key: 'deviceBatteryVolts', width: 18 },
        { key: 'batteryStatus', width: 16 }
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

    units.forEach(u => {

        const row = sheet.addRow({
            accountGroup: u.accountGroup,
            name: u.name,
            status: u.status,
            lastMessageTime: u.lastMessageTime,
            location: u.location,
            offlineDays: u.offlineDays,
            batteryVolts: u.batteryVolts,
            deviceBatteryVolts: u.deviceBatteryVolts,
            batteryStatus: u.batteryStatus
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
        to: { row: headerRowIndex, column: 9 }
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
// Arabic text: we use the full Noto Naskh Arabic fonts that
// already live in lib/fonts/. They are complete OpenType fonts
// with GSUB tables, so pdfkit (through fontkit) joins the Arabic
// letters and handles right-to-left order BY ITSELF.
//
// IMPORTANT: do NOT pre-shape or reverse Arabic text before
// drawing it. Passing already-shaped text makes fontkit shape it
// a second time, which is what produced garbled output.
// Raw Arabic strings go straight to doc.text().
// =====================================================

const ARABIC_FONT_REGULAR = path.join(__dirname, '..', 'lib', 'fonts', 'NotoNaskhArabic-Regular.ttf');
const ARABIC_FONT_BOLD = path.join(__dirname, '..', 'lib', 'fonts', 'NotoNaskhArabic-Bold.ttf');

const AR_TEST = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

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
        if (fs.existsSync(ARABIC_FONT_REGULAR) && fs.existsSync(ARABIC_FONT_BOLD)) {
            doc.registerFont('ArabicRegular', ARABIC_FONT_REGULAR);
            doc.registerFont('ArabicBold', ARABIC_FONT_BOLD);
        } else {
            console.error('⚠️ Arabic fonts not found at', ARABIC_FONT_REGULAR);
        }
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
// Cells with Arabic use the Noto Naskh font and raw text
// (pdfkit shapes + orders the Arabic itself).
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

    // Arabic reads right-to-left, so left-aligned Arabic cells
    // are pushed to the right edge of the cell.
    const finalAlign =
        useArabic && align === 'left' ? 'right' : align;

    const measure = value => doc.widthOfString(value);

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

    if (finalAlign === 'center') {
        cursor += Math.max(0, (maxWidth - total) / 2);
    } else if (finalAlign === 'right') {
        cursor += Math.max(0, maxWidth - total);
    }

    const textY = y + (rowHeight - fontSize) / 2;

    doc.fillColor(color);

    doc.text(text, cursor, textY, { lineBreak: false });
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
        { key: '#', label: '#', width: 24, align: 'center' },
        { key: 'accountGroup', label: 'Account', width: 85, align: 'left' },
        { key: 'name', label: 'Unit Name', width: 150, align: 'left' },
        { key: 'status', label: 'Status', width: 55, align: 'left' },
        { key: 'lastMessageTime', label: 'Last Message', width: 100, align: 'left' },
        { key: 'location', label: 'Location', width: 110, align: 'left' },
        { key: 'offlineDays', label: 'Offline Days', width: 55, align: 'center' },
        { key: 'batteryVolts', label: 'Battery (V)', width: 55, align: 'center' },
        { key: 'deviceBatteryVolts', label: 'Device Battery', width: 60, align: 'center' },
        { key: 'batteryStatus', label: 'Battery Status', width: 60, align: 'center' }
    ];

    const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);

    const tableX = Math.max(marginX, (pageWidth - tableWidth) / 2);

    const headerHeight = 26;
    const rowHeight = 21;

    function drawPageHeader() {

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

            let value = col.key === '#' ? index + 1 : unit[col.key];

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

            const filter = normalizeFilter(req.query.filter);

            const format = String(req.query.format || 'xlsx').toLowerCase();

            const sessionUser = req.session.user;

            let units = await getUnitsForUser(sessionUser);

            units = filterFleetUnits(units, filter);
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

            const filter = normalizeFilter(req.query.filter);

            const sessionUser = req.session.user;

            let units = await getUnitsForUser(sessionUser);

            units = filterFleetUnits(units, filter);
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

            const filter = normalizeFilter(req.query.filter);

            const sessionUser = req.session.user;

            let units = await getUnitsForUser(sessionUser);

            units = filterFleetUnits(units, filter);
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

            const filter = normalizeFilter((req.body || {}).filter);

            const filteredUnits = filterFleetUnits(units, filter);

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
// EXPORT ROUTER
// =====================================================

module.exports = router;