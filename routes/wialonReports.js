const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');

const { requireAuth, requirePermission, requireLocalAccount } = require('../middleware/auth');
router.use(requireLocalAccount);
const { getUnitsForUser, wialonLogout } = require('../lib/wialon');
const {
    listReportTemplates,
    runReport,
    resolveSid
} = require('../lib/wialonReports');
const { buildGenericReportPdf } = require('../lib/reportPdf');

// =====================================================
// GET /api/wialon-reports/templates
//
// Lists whatever report templates already exist in Wialon.
// Uses the logged-in user's Wialon session when available.
// Falls back to master token when needed.
// =====================================================

router.get(
    '/templates',
    requireAuth,
    requirePermission('wialonReports'),
    async (req, res) => {

        console.log('\n========================================');
        console.log('📡 GET /api/wialon-reports/templates HIT');
        console.log(
            '👤 User:',
            req.session?.user?.username ||
            req.session?.user?.email ||
            req.session?.user?.name ||
            'unknown'
        );
        console.log(
            '🔐 wialonSid:',
            req.session?.user?.wialonSid ? 'EXISTS' : 'MISSING'
        );
        console.log(
            '🔐 authMode:',
            req.session?.user?.authMode || 'unknown'
        );
        console.log(
            '🔐 wialonAccounts:',
            Array.isArray(req.session?.user?.wialonAccounts)
                ? req.session.user.wialonAccounts.length
                : 'N/A'
        );
        console.log('========================================');

        let sid = null;
        let ownedByUs = false;

        try {

            console.log('🔑 Resolving Wialon SID...');

            const resolved = await resolveSid(req.session.user);

            console.log('🔑 resolveSid result:', {
                hasSid: !!resolved?.sid,
                sidLength: resolved?.sid ? resolved.sid.length : 0,
                ownedByUs: !!resolved?.ownedByUs
            });

            sid = resolved.sid;
            ownedByUs = resolved.ownedByUs;

            if (!sid) {
                throw new Error('Unable to resolve Wialon session ID');
            }

            console.log('📊 Calling listReportTemplates()...');

            const templates = await listReportTemplates(sid);

            console.log(
                '✅ listReportTemplates() returned:',
                Array.isArray(templates)
                    ? `${templates.length} template(s)`
                    : typeof templates
            );

            if (Array.isArray(templates)) {
                console.log(
                    '📋 Template names:',
                    templates.map(t => ({
                        id: t.templateId,
                        name: t.name,
                        resourceId: t.resourceId
                    }))
                );
            }

            return res.json({
                success: true,
                templates: Array.isArray(templates) ? templates : []
            });

        } catch (error) {

            console.error('\n❌ WIALON TEMPLATES ERROR');
            console.error('Message:', error.message);
            console.error('Stack:', error.stack);
            console.error('========================================\n');

            return res.status(500).json({
                success: false,
                error: error.message
            });

        } finally {

            if (sid && ownedByUs) {

                try {

                    console.log('🔌 Logging out temporary Wialon SID...');

                    await wialonLogout(sid);

                    console.log('✅ Temporary Wialon SID logged out');

                } catch (logoutError) {

                    console.error(
                        '⚠️ Template SID logout error:',
                        logoutError.message
                    );
                }
            }
        }
    }
);


// =====================================================
// GET /api/wialon-reports/units
//
// Units this logged-in user is allowed to pick from.
// Reuses the exact same scoping as Dashboard/Units.
// =====================================================

router.get(
    '/units',
    requireAuth,
    requirePermission('wialonReports'),
    async (req, res) => {

        console.log('\n========================================');
        console.log('📡 GET /api/wialon-reports/units HIT');
        console.log('========================================');

        try {

            const units = await getUnitsForUser(req.session.user);

            console.log(
                '✅ Report units:',
                Array.isArray(units) ? units.length : 0
            );

            return res.json({
                success: true,
                units: units.map(u => ({
                    id: u.id,
                    name: u.name
                }))
            });

        } catch (error) {

            console.error(
                '❌ Wialon report units error:',
                error.message
            );

            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);


// =====================================================
// Shared helper
//
// Validate requested unit IDs against what the user
// is actually allowed to see and parse date range.
// =====================================================

async function resolveRunRequest(req) {

    const {
        templateId,
        resourceId,
        unitIds,
        dateFrom,
        dateTo
    } = req.body.templateId !== undefined
        ? req.body
        : req.query;

    if (!templateId) {
        throw new Error('templateId is required');
    }

    if (!dateFrom || !dateTo) {
        throw new Error(
            'dateFrom and dateTo are required (YYYY-MM-DD)'
        );
    }

    const allowedUnits = await getUnitsForUser(
        req.session.user
    );

    const requestedIds = (
        Array.isArray(unitIds)
            ? unitIds
            : String(unitIds || '').split(',')
    )
        .map(id => Number(id))
        .filter(Boolean);

    const units = requestedIds.length
        ? allowedUnits.filter(
            u => requestedIds.includes(u.id)
        )
        : allowedUnits;

    if (units.length === 0) {
        throw new Error(
            'No matching units — either none was selected or you do not have access to the ones requested'
        );
    }

    const fromDate = new Date(
        `${dateFrom}T00:00:00`
    );

    const toDate = new Date(
        `${dateTo}T23:59:59`
    );

    if (
        Number.isNaN(fromDate.getTime()) ||
        Number.isNaN(toDate.getTime())
    ) {
        throw new Error(
            'Invalid date range. Use YYYY-MM-DD'
        );
    }

    const interval = {
        from: Math.floor(
            fromDate.getTime() / 1000
        ),
        to: Math.floor(
            toDate.getTime() / 1000
        )
    };

    return {
        templateId: Number(templateId),
        resourceId: resourceId
            ? Number(resourceId)
            : null,
        units,
        interval
    };
}


// =====================================================
// POST /api/wialon-reports/run
//
// Runs the selected report and returns JSON tables.
// =====================================================

router.post(
    '/run',
    requireAuth,
    requirePermission('wialonReports'),
    async (req, res) => {

        console.log('\n========================================');
        console.log('📡 POST /api/wialon-reports/run HIT');
        console.log('========================================');

        try {

            const {
                templateId,
                resourceId,
                units,
                interval
            } = await resolveRunRequest(req);

            console.log('📊 Running report:', {
                templateId,
                resourceId,
                units: units.length,
                interval
            });

            const results = await runReport({
                templateId,
                resourceId,
                units,
                interval,
                sessionUser: req.session.user
            });

            console.log(
                '✅ Report execution completed:',
                results?.length || 0,
                'unit result(s)'
            );

            return res.json({
                success: true,
                results
            });

        } catch (error) {

            console.error(
                '❌ Wialon report run error:',
                error.message
            );

            return res.status(400).json({
                success: false,
                error: error.message
            });
        }
    }
);


// =====================================================
// GET /api/wialon-reports/export
//
// ?format=xlsx|pdf
// ?lang=en|ar
// ?download=1
// =====================================================

router.get(
    '/export',
    requireAuth,
    requirePermission('wialonReports'),
    async (req, res) => {

        console.log('\n========================================');
        console.log('📡 GET /api/wialon-reports/export HIT');
        console.log('========================================');

        let templatesSid = null;
        let templatesSidOwnedByUs = false;

        try {

            const {
                templateId,
                resourceId,
                units,
                interval
            } = await resolveRunRequest(req);

            console.log('📊 Export request:', {
                templateId,
                resourceId,
                units: units.length,
                interval,
                format: req.query.format,
                lang: req.query.lang
            });

            const results = await runReport({
                templateId,
                resourceId,
                units,
                interval,
                sessionUser: req.session.user
            });

            const format =
                req.query.format === 'pdf'
                    ? 'pdf'
                    : 'xlsx';

            const lang =
                req.query.lang === 'ar'
                    ? 'ar'
                    : 'en';

            const download =
                req.query.download === '1';


            // =================================================
            // Resolve template name
            // =================================================

            const resolved = await resolveSid(
                req.session.user
            );

            templatesSid = resolved.sid;
            templatesSidOwnedByUs = resolved.ownedByUs;

            const templates =
                await listReportTemplates(
                    templatesSid
                );

            const templateName =
                (
                    templates.find(
                        t =>
                            t.templateId ===
                            Number(templateId)
                    ) || {}
                ).name ||
                `Template ${templateId}`;


            // =================================================
            // Filename
            // =================================================

            const stamp =
                new Date()
                    .toISOString()
                    .slice(0, 10);

            const safeTemplateName =
                templateName.replace(
                    /[^a-z0-9\u0600-\u06FF]/gi,
                    '_'
                );


            // =================================================
            // XLSX
            // =================================================

            if (format === 'xlsx') {

                const workbook =
                    new ExcelJS.Workbook();

                workbook.creator =
                    'Observer Fleet';

                workbook.created =
                    new Date();


                results.forEach(result => {

                    const sheet =
                        workbook.addWorksheet(
                            String(result.unitName)
                                .substring(0, 28) ||
                            'Unit'
                        );


                    // Header

                    sheet.getCell('A1').value =
                        'OBSERVER';

                    sheet.getCell('A1').font = {
                        bold: true,
                        size: 16,
                        color: {
                            argb: 'FF1976D2'
                        }
                    };


                    sheet.getCell('A2').value =
                        `${templateName} — ${result.unitName}`;

                    sheet.getCell('A2').font = {
                        italic: true,
                        size: 10,
                        color: {
                            argb: 'FF888888'
                        }
                    };


                    sheet.addRow([]);


                    // No data

                    if (!result.tables.length) {

                        sheet.addRow([
                            'No data for this unit in the selected period'
                        ]);

                        return;
                    }


                    // Tables

                    result.tables.forEach(table => {

                        sheet.addRow([
                            table.name || ''
                        ]).font = {
                            bold: true
                        };


                        const headerRow =
                            sheet.addRow(
                                table.headers
                            );

                        headerRow.font = {
                            bold: true,
                            color: {
                                argb: 'FFFFFFFF'
                            }
                        };

                        headerRow.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: {
                                argb: 'FF1976D2'
                            }
                        };


                        table.rows.forEach(row => {
                            sheet.addRow(row);
                        });


                        sheet.addRow([]);
                    });

                });


                const filename =
                    `wialon-report-${safeTemplateName}-${stamp}.xlsx`;


                res.setHeader(
                    'Content-Type',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                );

                res.setHeader(
                    'Content-Disposition',
                    `attachment; filename="${filename}"`
                );


                await workbook.xlsx.write(res);

                return res.end();
            }


            // =================================================
            // PDF
            // =================================================

            const sections = [];


            results.forEach(result => {

                if (!result.tables.length) {

                    sections.push({
                        title: result.unitName,
                        headers: [],
                        rows: []
                    });

                    return;
                }


                result.tables.forEach(table => {

                    sections.push({
                        title:
                            `${result.unitName} — ${table.name || ''}`,

                        headers:
                            table.headers,

                        rows:
                            table.rows
                    });

                });

            });


            const filename =
                `wialon-report-${safeTemplateName}-${stamp}.pdf`;


            res.setHeader(
                'Content-Type',
                'application/pdf'
            );

            res.setHeader(
                'Content-Disposition',
                `${download ? 'attachment' : 'inline'}; filename="${filename}"`
            );


            buildGenericReportPdf(
                {
                    title:
                        lang === 'ar'
                            ? 'تقرير وايلون'
                            : 'Wialon Report',

                    subtitle:
                        `${templateName} — ${req.query.dateFrom} → ${req.query.dateTo}`,

                    sections,

                    lang
                },
                res
            );

        } catch (error) {

            console.error(
                '❌ Wialon report export error:',
                error.message
            );

            if (!res.headersSent) {

                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }

        } finally {

            if (
                templatesSid &&
                templatesSidOwnedByUs
            ) {

                try {

                    await wialonLogout(
                        templatesSid
                    );

                } catch (logoutError) {

                    console.error(
                        '⚠️ Export template SID logout error:',
                        logoutError.message
                    );
                }
            }
        }
    }
);


// =====================================================
// EXPORT
// =====================================================

module.exports = router;
