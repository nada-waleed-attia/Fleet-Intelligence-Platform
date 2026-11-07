const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const MaintenanceReport = require('../models/MaintenanceReport');
const User = require('../models/User');
const { getUnitsForUser } = require('../lib/wialon');
const { buildMaintenanceReportPdf } = require('../lib/maintenanceReportPdf');

const {
    requireAuth,
    requirePermission
} = require('../middleware/auth');

// Every route below requires login + the "maintenanceReports"
// permission (admins always pass — see middleware/auth.js).
router.use(requireAuth, requirePermission('maintenanceReports'));

// =====================================================
// PHOTO UPLOAD STORAGE — mirrors routes/installations.js
// =====================================================

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'maintenance-reports');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').slice(0, 10) || '.jpg';
        const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
        cb(null, unique);
    }
});

const ALLOWED_MIME = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i;

const upload = multer({
    storage,
    limits: { fileSize: 12 * 1024 * 1024, files: 60 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIME.test(file.mimetype)) return cb(null, true);
        cb(new Error('Only image files are allowed for maintenance photos'));
    }
});

// Photo fields arrive as photos_0, photos_1, ... one group of
// files per vehicle row index (matches `items[i]` on the client).
const uploadPhotos = upload.any();

function deleteFilesSafe(filenames) {
    filenames.forEach(name => {
        try {
            fs.unlinkSync(path.join(UPLOADS_DIR, name));
        } catch (e) {
            // already gone / never existed — fine
        }
    });
}

// =====================================================
// GET /api/maintenance-reports/companies
// =====================================================

router.get('/companies', async (req, res) => {
    try {
        const sessionUser = req.session.user;

        // Non-admins only ever see their own account here — they should
        // never be able to pick another customer's company from this
        // dropdown, and it also lets the frontend auto-select + lock it.
        if (sessionUser.role !== 'admin') {
            const own = await User.findById(
                sessionUser.id,
                'displayName username'
            );

            return res.json({
                success: true,
                companies: own
                    ? [{ id: own._id, name: own.displayName || own.username }]
                    : []
            });
        }

        const companies = await User.find(
            { role: 'customer', isActive: true },
            'displayName username'
        ).sort({ displayName: 1 });

        res.json({
            success: true,
            companies: companies.map(c => ({
                id: c._id,
                name: c.displayName || c.username
            }))
        });
    } catch (error) {
        console.error('❌ List companies error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// GET /api/maintenance-reports/units?companyId=...
// =====================================================

router.get('/units', async (req, res) => {
    try {
        const { companyId } = req.query;

        if (!companyId) {
            return res.status(400).json({ success: false, error: 'companyId is required' });
        }

        // Non-admins can only ever pull units for their own account,
        // no matter what companyId the client sends.
        const sessionUser = req.session.user;
        if (sessionUser.role !== 'admin' && companyId !== sessionUser.id) {
            return res.status(403).json({ success: false, error: 'Not allowed to view units for this company' });
        }

        // For a non-admin viewing their own company, use the live
        // session user — NOT a fresh DB lookup. authMode:'wialon'
        // customers carry their Wialon session id (wialonSid) only in
        // req.session.user; it is deliberately never persisted to the
        // User collection (see models/User.js), so re-fetching from
        // the DB here silently drops it and getUnitsForUser() falls
        // back to the app-level Wialon login + assignedUnitNames/
        // wialonAccounts filtering, which is empty for these users —
        // resulting in zero units. This mirrors what
        // routes/maintenance.js already does correctly for the
        // ticketing system's own vehicle picker.
        let unitsSource;
        if (sessionUser.role !== 'admin') {
            unitsSource = sessionUser;
        } else {
            const company = await User.findById(companyId).lean();
            if (!company) {
                return res.status(404).json({ success: false, error: 'Company not found' });
            }
            unitsSource = company;
        }

        const units = await getUnitsForUser(unitsSource);

        res.json({
            success: true,
            units: units.map(u => ({ id: u.id, name: u.name }))
        });
    } catch (error) {
        console.error('❌ List units for company error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// GET /api/maintenance-reports  -> list (newest first)
// =====================================================

router.get('/', async (req, res) => {
    try {
        const { companyId, from, to } = req.query;
        const sessionUser = req.session.user;

        const filter = {};
        if (sessionUser.role !== 'admin') {
            // Customers only ever see their own reports, regardless of
            // whatever companyId query param the client sends.
            filter.company = sessionUser.id;
        } else if (companyId) {
            filter.company = companyId;
        }
        if (from || to) {
            filter.maintenanceDate = {};
            if (from) filter.maintenanceDate.$gte = new Date(from);
            if (to) filter.maintenanceDate.$lte = new Date(to);
        }

        const reports = await MaintenanceReport
            .find(filter)
            .sort({ createdAt: -1 })
            .limit(500)
            .lean();

        res.json({ success: true, reports });
    } catch (error) {
        console.error('❌ List maintenance reports error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// GET /api/maintenance-reports/:id  -> detail
// =====================================================

router.get('/:id', async (req, res) => {
    try {
        const report = await MaintenanceReport.findById(req.params.id).lean();
        if (!report) {
            return res.status(404).json({ success: false, error: 'Report not found' });
        }
        res.json({ success: true, report });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// POST /api/maintenance-reports  -> create
//
// multipart/form-data:
//   companyId          - User _id
//   maintenanceDate     - yyyy-mm-dd
//   employeeName
//   jobTitle
//   signature            - PNG data URL from the signature pad
//   items                - JSON string: [{ unitId, unitName, imei,
//                           serialNumber, simNumber, oldImei,
//                           oldSerialNumber, oldSimNumber, notes }, ...]
//   photos_0, photos_1.. - files, one field per items[] index
// =====================================================

router.post('/', (req, res) => {
    uploadPhotos(req, res, async (uploadErr) => {
        if (uploadErr) {
            return res.status(400).json({ success: false, error: uploadErr.message });
        }

        const uploadedFiles = req.files || [];

        try {
            const {
                companyId,
                maintenanceDate,
                employeeName,
                jobTitle,
                signature
            } = req.body;

            let items;
            try {
                items = JSON.parse(req.body.items || '[]');
            } catch (e) {
                items = [];
            }

            if (!companyId || !maintenanceDate || !employeeName || !jobTitle) {
                deleteFilesSafe(uploadedFiles.map(f => f.filename));
                return res.status(400).json({
                    success: false,
                    error: 'companyId, maintenanceDate, employeeName and jobTitle are all required'
                });
            }

            const sessionUser = req.session.user;
            if (sessionUser.role !== 'admin' && companyId !== sessionUser.id) {
                deleteFilesSafe(uploadedFiles.map(f => f.filename));
                return res.status(403).json({ success: false, error: 'Not allowed to submit a report for this company' });
            }

            if (!Array.isArray(items) || items.length === 0) {
                deleteFilesSafe(uploadedFiles.map(f => f.filename));
                return res.status(400).json({
                    success: false,
                    error: 'At least one vehicle (item) is required'
                });
            }

            const company = await User.findById(companyId).lean();
            if (!company) {
                deleteFilesSafe(uploadedFiles.map(f => f.filename));
                return res.status(404).json({ success: false, error: 'Company not found' });
            }

            const filesByIndex = {};
            uploadedFiles.forEach(f => {
                const match = /^photos_(\d+)$/.exec(f.fieldname);
                if (!match) return;
                const idx = Number(match[1]);
                if (!filesByIndex[idx]) filesByIndex[idx] = [];
                filesByIndex[idx].push({
                    filename: f.filename,
                    originalName: f.originalname
                });
            });

            const cleanItems = items.map((item, idx) => ({
                unitId: String(item.unitId || ''),
                unitName: String(item.unitName || '').trim(),
                imei: String(item.imei || '').trim(),
                serialNumber: String(item.serialNumber || '').trim(),
                simNumber: String(item.simNumber || '').trim(),
                oldImei: String(item.oldImei || '').trim(),
                oldSerialNumber: String(item.oldSerialNumber || '').trim(),
                oldSimNumber: String(item.oldSimNumber || '').trim(),
                notes: String(item.notes || '').trim(),
                photos: filesByIndex[idx] || []
            })).filter(item => item.unitId && item.unitName);

            if (cleanItems.length === 0) {
                deleteFilesSafe(uploadedFiles.map(f => f.filename));
                return res.status(400).json({ success: false, error: 'No valid vehicles in the submitted items' });
            }

            const reportNumber = await MaintenanceReport.generateReportNumber();

            const report = await MaintenanceReport.create({
                reportNumber,
                company: company._id,
                companyName: company.displayName || company.username,
                maintenanceDate: new Date(maintenanceDate),
                items: cleanItems,
                employeeName: String(employeeName).trim(),
                jobTitle: String(jobTitle).trim(),
                signature: signature && signature.startsWith('data:image') ? signature : '',
                createdBy: sessionUser.id,
                createdByName: sessionUser.displayName || sessionUser.username
            });

            res.json({ success: true, report });

        } catch (error) {
            deleteFilesSafe(uploadedFiles.map(f => f.filename));
            console.error('❌ Create maintenance report error:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });
});

// =====================================================
// DELETE /api/maintenance-reports/:id
// =====================================================

router.delete('/:id', async (req, res) => {
    try {
        const report = await MaintenanceReport.findById(req.params.id);
        if (!report) {
            return res.status(404).json({ success: false, error: 'Report not found' });
        }

        const filenames = [];
        report.items.forEach(item => {
            item.photos.forEach(p => filenames.push(p.filename));
        });

        await report.deleteOne();
        deleteFilesSafe(filenames);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// GET /api/maintenance-reports/:id/pdf
// =====================================================

router.get('/:id/pdf', async (req, res) => {
    try {
        const report = await MaintenanceReport.findById(req.params.id).lean();
        if (!report) {
            return res.status(404).json({ success: false, error: 'Report not found' });
        }

        const lang = req.query.lang === 'en' ? 'en' : 'ar';
        const filename = `${report.reportNumber}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${filename}"`
        );

        buildMaintenanceReportPdf({ report, uploadsDir: UPLOADS_DIR, lang }, res);

    } catch (error) {
        console.error('❌ Maintenance report PDF error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;