const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');

const MaintenanceRequest = require('../models/MaintenanceRequest');
const User = require('../models/User');
const { sendReportEmail, isConfigured } = require('../lib/mailer');
const { buildGenericReportPdf } = require('../lib/reportPdf');

const {
    requireAuth,
    requirePermission
} = require('../middleware/auth');

const {
    getUnitsForUser
} = require('../lib/wialon');


// =====================================================
// NOTIFY SUPPORT (email) — fire-and-forget, never blocks
// or fails the request-creation response. Logs instead of
// throwing if SMTP isn't configured yet.
// =====================================================

async function notifySupportOfNewRequest(request) {

    if (!isConfigured()) {
        console.warn('⚠️  SUPPORT_EMAIL notification skipped — SMTP is not configured in .env');
        return;
    }

    const supportEmail = process.env.SUPPORT_EMAIL || 'Support@obserevereg.com';
    const vehicleList = request.vehicles.map(v => `- ${v.unitName}`).join('\n');

    try {
        await sendReportEmail({
            to: supportEmail,
            subject: `[Observer] New Maintenance Request ${request.requestNumber} (${request.priority})`,
            text:
                `A new maintenance request was submitted.\n\n` +
                `Request #: ${request.requestNumber}\n` +
                `Customer: ${request.customerName}\n` +
                `Priority: ${request.priority}\n` +
                `Title: ${request.title}\n\n` +
                `Vehicles:\n${vehicleList}\n\n` +
                `Description:\n${request.description}\n\n` +
                `Open it in Observer: /maintenance.html`
        });

        console.log(`📧 Support notified of ${request.requestNumber} -> ${supportEmail}`);

    } catch (error) {
        // Never fail the customer-facing request because the email
        // provider is down — they still get the in-app badge.
        console.error('❌ Support notification email failed:', error.message);
    }
}


// =====================================================
// HELPERS
// =====================================================

function getCurrentUser(req) {
    return req.session && req.session.user
        ? req.session.user
        : null;
}


function isAdmin(user) {
    return user && user.role === 'admin';
}


function isCustomer(user) {
    return user && user.role === 'customer';
}


function userName(user) {
    return (
        user.displayName ||
        user.username ||
        'Unknown User'
    );
}


// =====================================================
// GET CUSTOMER ALLOWED VEHICLES
// GET /api/maintenance/vehicles
// =====================================================

router.get(
    '/vehicles',
    requireAuth,
    requirePermission('maintenance'),
    async (req, res) => {

        try {

            const user = getCurrentUser(req);

            const units =
                await getUnitsForUser(user);

            return res.json({
                success: true,
                units: units.map(unit => ({
                    id: String(unit.id),
                    name: unit.name,
                    status: unit.status,
                    location: unit.location,
                    batteryVolts: unit.batteryVolts,
                    deviceBatteryVolts: unit.deviceBatteryVolts
                }))
            });

        } catch (error) {

            console.error(
                '❌ Maintenance vehicles error:',
                error
            );

            return res.status(500).json({
                success: false,
                error: 'Failed to load vehicles'
            });
        }
    }
);


// =====================================================
// CREATE MAINTENANCE REQUEST
// POST /api/maintenance
// =====================================================

router.post(
    '/',
    requireAuth,
    requirePermission('maintenance'),
    async (req, res) => {

        try {

            const user = getCurrentUser(req);

            const {
                vehicleIds,
                title,
                description,
                priority
            } = req.body;


            // -----------------------------------------
            // Validation
            // -----------------------------------------

            if (
                !Array.isArray(vehicleIds) ||
                vehicleIds.length === 0
            ) {

                return res.status(400).json({
                    success: false,
                    error: 'Please select at least one vehicle'
                });
            }


            if (
                !title ||
                !String(title).trim()
            ) {

                return res.status(400).json({
                    success: false,
                    error: 'Request title is required'
                });
            }


            if (
                !description ||
                !String(description).trim()
            ) {

                return res.status(400).json({
                    success: false,
                    error: 'Problem description is required'
                });
            }


            const allowedPriorities = [
                'low',
                'medium',
                'high',
                'critical'
            ];


            const selectedPriority =
                allowedPriorities.includes(priority)
                    ? priority
                    : 'medium';


            // -----------------------------------------
            // Get ONLY allowed Wialon units
            // -----------------------------------------

            const allowedUnits =
                await getUnitsForUser(user);


            const allowedMap =
                new Map(
                    allowedUnits.map(unit => [
                        String(unit.id),
                        unit
                    ])
                );


            // -----------------------------------------
            // Validate selected vehicles
            // -----------------------------------------

            const uniqueVehicleIds =
                [
                    ...new Set(
                        vehicleIds.map(id => String(id))
                    )
                ];


            const vehicles = [];


            for (const vehicleId of uniqueVehicleIds) {

                const unit =
                    allowedMap.get(vehicleId);


                if (!unit) {

                    return res.status(403).json({
                        success: false,
                        error:
                            `You don't have permission to create a request for vehicle ${vehicleId}`
                    });
                }


                vehicles.push({
                    unitId: String(unit.id),
                    unitName: unit.name
                });
            }


            // -----------------------------------------
            // Request number
            // -----------------------------------------

            const requestNumber =
                await MaintenanceRequest
                    .generateRequestNumber();


            // -----------------------------------------
            // Create request
            // -----------------------------------------

            const request =
                new MaintenanceRequest({

                    requestNumber,

                    customer:
                        user.role === 'customer'
                            ? user.id
                            : user.id,

                    customerName:
                        userName(user),

                    createdBy:
                        user.id,

                    createdByName:
                        userName(user),

                    vehicles,

                    title:
                        String(title).trim(),

                    description:
                        String(description).trim(),

                    priority:
                        selectedPriority,

                    status:
                        'pending',

                    history: [
                        {
                            action: 'Request Created',

                            by:
                                user.id,

                            byName:
                                userName(user),

                            details:
                                `Maintenance request created for ${vehicles.length} vehicle(s)`,

                            createdAt:
                                new Date()
                        }
                    ]
                });


            await request.save();


            console.log(
                `🔧 Maintenance request created: ${request.requestNumber} by ${user.username}`
            );

            // Notify Support by email — doesn't block/fail the
            // response if SMTP isn't configured or is down.
            notifySupportOfNewRequest(request);


            return res.status(201).json({
                success: true,

                message:
                    'Maintenance request created successfully',

                request: {
                    id:
                        request._id,

                    requestNumber:
                        request.requestNumber,

                    status:
                        request.status,

                    priority:
                        request.priority,

                    vehicles:
                        request.vehicles,

                    createdAt:
                        request.createdAt
                }
            });


        } catch (error) {

            console.error(
                '❌ Create maintenance request error:',
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    'Failed to create maintenance request'
            });
        }
    }
);


// =====================================================
// GET MAINTENANCE REQUESTS
// GET /api/maintenance
// =====================================================

router.get(
    '/',
    requireAuth,
    requirePermission('maintenance'),
    async (req, res) => {

        try {

            const user =
                getCurrentUser(req);


            let query = {};


            // Customer sees ONLY own requests
            if (!isAdmin(user)) {

                query = {
                    customer: user.id
                };
            }


            const requests =
                await MaintenanceRequest
                    .find(query)
                    .sort({
                        createdAt: -1
                    })
                    .lean();


            return res.json({
                success: true,
                requests
            });


        } catch (error) {

            console.error(
                '❌ Get maintenance requests error:',
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    'Failed to load maintenance requests'
            });
        }
    }
);


// =====================================================
// MAINTENANCE REPORT
// GET /api/maintenance/report
// =====================================================

router.get(
    '/report',
    requireAuth,
    requirePermission('maintenance'),
    async (req, res) => {

        try {

            const user =
                getCurrentUser(req);


            // Only admin/support side can see full report
            if (!isAdmin(user)) {

                return res.status(403).json({
                    success: false,
                    error:
                        'Only admin/support can access maintenance reports'
                });
            }


            const {
                status,
                priority,
                customer
            } = req.query;


            const query = {};


            if (status) {
                query.status = status;
            }


            if (priority) {
                query.priority = priority;
            }


            if (customer) {
                query.customer = customer;
            }


            const requests =
                await MaintenanceRequest
                    .find(query)
                    .sort({
                        createdAt: -1
                    })
                    .populate(
                        'customer',
                        'username displayName'
                    )
                    .populate(
                        'createdBy',
                        'username displayName'
                    )
                    .populate(
                        'assignedTo',
                        'username displayName'
                    )
                    .populate(
                        'resolvedBy',
                        'username displayName'
                    )
                    .populate(
                        'closedBy',
                        'username displayName'
                    )
                    .lean();


            const report =
                requests.map(request => ({

                    requestNumber:
                        request.requestNumber,

                    customer:
                        request.customer
                            ? (
                                request.customer.displayName ||
                                request.customer.username
                            )
                            : request.customerName,

                    createdBy:
                        request.createdBy
                            ? (
                                request.createdBy.displayName ||
                                request.createdBy.username
                            )
                            : request.createdByName,

                    assignedTo:
                        request.assignedTo
                            ? (
                                request.assignedTo.displayName ||
                                request.assignedTo.username
                            )
                            : request.assignedToName,

                    vehicles:
                        request.vehicles,

                    title:
                        request.title,

                    description:
                        request.description,

                    priority:
                        request.priority,

                    status:
                        request.status,

                    createdAt:
                        request.createdAt,

                    receivedAt:
                        request.receivedAt,

                    startedAt:
                        request.startedAt,

                    resolvedAt:
                        request.resolvedAt,

                    closedAt:
                        request.closedAt,

                    resolution:
                        request.resolution,

                    resolvedBy:
                        request.resolvedBy
                            ? (
                                request.resolvedBy.displayName ||
                                request.resolvedBy.username
                            )
                            : request.resolvedByName,

                    closedBy:
                        request.closedBy
                            ? (
                                request.closedBy.displayName ||
                                request.closedBy.username
                            )
                            : request.closedByName,

                    messages:
                        request.messages,

                    history:
                        request.history
                }));


            return res.json({
                success: true,

                total:
                    report.length,

                requests:
                    report
            });


        } catch (error) {

            console.error(
                '❌ Maintenance report error:',
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    'Failed to generate maintenance report'
            });
        }
    }
);

// =====================================================
// GET SINGLE REQUEST
// GET /api/maintenance/:id
// =====================================================

router.get(
    '/:id',
    requireAuth,
    requirePermission('maintenance'),
    async (req, res) => {

        try {

            const user =
                getCurrentUser(req);


            const request =
                await MaintenanceRequest
                    .findById(req.params.id)
                    .lean();


            if (!request) {

                return res.status(404).json({
                    success: false,
                    error:
                        'Maintenance request not found'
                });
            }


            // Customer can only see own request
            if (
                !isAdmin(user) &&
                String(request.customer) !== String(user.id)
            ) {

                return res.status(403).json({
                    success: false,
                    error:
                        'You do not have access to this request'
                });
            }


            return res.json({
                success: true,
                request
            });


        } catch (error) {

            console.error(
                '❌ Get maintenance request error:',
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    'Failed to load request'
            });
        }
    }
);


// =====================================================
// REPLY
// POST /api/maintenance/:id/reply
// =====================================================

router.post(
    '/:id/reply',
    requireAuth,
    requirePermission('maintenance'),
    async (req, res) => {

        try {

            const user =
                getCurrentUser(req);


            const {
                message
            } = req.body;


            if (
                !message ||
                !String(message).trim()
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        'Reply message is required'
                });
            }


            const request =
                await MaintenanceRequest
                    .findById(req.params.id);


            if (!request) {

                return res.status(404).json({
                    success: false,
                    error:
                        'Maintenance request not found'
                });
            }


            // Customer can only reply to own request
            if (
                !isAdmin(user) &&
                String(request.customer) !== String(user.id)
            ) {

                return res.status(403).json({
                    success: false,
                    error:
                        'You do not have access to this request'
                });
            }


            request.messages.push({

                sender:
                    user.id,

                senderName:
                    userName(user),

                senderRole:
                    user.role,

                message:
                    String(message).trim(),

                createdAt:
                    new Date()
            });


            request.history.push({

                action:
                    'Reply Added',

                by:
                    user.id,

                byName:
                    userName(user),

                details:
                    String(message).trim(),

                createdAt:
                    new Date()
            });


            await request.save();


            return res.json({
                success: true,
                message:
                    'Reply added successfully'
            });


        } catch (error) {

            console.error(
                '❌ Maintenance reply error:',
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    'Failed to add reply'
            });
        }
    }
);


// =====================================================
// RECEIVE REQUEST
// PATCH /api/maintenance/:id/receive
// =====================================================

router.patch(
    '/:id/receive',
    requireAuth,
    requirePermission('maintenance'),
    async (req, res) => {

        try {

            const user =
                getCurrentUser(req);


            if (!isAdmin(user)) {

                return res.status(403).json({
                    success: false,
                    error:
                        'Only support/admin can receive requests'
                });
            }


            const request =
                await MaintenanceRequest
                    .findById(req.params.id);


            if (!request) {

                return res.status(404).json({
                    success: false,
                    error:
                        'Maintenance request not found'
                });
            }


            request.status =
                'received';


            request.receivedAt =
                new Date();


            request.history.push({

                action:
                    'Request Received',

                by:
                    user.id,

                byName:
                    userName(user),

                details:
                    'Support received the maintenance request',

                createdAt:
                    new Date()
            });


            await request.save();


            return res.json({
                success: true,
                message:
                    'Request received successfully'
            });


        } catch (error) {

            console.error(
                '❌ Receive maintenance request error:',
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    'Failed to receive request'
            });
        }
    }
);


// =====================================================
// ASSIGN REQUEST
// PATCH /api/maintenance/:id/assign
// =====================================================

router.patch(
    '/:id/assign',
    requireAuth,
    requirePermission('maintenance'),
    async (req, res) => {

        try {

            const user =
                getCurrentUser(req);


            if (!isAdmin(user)) {

                return res.status(403).json({
                    success: false,
                    error:
                        'Only support/admin can assign requests'
                });
            }


            const {
                assignedTo
            } = req.body;


            if (!assignedTo) {

                return res.status(400).json({
                    success: false,
                    error:
                        'assignedTo is required'
                });
            }


            const assignedUser =
                await User.findById(
                    assignedTo
                );


            if (
                !assignedUser ||
                !assignedUser.isActive
            ) {

                return res.status(404).json({
                    success: false,
                    error:
                        'Assigned user not found or inactive'
                });
            }


            const request =
                await MaintenanceRequest
                    .findById(req.params.id);


            if (!request) {

                return res.status(404).json({
                    success: false,
                    error:
                        'Maintenance request not found'
                });
            }


            request.assignedTo =
                assignedUser._id;

            request.assignedToName =
                assignedUser.displayName ||
                assignedUser.username;


            request.status =
                'in_progress';


            if (!request.startedAt) {

                request.startedAt =
                    new Date();
            }


            request.history.push({

                action:
                    'Request Assigned',

                by:
                    user.id,

                byName:
                    userName(user),

                details:
                    `Assigned to ${request.assignedToName}`,

                createdAt:
                    new Date()
            });


            await request.save();


            return res.json({
                success: true,
                message:
                    'Request assigned successfully'
            });


        } catch (error) {

            console.error(
                '❌ Assign maintenance request error:',
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    'Failed to assign request'
            });
        }
    }
);


// =====================================================
// RESOLVE REQUEST
// PATCH /api/maintenance/:id/resolve
// =====================================================

router.patch(
    '/:id/resolve',
    requireAuth,
    requirePermission('maintenance'),
    async (req, res) => {

        try {

            const user =
                getCurrentUser(req);


            if (!isAdmin(user)) {

                return res.status(403).json({
                    success: false,
                    error:
                        'Only support/admin can resolve requests'
                });
            }


            const {
                resolution
            } = req.body;


            if (
                !resolution ||
                !String(resolution).trim()
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        'Resolution details are required'
                });
            }


            const request =
                await MaintenanceRequest
                    .findById(req.params.id);


            if (!request) {

                return res.status(404).json({
                    success: false,
                    error:
                        'Maintenance request not found'
                });
            }


            request.resolution =
                String(resolution).trim();


            request.status =
                'resolved';


            request.resolvedBy =
                user.id;


            request.resolvedByName =
                userName(user);


            request.resolvedAt =
                new Date();


            request.history.push({

                action:
                    'Request Resolved',

                by:
                    user.id,

                byName:
                    userName(user),

                details:
                    request.resolution,

                createdAt:
                    new Date()
            });


            await request.save();


            return res.json({
                success: true,
                message:
                    'Request resolved successfully'
            });


        } catch (error) {

            console.error(
                '❌ Resolve maintenance request error:',
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    'Failed to resolve request'
            });
        }
    }
);


// =====================================================
// CLOSE REQUEST
// PATCH /api/maintenance/:id/close
// =====================================================

router.patch(
    '/:id/close',
    requireAuth,
    requirePermission('maintenance'),
    async (req, res) => {

        try {

            const user =
                getCurrentUser(req);


            const request =
                await MaintenanceRequest
                    .findById(req.params.id);


            if (!request) {

                return res.status(404).json({
                    success: false,
                    error:
                        'Maintenance request not found'
                });
            }


            // -----------------------------------------
            // Customer can close ONLY own request
            // after support resolved it.
            // -----------------------------------------

            if (isCustomer(user)) {

                if (
                    String(request.customer) !==
                    String(user.id)
                ) {

                    return res.status(403).json({
                        success: false,
                        error:
                            'You do not have access to this request'
                    });
                }


                if (
                    request.status !==
                    'resolved'
                ) {

                    return res.status(400).json({
                        success: false,
                        error:
                            'Request can only be closed after it is resolved'
                    });
                }
            }


            // -----------------------------------------
            // Admin can close as well
            // -----------------------------------------

            if (
                !isCustomer(user) &&
                !isAdmin(user)
            ) {

                return res.status(403).json({
                    success: false,
                    error:
                        'You are not allowed to close this request'
                });
            }


            request.status =
                'closed';


            request.closedBy =
                user.id;


            request.closedByName =
                userName(user);


            request.closedAt =
                new Date();


            request.history.push({

                action:
                    'Request Closed',

                by:
                    user.id,

                byName:
                    userName(user),

                details:
                    isCustomer(user)
                        ? 'Customer confirmed the maintenance was completed'
                        : 'Request closed by support/admin',

                createdAt:
                    new Date()
            });


            await request.save();


            return res.json({
                success: true,
                message:
                    'Maintenance request closed successfully'
            });


        } catch (error) {

            console.error(
                '❌ Close maintenance request error:',
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    'Failed to close request'
            });
        }
    }
);




// =====================================================
// MAINTENANCE REPORT EXPORT (Excel / PDF)
// GET /api/maintenance/report/export?format=xlsx|pdf&lang=en|ar
//
// Same filters/scope as GET /report (admin/support only) —
// this just streams the same data as a file instead of JSON,
// so it satisfies "تقرير بالطلبات ... اقفلها بالعميل و باليوزر"
// as a downloadable report (who closed each request: customer
// or support/admin — see the closedBy/closedByName columns).
// =====================================================

router.get(
    '/report/export',
    requireAuth,
    requirePermission('maintenance'),
    async (req, res) => {

        try {
            const user = getCurrentUser(req);

            if (!isAdmin(user)) {
                return res.status(403).json({
                    success: false,
                    error: 'Only admin/support can access maintenance reports'
                });
            }

            const { status, priority, customer } = req.query;
            const query = {};
            if (status) query.status = status;
            if (priority) query.priority = priority;
            if (customer) query.customer = customer;

            const requests = await MaintenanceRequest
                .find(query)
                .sort({ createdAt: -1 })
                .populate('customer', 'username displayName')
                .populate('createdBy', 'username displayName')
                .populate('resolvedBy', 'username displayName')
                .populate('closedBy', 'username displayName')
                .lean();

            const format = req.query.format === 'pdf' ? 'pdf' : 'xlsx';
            const lang = req.query.lang === 'ar' ? 'ar' : 'en';
            const stamp = new Date().toISOString().slice(0, 10);

            const rows = requests.map(r => [
                r.requestNumber,
                r.customer ? (r.customer.displayName || r.customer.username) : r.customerName,
                r.createdBy ? (r.createdBy.displayName || r.createdBy.username) : r.createdByName,
                (r.vehicles || []).map(v => v.unitName).join(', '),
                r.title,
                r.priority,
                r.status,
                r.createdAt ? new Date(r.createdAt).toLocaleString('en-US') : '-',
                r.resolvedAt ? new Date(r.resolvedAt).toLocaleString('en-US') : '-',
                r.closedAt ? new Date(r.closedAt).toLocaleString('en-US') : '-',
                // Who actually closed it — customer confirmation vs support/admin
                r.closedBy ? (r.closedBy.displayName || r.closedBy.username) : (r.closedByName || '-')
            ]);

            const headersEn = ['Request #', 'Customer', 'Created By', 'Vehicles', 'Title', 'Priority', 'Status', 'Created', 'Resolved', 'Closed', 'Closed By'];
            const headersAr = ['رقم الطلب', 'العميل', 'أنشأه', 'العربيات', 'العنوان', 'الأولوية', 'الحالة', 'تاريخ الإنشاء', 'تاريخ الحل', 'تاريخ الإقفال', 'أقفله'];

            if (format === 'xlsx') {
                const workbook = new ExcelJS.Workbook();
                workbook.creator = 'Observer Fleet';
                workbook.created = new Date();

                const sheet = workbook.addWorksheet('Maintenance Requests');
                sheet.getCell('A1').value = 'OBSERVER';
                sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1976D2' } };
                sheet.getCell('A2').value = 'Maintenance Requests Report';
                sheet.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF888888' } };
                sheet.addRow([]);

                const headerRow = sheet.addRow(lang === 'ar' ? headersAr : headersEn);
                headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };

                rows.forEach(row => sheet.addRow(row));
                sheet.columns.forEach(col => { col.width = 20; });

                const filename = `maintenance-report-${stamp}.xlsx`;
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                await workbook.xlsx.write(res);
                return res.end();
            }

            // PDF
            const filename = `maintenance-report-${stamp}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

            buildGenericReportPdf({
                title: lang === 'ar' ? 'تقرير طلبات الصيانة' : 'Maintenance Requests Report',
                subtitle: `${stamp}`,
                sections: [{
                    title: lang === 'ar' ? 'كل الطلبات' : 'All Requests',
                    headers: lang === 'ar' ? headersAr : headersEn,
                    rows
                }],
                lang
            }, res);

        } catch (error) {
            console.error('❌ Maintenance report export error:', error.message);
            res.status(500).json({ success: false, error: 'Failed to export maintenance report' });
        }
    }
);


module.exports = router;