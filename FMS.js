require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const path = require('path');
const mysql = require('mysql2/promise');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const fetch = require('node-fetch');

const { requireAuth, requireAdmin, requirePermission, requireLocalAccount } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const reportsRoutes = require('./routes/reports');
const wialonReportsRoutes = require('./routes/wialonReports');
const adminRoutes = require('./routes/admin');
const smsRoutes = require('./routes/sms');
const contactsRoutes = require('./routes/contacts');
const maintenanceRoutes = require('./routes/maintenance');
const installationsRoutes = require('./routes/installations');
const maintenanceReportsRoutes = require('./routes/maintenanceReports');
const { wialonLogin, wialonRequest, fetchUnitsData, wialonLogout, processUnit, getUnitsForUser, fetchUnitNamesForToken } = require('./lib/wialon');
const { sendSms } = require('./lib/vodafoneSms');
const SmsLog = require('./models/SmsLog');
const User = require('./models/User');

// 👇 ADDED: in-memory cache for per-user unit lists
const cache = require('./lib/cache');
const UNITS_CACHE_TTL_MS = Number(process.env.UNITS_CACHE_TTL_MS || 60_000); // 60s




const app = express();

// cPanel / Passenger / LiteSpeed put a proxy in front of Node. Without this,
// Express thinks every request is plain HTTP and express-session refuses to
// send a Secure cookie -> login "succeeds" but the session is never kept.
app.set('trust proxy', 1);

// =====================================================
// SAFETY NET — don't let one bad async error kill the
// whole server.
// =====================================================
// This is what was actually behind "everything stopped
// working" — the old Mongo session store's session.touch() rejects with
// "Unable to find the session to touch" whenever a browser
// still holds a cookie for a session document that no
// longer exists in Mongo (e.g. the DB was reset/reseeded
// while someone was still logged in). That's a normal,
// expected situation — the fix for THAT specific user is
// just to log out and log back in — but on Node 15+ an
// unhandled promise rejection like this kills the whole
// process by default, which is why the app would go
// completely dark for every user until someone noticed and
// restarted it. We log these instead of crashing.
// =====================================================
process.on('unhandledRejection', (reason) => {
    console.error('⚠️  Unhandled rejection (server kept running):', reason && reason.message || reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️  Uncaught exception (server kept running):', err && err.message || err);
});

const PORT = process.env.PORT || 3000;
const WIALON_HOST = process.env.WIALON_HOST || 'https://hst-api.wialon.eu';
const TOKEN = process.env.WIALON_TOKEN;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret';
const ALERT_PHONE_NUMBER = null; // offline SMS alerts disabled


const MAX_ALERTS_PER_EPISODE = Number(process.env.MAX_ALERTS_PER_EPISODE || 4);
const ALERT_REPEAT_HOURS = Number(process.env.ALERT_REPEAT_HOURS || 4);
const DEVICE_ACTIVATION_OFFLINE_HOURS = Number(process.env.DEVICE_ACTIVATION_OFFLINE_HOURS || 6);
const DEVICE_ACTIVATION_RETRY_MINUTES = Number(process.env.DEVICE_ACTIVATION_RETRY_MINUTES || 30);
const DEVICE_ACTIVATION_RESPONSE_MINUTES = Number(process.env.DEVICE_ACTIVATION_RESPONSE_MINUTES || 15);

// =====================================================
// CHECK ENV
// =====================================================

if (!TOKEN) {
    console.error('❌ WIALON_TOKEN is missing from .env');
} else {
    console.log(`🔑 Wialon token loaded (${TOKEN.length} characters)`);
}

if (!ALERT_PHONE_NUMBER) {
    console.warn('⚠️  ALERT_PHONE_NUMBER is missing from .env — offline alerts will not be sent via SMS');
}

console.log(`🌐 Wialon host: ${WIALON_HOST}`);

// =====================================================
// MYSQL CONNECTION
// =====================================================

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS || '';

if (!DB_NAME || !DB_USER) {
    console.error('❌ FATAL: DB_NAME / DB_USER is missing from .env / cPanel environment.');
   
}

const dbPool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    charset: 'utf8mb4'
});

async function testDatabaseConnection() {
    try {
        const connection = await dbPool.getConnection();
        await connection.ping();
        connection.release();
        console.log(`🗄️  MySQL connected: ${DB_USER}@${DB_HOST}/${DB_NAME}`);
    } catch (err) {
        console.error('❌ MySQL connection error:', err.message);
  
    }
}

testDatabaseConnection();


// =====================================================
// Enhancement 5 — offline alert state (survives restarts)
// =====================================================
async function getAlertState(unitId) {
    const [rows] = await dbPool.query(
        'SELECT alert_count, last_sent_at FROM offline_alert_state WHERE unit_id = ?',
        [String(unitId)]
    );
    if (!rows.length) return null;
    return {
        count: rows[0].alert_count,
        lastSentAt: rows[0].last_sent_at
            ? Math.floor(new Date(rows[0].last_sent_at).getTime() / 1000)
            : 0
    };
}

async function upsertAlertState(unitId, count, lastSentAtSec) {
    await dbPool.query(
        `INSERT INTO offline_alert_state (unit_id, alert_count, last_sent_at)
         VALUES (?, ?, FROM_UNIXTIME(?))
         ON DUPLICATE KEY UPDATE
             alert_count = VALUES(alert_count),
             last_sent_at = VALUES(last_sent_at)`,
        [String(unitId), count, lastSentAtSec]
    );
}

async function clearAlertState(unitId) {
    await dbPool.query(
        'DELETE FROM offline_alert_state WHERE unit_id = ?',
        [String(unitId)]
    );
}

// Automatic offline check: ask Wialon which SMS commands this unit supports,
// then use its standard query-position command only when GSM support is advertised.
let offlineActivationTablePromise = null;
async function ensureOfflineActivationTable() {
    if (!offlineActivationTablePromise) {
        offlineActivationTablePromise = dbPool.query(`
            CREATE TABLE IF NOT EXISTS offline_activation_state (
                unit_id VARCHAR(64) NOT NULL PRIMARY KEY,
                status VARCHAR(48) NOT NULL,
                last_attempt_at DATETIME NOT NULL,
                queued_at DATETIME NULL,
                log_id VARCHAR(64) NULL,
                details TEXT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `).catch(error => {
            offlineActivationTablePromise = null;
            throw error;
        });
    }
    await offlineActivationTablePromise;
}

async function getOfflineActivationState(unitId) {
    const [rows] = await dbPool.query(
        'SELECT status, last_attempt_at, queued_at, log_id FROM offline_activation_state WHERE unit_id = ?',
        [String(unitId)]
    );
    if (!rows.length) return null;
    return {
        status: rows[0].status,
        lastAttemptAt: rows[0].last_attempt_at ? new Date(rows[0].last_attempt_at).getTime() : 0,
        queuedAt: rows[0].queued_at ? new Date(rows[0].queued_at).getTime() : 0,
        logId: rows[0].log_id || null
    };
}

async function setOfflineActivationState(unitId, status, details = '', queuedAt = null, logId = null) {
    await dbPool.query(
        `INSERT INTO offline_activation_state (unit_id, status, last_attempt_at, queued_at, log_id, details)
         VALUES (?, ?, NOW(), ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), last_attempt_at = NOW(),
             queued_at = VALUES(queued_at), log_id = COALESCE(VALUES(log_id), log_id), details = VALUES(details)`,
        [String(unitId), status, queuedAt ? new Date(queuedAt) : null, logId, details]
    );
}

async function clearOfflineActivationState(unitId) {
    await dbPool.query('DELETE FROM offline_activation_state WHERE unit_id = ?', [String(unitId)]);
}

async function logOfflineActivation(unit, status, details, phoneNumber = '') {
    try {
        const log = await SmsLog.create({
            receiverMSISDN: phoneNumber,
            smsText: `Automatic offline check: ${status}`,
            source: 'activation',
            status: ['queued', 'responded'].includes(status) ? 'submitted' : 'failed',
            errorMessage: details,
            sentBy: 'system',
            unitId: String(unit.id),
            unitName: unit.nm || '',
            channel: 'sms'
        });
        return log._id;
    } catch (error) {
        console.error(`⚠️ Could not log offline check for ${unit.nm || unit.id}:`, error.message);
        return null;
    }
}

async function updateOfflineActivationLog(logId, status, details) {
    if (!logId) return;
    const statusText = status === 'responded' ? 'Unit responded' : 'No response received';
    try {
        await dbPool.query(
            'UPDATE sms_logs SET sms_text = ?, error_message = ?, updated_at = NOW() WHERE id = ?',
            [`Automatic offline check: ${statusText}`, details, logId]
        );
    } catch (error) {
        console.error('⚠️ Could not update offline check report:', error.message);
    }
}

async function checkUnitForOfflineActivation(sid, unit, nowMs, offlineHours) {
    const unitId = String(unit.id);
    const phoneNumber = String(unit.ph || unit.ph2 || '').trim();
    const state = await getOfflineActivationState(unitId);
    const lastMessageAt = Number(unit.lmsg?.t || unit.last_message?.t || 0) * 1000;
    if (state?.queuedAt) {
        if (lastMessageAt > state.queuedAt && state.status !== 'responded') {
            const details = 'The unit sent a new Wialon message after the SMS check.';
            await setOfflineActivationState(unitId, 'responded', details, state.queuedAt);
            await updateOfflineActivationLog(state.logId, 'responded', details);
            return;
        }
        const responseWindowMs = Math.max(1, DEVICE_ACTIVATION_RESPONSE_MINUTES) * 60 * 1000;
        if (state.status === 'queued' && nowMs - state.queuedAt >= responseWindowMs) {
            const details = `No new Wialon message arrived within ${DEVICE_ACTIVATION_RESPONSE_MINUTES} minutes of the SMS check.`;
            await setOfflineActivationState(unitId, 'no_response', details, state.queuedAt);
            await updateOfflineActivationLog(state.logId, 'no_response', details);
            return;
        }
        if (['queued', 'no_response', 'responded'].includes(state.status)) return;
    }
    if (offlineHours <= DEVICE_ACTIVATION_OFFLINE_HOURS) return;

    const retryMs = Math.max(1, DEVICE_ACTIVATION_RETRY_MINUTES) * 60 * 1000;
    if (state?.lastAttemptAt && nowMs - state.lastAttemptAt < retryMs) return;

    if (!phoneNumber) {
        const details = 'Skipped: the unit has no SIM phone number in Wialon.';
        await setOfflineActivationState(unitId, 'skipped_missing_sim', details);
        await logOfflineActivation(unit, 'skipped_missing_sim', details);
        return;
    }

    try {
        const supported = await wialonRequest(sid, 'core/get_hw_cmds', { unitId: unit.id });
        const gsmCommands = Array.isArray(supported?.gsm) ? supported.gsm : [];
        if (!gsmCommands.includes('query_pos')) {
            const details = 'Skipped: Wialon does not advertise query_pos over SMS/GSM for this unit.';
            await setOfflineActivationState(unitId, 'skipped_unsupported_sms_check', details);
            await logOfflineActivation(unit, 'skipped_unsupported_sms_check', details, phoneNumber);
            return;
        }

        await wialonRequest(sid, 'unit/send_cmd', {
            itemId: unit.id,
            commandType: 'query_pos',
            linkType: 'gsm',
            param: '',
            timeout: 60,
            flags: 0
        });
        const details = 'Wialon queued the standard query_pos SMS check.';
        const logId = await logOfflineActivation(unit, 'queued', details, phoneNumber);
        await setOfflineActivationState(unitId, 'queued', details, new Date(nowMs), logId);
        console.log(`📨 Offline SMS check queued for ${unit.nm || unitId} (${DEVICE_ACTIVATION_OFFLINE_HOURS}+h offline)`);
    } catch (error) {
        const details = `SMS check was not queued: ${error.message}`;
        await setOfflineActivationState(unitId, 'failed', details);
        await logOfflineActivation(unit, 'failed', details, phoneNumber);
        console.error(`❌ Offline SMS check failed for ${unit.nm || unitId}:`, error.message);
    }
}

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json());

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    createDatabaseTable: true,
    schema: {
        tableName: 'sessions',
        columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' }
    }
});
// 👈 ADDED: don't let a MySQL session-store blip crash the process
sessionStore.on('disconnect', (err) => {
    console.error('⚠️ Session store disconnected (server kept running):', err?.message || err);
});


app.use(session({
    name: 'fms2go.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,          // 👈 ADDED: refresh cookie expiry on every activity
    store: sessionStore,
    cookie: {
        maxAge: 1000 * 60 * 60 * 8, // 8 hours
        httpOnly: true,
        secure: true,       // HTTPS only — trust proxy is set correctly
        sameSite: 'lax'
    }
}));

// Auth API routes (login/logout/me) - public
app.use('/api', authRoutes);

// Reports (Excel export) - protected inside the router itself
app.use('/api/reports', reportsRoutes);

// Wialon's own reports (Trips/Tracks/Fuel Consumption/...) - protected inside the router itself
app.use('/api/wialon-reports', wialonReportsRoutes);

// Admin (user management) - protected inside the router itself
app.use('/api/admin', adminRoutes);

// SMS (send / monthly report / status) - protected inside the router itself
app.use('/api/sms', smsRoutes);

// Saved SMS contacts/groups - protected inside the router itself
app.use('/api/contacts', contactsRoutes);

app.use('/api/maintenance', maintenanceRoutes);

app.use('/api/installations', installationsRoutes);

app.use('/api/maintenance-reports', maintenanceReportsRoutes);

// -----------------------------------------------------
// POST /api/admin/users/:id/import-wialon-units
// item #6: import exactly the units a customer's OWN Wialon
// API token can see, and save their names into
// assignedUnitNames — so that customer sees the same units
// in Observer as they would logging into Wialon directly.
// -----------------------------------------------------
app.post('/api/admin/users/:id/import-wialon-units', requireAdmin, async (req, res) => {
    try {
        const { wialonToken } = req.body;

        if (!wialonToken) {
            return res.status(400).json({ success: false, error: 'wialonToken is required' });
        }

        const unitNames = await fetchUnitNamesForToken(wialonToken);

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        user.assignedUnitNames = unitNames;
        user.wialonToken = wialonToken;
        await user.save();

        // 👇 ADDED: bust any cached unit list for this user
        // (wipes every authMode variant in one call)
        cache.delByPrefix(`units:${user.id}:`);

        res.json({ success: true, importedUnits: unitNames });

    } catch (error) {
        console.error('❌ Wialon units import error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// -----------------------------------------------------
// GET /api/server-ip
// Shows this server's own OUTBOUND public IP address —
// this is the IP that must be given to Vodafone as the
// "trusted IP" for the SMS-API account (spec section 4.3).
// Protected: only logged-in users should see it.
// -----------------------------------------------------
app.get('/api/server-ip', requireAuth, async (req, res) => {
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);
        let response;
        try {
            response = await fetch('https://api.ipify.org?format=json', {
                signal: controller.signal
            });
        } finally {
            clearTimeout(t);
        }
        const data = await response.json();
        res.json({ success: true, outboundIp: data.ip });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Could not determine outbound IP: ' + error.message
        });
    }
});

// -----------------------------------------------------
// Serve login page + shared assets WITHOUT auth
// -----------------------------------------------------
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/wialon-callback.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'wialon-callback.html'));
});

app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

// Root -> redirect based on session
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/index.html');
    }
    return res.redirect('/login.html');
});

// -----------------------------------------------------
// Per-screen page gating (checkbox permissions from
// /admin-users.html). Must be declared BEFORE the generic
// static file middleware below so these specific pages get
// checked first instead of being served unconditionally.
// -----------------------------------------------------
app.get('/units.html', requireAuth, requirePermission('units'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'units.html'));
});
app.get('/unit.html', requireAuth, requirePermission('units'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'unit.html'));
});
app.get('/sms.html', requireAuth, requirePermission('sms'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sms.html'));
});
app.get('/wialon-reports.html', requireAuth, requireLocalAccount, requirePermission('wialonReports'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'wialon-reports.html'));
});
app.get('/maintenance.html', requireAuth, requirePermission('maintenance'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});
app.get('/installations.html', requireAuth, requirePermission('installations'), (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'installations.html'));
});
app.get('/admin-users.html', requireAuth, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-users.html'));
});

// -----------------------------------------------------
// Everything else under /public requires login
// -----------------------------------------------------
app.use((req, res, next) => {
    // allow static files that aren't the protected pages to pass through
    // the requireAuth check below handles page + API protection
    next();
});
// -----------------------------------------------------
// Static assets: served WITHOUT auth.
// Protected HTML pages are already gated explicitly above
// (units.html, sms.html, admin-users.html, etc. each have
// their own requireAuth + requirePermission route). Those
// run before this middleware, so they still apply.
// Only assets (css/js/images/fonts) fall through to here,
// and they contain no user data — no session lookup needed.
// -----------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), {
    index: false,
    extensions: false,
    setHeaders: (res, filePath) => {
        if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|map)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
}));
// =====================================================
// CACHED getUnitsForUser WRAPPER
// ---------------------------------------------
// Wraps lib/wialon's getUnitsForUser with a short-lived
// per-user cache. Key includes user id + authMode so
// different users (or the same user switching between
// local/wialon auth) never share entries.
//
// NOTE: this only caches the *reference* for TTL ms;
// mutations to assignedUnitNames via /api/admin are
// picked up on the next miss after TTL expiry. If you
// need instant invalidation, call cache.del(key) from
// the admin route too.
// =====================================================
async function getUnitsForUserCached(sessionUser) {
    const key = `units:${sessionUser.id}:${sessionUser.authMode || 'local'}`;

    // Enhancement 7: getOrCompute dedupes concurrent misses.
    // 3 tabs hitting /api/dashboard at once = 1 Wialon fetch.
    return cache.getOrCompute(
        key,
        UNITS_CACHE_TTL_MS,
        () => getUnitsForUser(sessionUser)
    );
}

// =====================================================
// DASHBOARD API (protected + filtered per customer)
// =====================================================

// NOTE: /api/dashboard is shared by both /index.html (summary) and
// /units.html (detailed table), so it's gated only by requireAuth —
// splitting it per-permission would break whichever page loads
// second. The pages themselves are gated above (units.html requires
// the "units" permission); the summary cards on /index.html are
// considered baseline (every logged-in user can see them).
app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
        const sessionUser = req.session.user;

        const processedUnits = await getUnitsForUserCached(sessionUser);

        let onlineUnits = 0;
        let offlineUnits = 0;
        let unitsWithMileage = 0;
        let unitsWithFuel = 0;
        let batteryZeroUnits = 0;

        for (const unit of processedUnits) {
            if (unit.isOffline) offlineUnits++; else onlineUnits++;
            if (unit.hasMileage) unitsWithMileage++;
            if (unit.hasFuel) unitsWithFuel++;
            if (unit.batteryStatus === 'zero') batteryZeroUnits++;
        }

        res.json({
            success: true,
            counters: {
                totalUnits: processedUnits.length,
                onlineUnits,
                offlineUnits,
                unitsWithMileage,
                unitsWithFuel,
                batteryZeroUnits
            },
            units: processedUnits
        });

    } catch (error) {
        console.error('❌ Dashboard error:', error.message);

        // authMode:'wialon' users: their Wialon session timed out.
        // We don't store their password, so we can't silently refresh
        // it — send 401 so the frontend bounces them back to /login.html.
        if (error.code === 'WIALON_SESSION_EXPIRED') {
            return res.status(401).json({
                success: false,
                error: 'انتهت الجلسة، من فضلك سجل دخول تاني',
                sessionExpired: true
            });
        }

        res.status(500).json({
            success: false,
            error: error.message,
            counters: {
                totalUnits: 0, onlineUnits: 0, offlineUnits: 0,
                unitsWithMileage: 0, unitsWithFuel: 0, batteryZeroUnits: 0
            },
            units: []
        });
    }
});

// =====================================================
// UNIT DETAIL API (protected + scoped per customer)
// =====================================================

app.get('/api/units/:id', requireAuth, async (req, res) => {
    try {
        const sessionUser = req.session.user;
        const unitId = Number(req.params.id);

        const units = await getUnitsForUserCached(sessionUser);

        const unit = units.find(u => u.id === unitId);

        if (!unit) {
            return res.status(404).json({
                success: false,
                error: 'Unit not found or you do not have access to it'
            });
        }

        res.json({
            success: true,
            unit
        });

    } catch (error) {
        console.error('❌ Unit detail error:', error.message);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =====================================================
// CRON - CHECK OFFLINE UNITS (system-wide, admin scope)
// =====================================================

cron.schedule('*/1 * * * *', async () => {
    let sid = null;
    let activationStateAvailable = false;

    try {
        console.log('\n⏰ Running automatic offline SMS check...');

        try {
            await ensureOfflineActivationTable();
            activationStateAvailable = true;
        } catch (dbError) {
            console.error('❌ Offline SMS check is paused because its state table is unavailable:', dbError.message);
        }
        sid = await wialonLogin();
        const units = await fetchUnitsData(sid);
        const now = Math.floor(Date.now() / 1000);

        for (const unit of units) {
            const lastMessageTime = unit.lmsg?.t || unit.last_message?.t || 0;
            if (!lastMessageTime) continue;

            const offlineHours = (now - lastMessageTime) / 3600;

            if (activationStateAvailable) {
                await checkUnitForOfflineActivation(sid, unit, Date.now(), offlineHours);
            }
            if (offlineHours > DEVICE_ACTIVATION_OFFLINE_HOURS) {
                const existing = await getAlertState(unit.id);
                const hoursSinceLastAlert = existing ? (now - existing.lastSentAt) / 3600 : Infinity;

                const shouldSend =
                    !existing ||
                    (existing.count < MAX_ALERTS_PER_EPISODE && hoursSinceLastAlert >= ALERT_REPEAT_HOURS);

                if (shouldSend) {
                    console.log(`[ALERT] Unit "${unit.nm}" offline for ${offlineHours.toFixed(1)} hours`);

                    const nextCount = existing ? existing.count + 1 : 1;
                    await upsertAlertState(unit.id, nextCount, now);

                    // ابعت SMS تنبيه لو الرقم متظبط في .env
                    if (ALERT_PHONE_NUMBER) {
                        const alertText = `تنبيه: العربية "${unit.nm}" أوفلاين من ${offlineHours.toFixed(1)} ساعة`;

                        let customerName = '';
                        try {
                            const customers = await User.find({ role: 'customer' });
                            const match = customers.find(u =>
                                (u.assignedUnitNames || []).some(name =>
                                    String(name).trim().toLowerCase() === String(unit.nm).trim().toLowerCase()
                                )
                            );
                            customerName = match ? (match.displayName || match.username) : '';
                        } catch (dbError) {
                            console.error('❌ Customer lookup error:', dbError.message);
                        }

                        const logBase = {
                            receiverMSISDN: ALERT_PHONE_NUMBER,
                            smsText: alertText,
                            source: 'alert',
                            sentBy: 'system',
                            unitId: String(unit.id),
                            unitName: unit.nm,
                            customerName
                        };

                        sendSms(ALERT_PHONE_NUMBER, alertText)
                            .then(() => SmsLog.create({ ...logBase, status: 'submitted' }))
                            .catch(err => {
                                console.error('❌ Alert SMS failed:', err.message);
                                SmsLog.create({ ...logBase, status: 'failed', errorMessage: err.message }).catch(() => {});
                            });
                    }
                }
            } else {
                await clearAlertState(unit.id);
                if (activationStateAvailable) await clearOfflineActivationState(unit.id);
            }
        }

    } catch (error) {
        console.error('❌ Cron error:', error.message);
    } finally {
        if (sid) await wialonLogout(sid);
    }
});

// =====================================================
// START SERVER
// =====================================================

// IMPORTANT: Do NOT pass a hostname. Passenger (cPanel) needs the app
// to listen on all interfaces so it can proxy requests to it.
app.listen(PORT, () => {
    console.log('');
    console.log('=================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Listening on all interfaces`);
    console.log('=================================');
});
