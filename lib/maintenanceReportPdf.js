// =====================================================
// Maintenance Report PDF builder (تقرير الصيانة - استبدال جهاز)
//
// Same structure/letterhead as lib/installationPdf.js, with the
// vehicle cell showing OLD device info (IMEI/Serial/SIM being
// removed) alongside the NEW device info (being installed).
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
const CONTENT_BOTTOM = 760;
const PHOTO_SIZE = 70;
const PHOTO_GAP = 8;

function fmtDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US');
}

/**
 * @param {object} opts
 * @param {object} opts.report   MaintenanceReport database document (or plain object)
 * @param {string} opts.uploadsDir  absolute path where item photo files live
 * @param {'ar'|'en'} [opts.lang]
 * @param {import('stream').Writable} stream
 */
function buildMaintenanceReportPdf({ report, uploadsDir, lang = 'ar' }, stream) {
    const rtl = lang === 'ar';

    const L = rtl ? {
        title: 'تقرير الصيانة (استبدال جهاز)',
        reportNo: 'رقم التقرير',
        company: 'الشركة',
        date: 'تاريخ الصيانة',
        lineNo: 'م',
        vehicle: 'رقم / اسم العربية',
        newDevice: 'الجهاز الجديد',
        oldDevice: 'الجهاز القديم',
        imei: 'IMEI',
        serial: 'Serial No.',
        sim: 'SIM No.',
        notes: 'الملاحظات',
        photosLabel: 'صور الصيانة',
        employee: 'اسم الموظف',
        jobTitle: 'المسمى الوظيفي',
        signature: 'التوقيع الإلكتروني',
        page: 'صفحة',
        of: 'من',
        noVehicles: 'لا توجد عربيات في هذا التقرير'
    } : {
        title: 'Maintenance Report (Device Swap)',
        reportNo: 'Report #',
        company: 'Company',
        date: 'Maintenance Date',
        lineNo: '#',
        vehicle: 'Vehicle',
        newDevice: 'New Device',
        oldDevice: 'Old Device',
        imei: 'IMEI',
        serial: 'Serial No.',
        sim: 'SIM No.',
        notes: 'Notes',
        photosLabel: 'Maintenance Photos',
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
    let lineCounter = 0;

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

    // ---- Header info block ----
    const headerRows = [
        [L.reportNo, report.reportNumber],
        [L.company, report.companyName],
        [L.date, fmtDate(report.maintenanceDate)]
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

    doc.moveTo(MARGIN_X, y).lineTo(PAGE_WIDTH - MARGIN_X, y).strokeColor('#E0E0E0').lineWidth(1).stroke();
    y += 16;

    // ---- Vehicles table header ----
    const colLineW = 26;
    const colVehicleW = 100;
    const colDeviceW = (PAGE_WIDTH - MARGIN_X * 2 - colLineW - colVehicleW) / 2;

    function drawTableHeader() {
        doc.rect(MARGIN_X, y, PAGE_WIDTH - MARGIN_X * 2, 20).fill('#C0392B');

        if (rtl) {
            drawAutoText(doc, L.oldDevice, MARGIN_X + 4, y + 5, { width: colDeviceW - 8, fontSize: 9, bold: true, color: '#FFFFFF', align: 'right' });
            drawAutoText(doc, L.newDevice, MARGIN_X + colDeviceW + 4, y + 5, { width: colDeviceW - 8, fontSize: 9, bold: true, color: '#FFFFFF', align: 'right' });
            drawAutoText(doc, L.vehicle, MARGIN_X + colDeviceW * 2 + 4, y + 5, { width: colVehicleW - 8, fontSize: 9, bold: true, color: '#FFFFFF', align: 'right' });
            drawAutoText(doc, L.lineNo, MARGIN_X + colDeviceW * 2 + colVehicleW + 4, y + 5, { width: colLineW - 8, fontSize: 9, bold: true, color: '#FFFFFF', align: 'center' });
        } else {
            drawAutoText(doc, L.lineNo, MARGIN_X + 4, y + 5, { width: colLineW - 8, fontSize: 9, bold: true, color: '#FFFFFF', align: 'center' });
            drawAutoText(doc, L.vehicle, MARGIN_X + colLineW + 4, y + 5, { width: colVehicleW - 8, fontSize: 9, bold: true, color: '#FFFFFF' });
            drawAutoText(doc, L.newDevice, MARGIN_X + colLineW + colVehicleW + 4, y + 5, { width: colDeviceW - 8, fontSize: 9, bold: true, color: '#FFFFFF' });
            drawAutoText(doc, L.oldDevice, MARGIN_X + colLineW + colVehicleW + colDeviceW + 4, y + 5, { width: colDeviceW - 8, fontSize: 9, bold: true, color: '#FFFFFF' });
        }
        y += 20;
    }

    drawTableHeader();

    const items = Array.isArray(report.items) ? report.items : [];

    if (items.length === 0) {
        drawAutoText(doc, L.noVehicles, MARGIN_X, y + 8, { width: PAGE_WIDTH - MARGIN_X * 2, fontSize: 10, color: '#999999', align: 'center' });
        y += 30;
    }

    function deviceLines(imei, serial, sim) {
        const lines = [];
        lines.push(`${L.imei}: ${imei || '-'}`);
        lines.push(`${L.serial}: ${serial || '-'}`);
        lines.push(`${L.sim}: ${sim || '-'}`);
        return lines.join('\n');
    }

    items.forEach((item, idx) => {

        lineCounter += 1;

        const newDeviceText = deviceLines(item.imei, item.serialNumber, item.simNumber);
        const oldDeviceText = deviceLines(item.oldImei, item.oldSerialNumber, item.oldSimNumber);

        doc.font('Helvetica').fontSize(8.5);
        const newHeight = doc.heightOfString(newDeviceText, { width: colDeviceW - 8 });
        const oldHeight = doc.heightOfString(oldDeviceText, { width: colDeviceW - 8 });

        const rowHeight = Math.max(24, newHeight + 12, oldHeight + 12);
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
            drawAutoText(doc, oldDeviceText, MARGIN_X + 4, y + 6, { width: colDeviceW - 8, fontSize: 8.5, color: '#8a4a4a', align: 'right' });
            drawAutoText(doc, newDeviceText, MARGIN_X + colDeviceW + 4, y + 6, { width: colDeviceW - 8, fontSize: 8.5, color: '#2f6b2f', align: 'right' });
            drawAutoText(doc, item.unitName || '-', MARGIN_X + colDeviceW * 2 + 4, y + 6, { width: colVehicleW - 8, fontSize: 9, bold: true, color: '#111111', align: 'right' });
            drawAutoText(doc, String(lineCounter), MARGIN_X + colDeviceW * 2 + colVehicleW + 4, y + 6, { width: colLineW - 8, fontSize: 9, color: '#333333', align: 'center' });
        } else {
            drawAutoText(doc, String(lineCounter), MARGIN_X + 4, y + 6, { width: colLineW - 8, fontSize: 9, color: '#333333', align: 'center' });
            drawAutoText(doc, item.unitName || '-', MARGIN_X + colLineW + 4, y + 6, { width: colVehicleW - 8, fontSize: 9, bold: true, color: '#111111' });
            drawAutoText(doc, newDeviceText, MARGIN_X + colLineW + colVehicleW + 4, y + 6, { width: colDeviceW - 8, fontSize: 8.5, color: '#2f6b2f' });
            drawAutoText(doc, oldDeviceText, MARGIN_X + colLineW + colVehicleW + colDeviceW + 4, y + 6, { width: colDeviceW - 8, fontSize: 8.5, color: '#8a4a4a' });
        }

        y += rowHeight;

        // ---- Notes (full width, if any) ----
        if (item.notes) {
            drawAutoText(doc, item.notes, MARGIN_X + 4, y + 2, { width: PAGE_WIDTH - MARGIN_X * 2 - 8, fontSize: 8, color: '#555555', align });
            const notesH = doc.heightOfString(item.notes, { width: PAGE_WIDTH - MARGIN_X * 2 - 8 });
            y += notesH + 8;
        }

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
                    // skip unreadable image
                }
                px += step;
            });

            y += PHOTO_SIZE + 10;
        }

        doc.moveTo(MARGIN_X, y).lineTo(PAGE_WIDTH - MARGIN_X, y).strokeColor('#EEEEEE').lineWidth(0.5).stroke();
        y += 6;
    });

    // =========================================
    // Signature block
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
    // Page numbers
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
    buildMaintenanceReportPdf
};
