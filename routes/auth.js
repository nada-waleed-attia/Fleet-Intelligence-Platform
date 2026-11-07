const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { wialonTokenLoginFull, wialonLogout } = require('../lib/wialon');

const WIALON_HOSTING_URL =
    process.env.WIALON_HOSTING_URL || 'https://hst-api.wialon.eu';

// The app must be registered with Wialon first (Local Apps in your
// Wialon account) to get this client_id, and the exact callback URL
// below must be whitelisted there too. See README "Phase 14 (OAuth)".
const WIALON_OAUTH_CLIENT_ID = process.env.WIALON_OAUTH_CLIENT_ID || '';
const WIALON_OAUTH_REDIRECT_URI = process.env.WIALON_OAUTH_REDIRECT_URI || '';

// Build the safe, session-stored user object shared by both login paths.
function buildSessionUser(user, wialonSid) {
    return {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName || user.username,
        role: user.role,
        authMode: user.authMode || 'local',
        wialonAccounts: user.wialonAccounts,
        assignedUnitNames: user.assignedUnitNames,
        // Only set for authMode:'wialon' — the customer's OWN Wialon
        // session id, used by getUnitsForUser() to fetch exactly what
        // that Wialon login is allowed to see. Server-side session only.
        wialonSid: wialonSid || undefined,
        permissions: user.role === 'admin'
            ? Object.fromEntries(User.PERMISSION_SCREENS.map(s => [s, true]))
            : (user.permissions ? user.permissions.toObject() : {})
    };
}

// =====================================================
// POST /api/login  (local username/password only)
// =====================================================
// authMode:'wialon' users do NOT use this endpoint — direct
// username/password login against Wialon's own API (core/login) has
// been deprecated by Wialon since 2015 and is blocked at the account
// level (that's the {"error":7} we kept hitting). Wialon's own
// recommended replacement is the OAuth-style flow below: the customer
// enters their Wialon password on WIALON'S page, never ours.
// =====================================================

router.post('/login', async (req, res) => {

    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'اسم المستخدم وكلمة المرور مطلوبين'
            });
        }

        const cleanUsername = username.trim().toLowerCase();
        const user = await User.findOne({ username: cleanUsername });

        if (!user || !user.isActive) {
            return res.status(401).json({
                success: false,
                error: 'بيانات الدخول غير صحيحة'
            });
        }

        if (user.authMode === 'wialon') {
            return res.status(400).json({
                success: false,
                error: 'الحساب ده لازم يدخل بزرار "Login with Wialon" مش بالفورم العادي',
                useWialonOAuth: true
            });
        }

        const ok = await user.checkPassword(password);

        if (!ok) {
            return res.status(401).json({
                success: false,
                error: 'بيانات الدخول غير صحيحة'
            });
        }

        req.session.user = buildSessionUser(user);

        console.log(`✅ Login (local): ${user.username} (${user.role})`);

        res.json({ success: true, user: req.session.user });

    } catch (error) {
        console.error('❌ Login error:', error.message);
        res.status(500).json({
            success: false,
            error: 'حصل خطأ في السيرفر'
        });
    }
});

// =====================================================
// GET /api/wialon-oauth-url
// =====================================================
// Returns the URL to send the browser to. Wialon's own login.html
// handles the username/password form and redirects back to
// WIALON_OAUTH_REDIRECT_URI with #access_token=... in the fragment.
// =====================================================

router.get('/wialon-oauth-url', (req, res) => {

    if (!WIALON_OAUTH_CLIENT_ID || !WIALON_OAUTH_REDIRECT_URI) {
        return res.status(500).json({
            success: false,
            error: 'WIALON_OAUTH_CLIENT_ID / WIALON_OAUTH_REDIRECT_URI مش متظبطين في .env — سجل الأبلكيشن في Wialon الأول'
        });
    }

    const params = new URLSearchParams({
        client_id: WIALON_OAUTH_CLIENT_ID,
        redirect_uri: WIALON_OAUTH_REDIRECT_URI,
        response_type: 'token',
        access_type: 1,   // 1 = read-only online access, matches our read-only dashboard/reports use
        activation_time: 0,
        duration: 0        // token stays valid until the user logs out on Wialon's side
    });

    res.json({
        success: true,
        url: `${WIALON_HOSTING_URL}/login.html?${params.toString()}`
    });
});

// =====================================================
// POST /api/login/wialon-token
// =====================================================
// Called by wialon-callback.html once it has pulled access_token out
// of the URL fragment Wialon redirected back with.
// =====================================================

router.post('/login/wialon-token', async (req, res) => {

    try {
        const { access_token } = req.body;

        if (!access_token) {
            return res.status(400).json({ success: false, error: 'Missing access_token' });
        }

        let loginResult;

        try {
            loginResult = await wialonTokenLoginFull(access_token);
        } catch (error) {
            console.error('❌ Wialon token login failed:', error.message);
            return res.status(401).json({ success: false, error: 'تعذر تسجيل الدخول عن طريق Wialon' });
        }

        const wialonUsername = loginResult.wialonUser && loginResult.wialonUser.nm;

        if (!wialonUsername) {
            return res.status(401).json({ success: false, error: 'Wialon لم يرجع اسم مستخدم' });
        }

        const cleanUsername = wialonUsername.trim().toLowerCase();
        let user = await User.findOne({ username: cleanUsername });

        if (user && !user.isActive) {
            return res.status(401).json({ success: false, error: 'الحساب ده متوقف' });
        }

        if (!user) {
            // First-ever login for this Wialon account — auto-provision a
            // minimal customer record, same as before. Admin can widen
            // permissions afterwards from /admin-users.html.
            user = new User({
                username: cleanUsername,
                displayName: wialonUsername,
                role: 'customer',
                authMode: 'wialon',
                permissions: { dashboard: true, units: true }
            });

            await user.save();

            console.log(`🆕 Auto-provisioned Wialon-auth user: ${user.username}`);
        }

        req.session.user = buildSessionUser(user, loginResult.eid);

        console.log(`✅ Login (wialon oauth): ${user.username} (${user.role})`);

        res.json({ success: true, user: req.session.user });

    } catch (error) {
        console.error('❌ Wialon OAuth login error:', error.message);
        res.status(500).json({ success: false, error: 'حصل خطأ في السيرفر' });
    }
});

// =====================================================
// POST /api/logout
// =====================================================

router.post('/logout', async (req, res) => {

    const wialonSid = req.session && req.session.user && req.session.user.wialonSid;

    if (wialonSid) {
        try {
            await wialonLogout(wialonSid);
        } catch (error) {
            console.error('⚠️ Wialon logout error (ignored):', error.message);
        }
    }

    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// =====================================================
// GET /api/me  -> current logged in user info
// =====================================================

router.get('/me', (req, res) => {

    if (!req.session || !req.session.user) {
        return res.status(401).json({
            success: false,
            error: 'Not authenticated'
        });
    }

    res.json({
        success: true,
        user: req.session.user
    });
});

module.exports = router;
