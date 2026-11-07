const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const { sendSmsBatch, normalizeMsisdn } = require('../lib/vodafoneSms');
const { sendWhatsAppMessage, isWhatsAppConfigured } = require('../lib/whatsapp');
const { requireAuth, requireAdmin, requirePermission } = require('../middleware/auth');
const SmsLog = require('../models/SmsLog');
const SmsQuotaSettings = require('../models/SmsQuotaSettings');
const User = require('../models/User');
const { buildSmsReportPdf } = require('../lib/reportPdf');
// EDIT BY NADA — reuse the Wialon integration's existing per-user unit scope.
const { getUnitsForUser } = require('../lib/wialon');

const LOGO_PATH = path.join(__dirname, '..', 'public', 'assets', 'logo-full.jpg');

// EDIT BY NADA — the recipient picker reads real Wialon data; no seeded fallback.
router.get('/units', requireAuth, requirePermission('sms'), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        const units = await getUnitsForUser(req.session.user);
        const text = value => value == null ? '' : String(value).trim();
        const recipients = units.map(unit => {
            const type = text(unit.deviceType);
            return {
                id: unit.id,
                name: text(unit.name),
                accountGroup: text(unit.accountGroup),
                deviceType: /^unknown(?:\s+hw(?:\s*\([^)]*\))?)?$/i.test(type) ? '' : type,
                mobileNumber: text(unit.mobileNumber),
                serialNumber: text(unit.serialNumber),
                status: text(unit.status)
            };
        });
        res.json({ success: true, source: 'wialon', integrationAvailable: true, units: recipients });
    } catch (error) {
        const sessionExpired = error.code === 'WIALON_SESSION_EXPIRED';
        res.status(sessionExpired ? 401 : 502).json({
            success: false,
            error: sessionExpired ? 'Wialon session expired. Sign in again.' : 'Unable to load units from Wialon. Please retry.',
            sessionExpired,
            units: []
        });
    }
});

// =====================================================
// HELPER: resolve which customer a unit belongs to
// (matches unit name against each customer's
// assignedUnitNames, case-insensitively).
// =====================================================

async function resolveCustomerNameForUnit(unitName) {
    if (!unitName) return '';

    const needle = String(unitName).trim().toLowerCase();
    const customers = await User.find({ role: 'customer' });

    for (const c of customers) {
        const match = (c.assignedUnitNames || []).some(
            n => String(n).trim().toLowerCase() === needle
        );
        if (match) return c.displayName || c.username;
    }

    return '';
}

// =====================================================
// HELPER: current quota cycle window, anchored on the
// configured renewal day (default 11th of each Gregorian
// month) — item #3.
// =====================================================

function getCurrentCycle(renewalDay, now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-based
    const day = now.getUTCDate();

    let cycleStart;
    if (day >= renewalDay) {
        cycleStart = new Date(Date.UTC(year, month, renewalDay));
    } else {
        cycleStart = new Date(Date.UTC(year, month - 1, renewalDay));
    }

    const cycleEnd = new Date(Date.UTC(
        cycleStart.getUTCFullYear(),
        cycleStart.getUTCMonth() + 1,
        renewalDay
    ));

    return { cycleStart, cycleEnd };
}

// =====================================================
// POST /api/sms/send
// body: {
//   numbers: "201000000000, 201100000000" | [...],
//   text: "message body",
//   unitId?, unitName?   <- optional linked vehicle (item #2)
// }
// =====================================================

router.post('/send', requireAuth, requirePermission('sms'), async (req, res) => {
    try {
        const { numbers, text, unitId, unitName } = req.body;
        const channel = (req.body.channel || 'sms').toLowerCase() === 'whatsapp' ? 'whatsapp' : 'sms';

        if (channel === 'whatsapp' && !isWhatsAppConfigured()) {
            return res.status(400).json({
                success: false,
                error: 'WhatsApp is not configured yet. Add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID to .env first.'
            });
        }

        if (!text || !String(text).trim()) {
            return res.status(400).json({ success: false, error: 'SMS text is required' });
        }

        let numberList = [];

        if (Array.isArray(numbers)) {
            numberList = numbers;
        } else if (typeof numbers === 'string') {
            numberList = numbers.split(/[\n,]+/);
        }

        numberList = numberList
            .map(n => String(n).trim())
            .filter(Boolean);

        if (numberList.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one phone number is required' });
        }

        if (numberList.length > 1000) {
            return res.status(400).json({
                success: false,
                error: 'SMS List exceeds the limit of MaxSms (1000 per request).'
            });
        }

        const sessionUser = req.session.user;
        const results = [];

        const customerName = unitName
            ? await resolveCustomerNameForUnit(unitName)
            : '';

        // Vodafone allows up to 1000 in one HTTP call, but we send
        // one-by-one here so a bad number doesn't fail the whole batch
        // and every attempt gets its own log row + per-number status.
        for (const rawNumber of numberList) {
            const receiverMSISDN = normalizeMsisdn(rawNumber);

            const logBase = {
                receiverMSISDN,
                smsText: text,
                source: 'manual',
                channel,
                sentBy: sessionUser.username,
                unitId: unitId || '',
                unitName: unitName || '',
                customerName
            };

            try {
                if (channel === 'whatsapp') {
                    await sendWhatsAppMessage(receiverMSISDN, text);
                } else {
                    await sendSmsBatch(
                        [{ receiverMSISDN, smsText: text }],
                        { type: 'notification' }
                    );
                }

                await SmsLog.create({ ...logBase, status: 'submitted' });
                results.push({ number: receiverMSISDN, success: true });

            } catch (error) {
                await SmsLog.create({ ...logBase, status: 'failed', errorMessage: error.message });
                results.push({ number: receiverMSISDN, success: false, error: error.message });
            }
        }

        const successCount = results.filter(r => r.success).length;

        res.json({
            success: true,
            sent: successCount,
            failed: results.length - successCount,
            results
        });

    } catch (error) {
        console.error('❌ SMS send error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// GET /api/sms/report?month=YYYY-MM
// GET /api/sms/report?date=YYYY-MM-DD
//
// Report filtered by a specific day OR a specific month
// (item #2). Each row includes: mobile number, device ID,
// vehicle name, customer name, status, date.
// If ?date is given it takes priority over ?month.
// =====================================================

// Shared: resolve the date/month query params into a {start,end,label}
// window, then fetch + aggregate the matching SmsLog rows. Used by both
// the JSON report endpoint and the Excel/PDF export endpoint below so
// the numbers never drift apart between the on-screen report and the
// exported file.
async function getReportData(dateParam, monthParam, channelParam, sourceParam) {
    let start, end, label;

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        const [year, month, day] = dateParam.split('-').map(Number);
        start = new Date(Date.UTC(year, month - 1, day));
        end = new Date(Date.UTC(year, month - 1, day + 1));
        label = dateParam;

    } else if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
        const [year, month] = monthParam.split('-').map(Number);
        start = new Date(Date.UTC(year, month - 1, 1));
        end = new Date(Date.UTC(year, month, 1));
        label = monthParam;

    } else {
        const now = new Date();
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    const query = { createdAt: { $gte: start, $lt: end } };

    // channel: 'sms' | 'whatsapp' | 'all' (default: all)
    if (channelParam && ['sms', 'whatsapp'].includes(channelParam)) {
        query.channel = channelParam;
    }

    // source: 'manual' | 'alert' | 'activation' (automatic per-unit
    // offline SMS checks) | 'all' (default: all)
    if (sourceParam && ['manual', 'alert', 'activation'].includes(sourceParam)) {
        query.source = sourceParam;
    }

    const logs = await SmsLog.find(query).sort({ createdAt: -1 });

    const totalSent = logs.filter(l => l.status === 'submitted').length;
    const totalFailed = logs.filter(l => l.status === 'failed').length;

    // Breakdown per receiver number, handy to see who got how many
    const perNumber = {};
    for (const log of logs) {
        if (!perNumber[log.receiverMSISDN]) {
            perNumber[log.receiverMSISDN] = {
                number: log.receiverMSISDN,
                unitName: log.unitName || '-',
                customerName: log.customerName || '-',
                sent: 0,
                failed: 0
            };
        }
        if (log.status === 'submitted') perNumber[log.receiverMSISDN].sent++;
        else perNumber[log.receiverMSISDN].failed++;
    }

    return {
        label,
        logs,
        totalSent,
        totalFailed,
        total: logs.length,
        perNumber: Object.values(perNumber).sort((a, b) => b.sent - a.sent)
    };
}

router.get('/report', requireAuth, requirePermission('reports'), async (req, res) => {
    try {
        const data = await getReportData(req.query.date, req.query.month, req.query.channel, req.query.source);

        res.json({
            success: true,
            filter: data.label,
            totalSent: data.totalSent,
            totalFailed: data.totalFailed,
            total: data.total,
            perNumber: data.perNumber,
            logs: data.logs
        });

    } catch (error) {
        console.error('❌ SMS report error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// GET /api/sms/report/export?date=&month=&format=xlsx|pdf&lang=en|ar
//
// item #6: "Reports" export — same data as /report above, but
// as a downloadable file. format=xlsx or pdf, lang=en or ar.
// The PDF uses the real Observer letterhead as its page
// background (public/assets/generated/letterhead-1.png).
// =====================================================

router.get('/report/export', requireAuth, requirePermission('reports'), async (req, res) => {
    try {
        const format = (req.query.format || 'xlsx').toLowerCase();
        const lang = (req.query.lang || 'en').toLowerCase() === 'ar' ? 'ar' : 'en';

        const data = await getReportData(req.query.date, req.query.month, req.query.channel, req.query.source);
        const stamp = new Date().toISOString().slice(0, 10);

        if (format === 'pdf') {
            const filename = `observer-sms-report-${data.label}-${lang}-${stamp}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${filename}"`);

            buildSmsReportPdf({
                logs: data.logs,
                totalSent: data.totalSent,
                totalFailed: data.totalFailed,
                total: data.total,
                periodLabel: data.label,
                lang
            }, res);
            return;
        }

        // ---- xlsx (default) ----
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Observer Fleet';
        workbook.created = new Date();

        const sheet = workbook.addWorksheet(lang === 'ar' ? 'تقرير الرسائل' : 'SMS Report');
        sheet.views = [{ rightToLeft: lang === 'ar' }];

        if (fs.existsSync(LOGO_PATH)) {
            const imageId = workbook.addImage({ filename: LOGO_PATH, extension: 'jpeg' });
            sheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 160, height: 90 } });
        }

        sheet.mergeCells('C1:H1');
        sheet.getCell('C1').value = lang === 'ar' ? 'تقرير الرسائل النصية - Observer' : 'Observer — SMS Report';
        sheet.getCell('C1').font = { bold: true, size: 16, color: { argb: 'FF1976D2' } };

        sheet.getCell('C2').value = `${lang === 'ar' ? 'الفترة / Period' : 'Period'}: ${data.label}`;
        sheet.getCell('C2').font = { size: 10, color: { argb: 'FF666666' } };

        sheet.getCell('C3').value = `${lang === 'ar' ? 'الإجمالي / تم / فشل' : 'Total / Sent / Failed'}: ${data.total} / ${data.totalSent} / ${data.totalFailed}`;
        sheet.getCell('C3').font = { size: 10, color: { argb: 'FF666666' } };

        const headerRowIndex = 6;
        const headers = lang === 'ar'
            ? ['#', 'رقم الموبايل', 'رقم الجهاز / العربية', 'اسم العميل', 'القناة', 'المصدر', 'الحالة', 'التاريخ والوقت', 'رسالة الخطأ']
            : ['#', 'Mobile Number', 'Device / Unit', 'Customer', 'Channel', 'Source', 'Status', 'Date & Time', 'Error'];

        sheet.getRow(headerRowIndex).values = headers;
        const headerRow = sheet.getRow(headerRowIndex);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };

        sheet.columns = [
            { key: 'idx', width: 6 },
            { key: 'number', width: 18 },
            { key: 'unit', width: 20 },
            { key: 'customer', width: 20 },
            { key: 'channel', width: 12 },
            { key: 'source', width: 14 },
            { key: 'status', width: 14 },
            { key: 'date', width: 22 },
            { key: 'error', width: 30 }
        ];

        data.logs.forEach((log, i) => {
            const isFail = log.status === 'failed';
            const row = sheet.addRow({
                idx: i + 1,
                number: log.receiverMSISDN || '-',
                unit: log.unitName || '-',
                customer: log.customerName || '-',
                channel: log.channel === 'whatsapp'
                    ? (lang === 'ar' ? 'واتساب' : 'WhatsApp')
                    : (lang === 'ar' ? 'SMS' : 'SMS'),
                source: log.source === 'alert'
                    ? (lang === 'ar' ? 'تنبيه تلقائي (Wialon)' : 'Auto alert (Wialon)')
                    : (lang === 'ar' ? 'يدوي' : 'Manual'),
                status: isFail
                    ? (lang === 'ar' ? 'فشل' : 'Failed')
                    : (lang === 'ar' ? 'تم الإرسال' : 'Submitted'),
                date: log.createdAt ? new Date(log.createdAt).toLocaleString('en-US') : '-',
                error: log.errorMessage || ''
            });
            if (isFail) row.getCell('status').font = { color: { argb: 'FFD32F2F' }, bold: true };
        });

        sheet.autoFilter = { from: { row: headerRowIndex, column: 1 }, to: { row: headerRowIndex, column: 9 } };

        const filename = `observer-sms-report-${data.label}-${lang}-${stamp}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${filename}"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('❌ SMS report export error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// GET  /api/sms/quota-settings
// PUT  /api/sms/quota-settings   { totalContracted, renewalDay? }
//
// item #3: total contracted SMS quota from Vodafone, and
// the day-of-month it renews (default 11th).
// PUT is admin-only.
// =====================================================

router.get('/quota-settings', requireAuth, requirePermission('quota'), async (req, res) => {
    try {
        const settings = await SmsQuotaSettings.getSettings();
        res.json({ success: true, settings });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/quota-settings', requireAdmin, async (req, res) => {
    try {
        const { totalContracted, renewalDay } = req.body;

        const settings = await SmsQuotaSettings.getSettings();

        if (totalContracted !== undefined) {
            const n = Number(totalContracted);
            if (!Number.isFinite(n) || n < 0) {
                return res.status(400).json({ success: false, error: 'totalContracted must be a positive number' });
            }
            settings.totalContracted = n;
        }

        if (renewalDay !== undefined) {
            const d = Number(renewalDay);
            if (!Number.isInteger(d) || d < 1 || d > 28) {
                return res.status(400).json({ success: false, error: 'renewalDay must be an integer between 1 and 28' });
            }
            settings.renewalDay = d;
        }

        settings.updatedBy = req.session.user.username;
        await settings.save();

        res.json({ success: true, settings });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// GET /api/sms/status
//
// Line status: last message sent, count sent today, and
// used/remaining for the CURRENT QUOTA CYCLE (anchored on
// the renewal day, not the calendar month) — items #3 & #4.
// =====================================================

router.get('/status', requireAuth, requirePermission('status'), async (req, res) => {
    try {
        const settings = await SmsQuotaSettings.getSettings();
        const { cycleStart, cycleEnd } = getCurrentCycle(settings.renewalDay);

        const lastLog = await SmsLog.findOne().sort({ createdAt: -1 });

        const now = new Date();
        const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

        const [usedThisCycle, sentToday] = await Promise.all([
            SmsLog.countDocuments({
                status: 'submitted',
                createdAt: { $gte: cycleStart, $lt: cycleEnd }
            }),
            SmsLog.countDocuments({
                status: 'submitted',
                createdAt: { $gte: startOfDay }
            })
        ]);

        const quota = settings.totalContracted || 0;
        const remaining = Math.max(quota - usedThisCycle, 0);

        res.json({
            success: true,
            lastMessage: lastLog ? {
                number: lastLog.receiverMSISDN,
                text: lastLog.smsText,
                status: lastLog.status,
                sentAt: lastLog.createdAt,
                sentBy: lastLog.sentBy,
                unitName: lastLog.unitName || ''
            } : null,
            sentToday,
            cycle: {
                start: cycleStart,
                end: cycleEnd,
                renewalDay: settings.renewalDay
            },
            totalContracted: quota,
            usedThisCycle,
            remainingThisCycle: remaining
        });

    } catch (error) {
        console.error('❌ SMS status error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
