// =====================================================
// Installation Report PDF builder (تقرير التركيبات الجديدة)
//
// Reuses the same letterhead-background + auto Arabic/Latin
// font switching as lib/reportPdf.js (see the notes at the
// top of that file about NOT pre-shaping Arabic text before
// doc.text()).
//
// Adds on top of the generic report builder:
//   - a line number per vehicle row (رقم السطر)
//   - a page footer "صفحة X من Y" (page X of Y) on every page,
//     drawn at the end via doc.bufferedPageRange() since the
//     total page count isn't known until the whole doc is built
//   - installation photos embedded under each vehicle row
//   - an employee name / job title / signature block
// =====================================================

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const {
    drawAutoText,
    drawLetterheadBackground
} = require('./reportPdf');

const PAGE_WIDTH = 595.28;  // A4 pt
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 40;
const CONTENT_TOP = 150;
const CONTENT_BOTTOM = 760; // leave room for the footer/page number
const PHOTO_SIZE = 70;
const PHOTO_GAP = 8;

function fmtDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US');
}

/**
 * @param {object} opts
 * @param {object} opts.report   InstallationReport database document (or plain object)
 * @param {string} opts.uploadsDir  absolute path where item photo files live
 * @param {'ar'|'en'} [opts.lang]
 * @param {import('stream').Writable} stream
 */
function buildInstallationReportPdf({ report, uploadsDir, lang = 'ar' }, stream) {
    const rtl = lang === 'ar';

    const L = rtl ? {
        title: 'تقرير التركيبات الجديدة',
        reportNo: 'رقم التقرير',
        company: 'الشركة',
        date: 'تاريخ التركيب',
        lineNo: 'م',
        vehicle: 'رقم / اسم العربية',
        imei: 'IMEI',
        serial: 'Serial No.',
        sim: 'SIM No.',
        notes: 'الملاحظات',
        photosLabel: 'صور التركيب',
        noPhotos: 'لا توجد صور',
        employee: 'اسم الموظف',
        jobTitle: 'المسمى الوظيفي',
        signature: 'التوقيع الإلكتروني',
        page: 'صفحة',
        of: 'من',
        noVehicles: 'لا توجد عربيات في هذا التقرير'
    } : {
        title: 'New Installation Report',
        reportNo: 'Report #',
        company: 'Company',
        date: 'Installation Date',
        lineNo: '#',
        vehicle: 'Vehicle',
        imei: 'IMEI',
        serial: 'Serial No.',
        sim: 'SIM No.',
        notes: 'Notes',
        photosLabel: 'Installation Photos',
        noPhotos: 'No photos',
        employee: 'Employee Name',
        jobTitle: 'Job Title',
        signature: 'Electronic Signature',
        page: 'Page',
        of: 'of',
        noVehicles: 'No vehicles in this report'
    };

    const align = rtl ? 'right' : 'left';

    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true });
    doc.pipe(stream);

    let y;
    let lineCounter = 0; // running line number across the whole report, not reset per page

    function newPage() {
        doc.addPage({ size: 'A4', margin: 0 });
        drawLetterheadBackground(doc);
        y = CONTENT_TOP;
    }

    newPage();

    // ---- Title ----
    drawAutoText(doc, L.title, MARGIN_X, y, {
        width: PAGE_WIDTH - MARGIN_X * 2, fontSize: 18, bold: true,
        color: '#1a1a1a', align
    });
    y += 28;

    // ---- Header info block (report #, company, date) ----
    const headerRows = [
        [L.reportNo, report.reportNumber],
        [L.company, report.companyName],
        [L.date, fmtDate(report.installationDate)]
    ];

    headerRows.forEach(([label, value]) => {
        if (rtl) {
            drawAutoText(doc, `${label}:`, PAGE_WIDTH - MARGIN_X - 160, y, { width: 120, fontSize: 10, bold: true, color: '#555555', align: 'right' });
            drawAutoText(doc, String(value || '-'), MARGIN_X, y, { width: PAGE_WIDTH - MARGIN_X - 300, fontSize: 10, color: '#222222', align: 'right' });
        } else {
            drawAutoText(doc, `${label}:`, MARGIN_X, y, { width: 100, fontSize: 10, bold: true, color: '#555555', align: 'left' });
            drawAutoText(doc, String(value || '-'), MARGIN_X + 110, y, { width: PAGE_WIDTH - MARGIN_X * 2 - 110, fontSize: 10, color: '#222222', align: 'left' });
        }
        y += 18;
    });

    y += 10;

    // ---- Divider ----
    doc.moveTo(MARGIN_X, y).lineTo(PAGE_WIDTH - MARGIN_X, y).strokeColor('#E0E0E0').lineWidth(1).stroke();
    y += 16;

    // ---- Vehicles table header ----
    const colLineW = 30;
    const colVehicleW = 140;
    const colNotesW = PAGE_WIDTH - MARGIN_X * 2 - colLineW - colVehicleW;

    function drawTableHeader() {
        doc.rect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, 20).fill('#1976D2');

        if (rtl) {
            drawAutoText(doc, L.notes, MARGIN_X + 4, y + 5, { width: colNotesW - 8, fontSize: 9, bold: true, color: '#FFFFFF', align: 'right' });
            drawAutoText(doc, L.vehicle, MARGIN_X + colNotesW + 4, y + 5, { width: colVehicleW - 8, fontSize: 9, bold: true, color: '#FFFFFF', align: 'right' });
            drawAutoText(doc, L.lineNo, MARGIN_X + colNotesW + colVehicleW + 4, y + 5, { width: colLineW - 8, fontSize: 9, bold: true, color: '#FFFFFF', align: 'center' });
        } else {
            drawAutoText(doc, L.lineNo, MARGIN_X + 4, y + 5, { width: colLineW - 8, fontSize: 9, bold: true, color: '#FFFFFF', align: 'center' });
            drawAutoText(doc, L.vehicle, MARGIN_X + colLineW + 4, y + 5, { width: colVehicleW - 8, fontSize: 9, bold: true, color: '#FFFFFF' });
            drawAutoText(doc, L.notes, MARGIN_X + colLineW + colVehicleW + 4, y + 5, { width: colNotesW - 8, fontSize: 9, bold: true, color: '#FFFFFF' });
        }
        y += 20;
    }

    drawTableHeader();

    const items = Array.isArray(report.items) ? report.items : [];

    if (items.length === 0) {
        drawAutoText(doc, L.noVehicles, MARGIN_X, y + 8, { width: PAGE_WIDTH - MARGIN_X * 2, fontSize: 10, color: '#999999', align: 'center' });
        y += 30;
    }

    items.forEach((item, idx) => {

        lineCounter += 1;

        // estimate row height from the notes text + whether it has photos
        const notesText = item.notes || '-';
        doc.font('Helvetica').fontSize(9);
        const notesHeight = doc.heightOfString(notesText, { width: colNotesW - 8 });

        const deviceInfoParts = [];
        if (item.imei) deviceInfoParts.push(`${L.imei}: ${item.imei}`);
        if (item.serialNumber) deviceInfoParts.push(`${L.serial}: ${item.serialNumber}`);
        if (item.simNumber) deviceInfoParts.push(`${L.sim}: ${item.simNumber}`);
        const deviceInfoText = deviceInfoParts.join('   |   ');
        const deviceInfoHeight = deviceInfoText
            ? doc.heightOfString(deviceInfoText, { width: colVehicleW - 8 }) + 4
            : 0;

        const rowHeight = Math.max(24, notesHeight + 12, deviceInfoHeight + 24);
        const hasPhotos = Array.isArray(item.photos) && item.photos.length > 0;
        const photoBlockHeight = hasPhotos ? PHOTO_SIZE + 24 : 0;

        if (y + rowHeight + photoBlockHeight > CONTENT_BOTTOM) {
            newPage();
            drawTableHeader();
        }

        if (idx % 2 === 0) {
            doc.rect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, rowHeight).fill('#FAFAFA');
        }

        if (rtl) {
            drawAutoText(doc, notesText, MARGIN_X + 4, y + 6, { width: colNotesW - 8, fontSize: 9, color: '#333333', align: 'right' });
            drawAutoText(doc, item.unitName || '-', MARGIN_X + colNotesW + 4, y + 6, { width: colVehicleW - 8, fontSize: 9, bold: true, color: '#111111', align: 'right' });
            if (deviceInfoText) {
                drawAutoText(doc, deviceInfoText, MARGIN_X + colNotesW + 4, y + 20, { width: colVehicleW - 8, fontSize: 7.5, color: '#666666', align: 'right' });
            }
            drawAutoText(doc, String(lineCounter), MARGIN_X + colNotesW + colVehicleW + 4, y + 6, { width: colLineW - 8, fontSize: 9, color: '#333333', align: 'center' });
        } else {
            drawAutoText(doc, String(lineCounter), MARGIN_X + 4, y + 6, { width: colLineW - 8, fontSize: 9, color: '#333333', align: 'center' });
            drawAutoText(doc, item.unitName || '-', MARGIN_X + colLineW + 4, y + 6, { width: colVehicleW - 8, fontSize: 9, bold: true, color: '#111111' });
            if (deviceInfoText) {
                drawAutoText(doc, deviceInfoText, MARGIN_X + colLineW + 4, y + 20, { width: colVehicleW - 8, fontSize: 7.5, color: '#666666' });
            }
            drawAutoText(doc, notesText, MARGIN_X + colLineW + colVehicleW + 4, y + 6, { width: colNotesW - 8, fontSize: 9, color: '#333333' });
        }

        y += rowHeight;

        // ---- Photos for this vehicle ----
        if (hasPhotos) {
            drawAutoText(doc, `${L.photosLabel}:`, MARGIN_X + 4, y + 4, { width: 200, fontSize: 8, color: '#777777', align });
            y += 16;

            let px = rtl ? (PAGE_WIDTH - MARGIN_X - PHOTO_SIZE) : (MARGIN_X + 4);
            const step = rtl ? -(PHOTO_SIZE + PHOTO_GAP) : (PHOTO_SIZE + PHOTO_GAP);

            item.photos.forEach(photo => {
                const filePath = path.join(uploadsDir, photo.filename);
                try {
                    if (fs.existsSync(filePath)) {
                        doc.save();
                        doc.rect(px, y, PHOTO_SIZE, PHOTO_SIZE).stroke('#DDDDDD');
                        doc.image(filePath, px, y, { fit: [PHOTO_SIZE, PHOTO_SIZE], align: 'center', valign: 'center' });
                        doc.restore();
                    }
                } catch (e) {
                    // skip unreadable image, never fail the whole PDF
                }
                px += step;
            });

            y += PHOTO_SIZE + 10;
        }

        // row divider
        doc.moveTo(MARGIN_X, y).lineTo(PAGE_WIDTH - MARGIN_X, y).strokeColor('#EEEEEE').lineWidth(0.5).stroke();
        y += 6;
    });

    // =========================================
    // Signature block — always at the bottom,
    // pushed to a new page if it wouldn't fit
    // =========================================

    const sigBlockHeight = 110;
    if (y + sigBlockHeight > CONTENT_BOTTOM) {
        newPage();
    } else {
        y += 10;
    }

    doc.moveTo(MARGIN_X, y).lineTo(PAGE_WIDTH - MARGIN_X, y).strokeColor('#CCCCCC').lineWidth(1).stroke();
    y += 16;

    const halfW = (PAGE_WIDTH - MARGIN_X * 2 - 20) / 2;
    const leftX = MARGIN_X;
    const rightX = MARGIN_X + halfW + 20;

    const infoColX = rtl ? rightX : leftX;
    const sigColX = rtl ? leftX : rightX;

    drawAutoText(doc, `${L.employee}: ${report.employeeName || '-'}`, infoColX, y, { width: halfW, fontSize: 10, color: '#222222', align });
    drawAutoText(doc, `${L.jobTitle}: ${report.jobTitle || '-'}`, infoColX, y + 18, { width: halfW, fontSize: 10, color: '#222222', align });

    drawAutoText(doc, `${L.signature}:`, sigColX, y, { width: halfW, fontSize: 10, color: '#222222', align });

    if (report.signature && report.signature.startsWith('data:image')) {
        try {
            const base64 = report.signature.split(',')[1];
            const buf = Buffer.from(base64, 'base64');
            doc.image(buf, sigColX, y + 16, { fit: [halfW, 60], align: 'left' });
        } catch (e) {
            // ignore malformed signature data
        }
    }

    doc.moveTo(sigColX, y + 80).lineTo(sigColX + halfW, y + 80).strokeColor('#999999').lineWidth(0.7).stroke();

    // =========================================
    // Page numbers — drawn last, on every
    // buffered page, now that the total count
    // is known (bufferPages: true above)
    // =========================================

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const label = `${L.page} ${i - range.start + 1} ${L.of} ${range.count}`;
        drawAutoText(doc, label, MARGIN_X, PAGE_HEIGHT - 30, {
            width: PAGE_WIDTH - MARGIN_X * 2, fontSize: 8, color: '#888888', align: 'center'
        });
    }

    doc.end();
}

module.exports = {
    buildInstallationReportPdf
};
