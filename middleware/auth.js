// =====================================================
// AUTH MIDDLEWARE
// =====================================================
// Protects API routes and pages using express-session.
// req.session.user is set on successful login (routes/auth.js)
// =====================================================

function requireAuth(req, res, next) {

    if (req.session && req.session.user) {
        return next();
    }

    // API calls -> JSON 401, page loads -> redirect to /login.html
    if (req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({
            success: false,
            error: 'Not authenticated'
        });
    }

    return res.redirect('/login.html');
}

function requireAdmin(req, res, next) {

    if (req.session && req.session.user && req.session.user.role === 'admin') {
        return next();
    }

    if (req.originalUrl.startsWith('/api/')) {
        return res.status(403).json({
            success: false,
            error: 'Admin access required'
        });
    }

    return res.redirect('/index.html');
}

// =====================================================
// requirePermission(screen)
// =====================================================
// Gate a page/API route behind one of the checkboxes set on
// /admin-users.html (User.permissions). Admins always pass —
// permissions only restrict role:'customer'. Must run AFTER
// requireAuth (or be combined with it) since it reads
// req.session.user.
// =====================================================
function requirePermission(screen) {
    return function (req, res, next) {

        if (!req.session || !req.session.user) {
            if (req.originalUrl.startsWith('/api/')) {
                return res.status(401).json({ success: false, error: 'Not authenticated' });
            }
            return res.redirect('/login.html');
        }

        const user = req.session.user;

        if (user.role === 'admin') return next();

        const allowed = user.permissions && user.permissions[screen];

        if (allowed) return next();

        if (req.originalUrl.startsWith('/api/')) {
            return res.status(403).json({
                success: false,
                error: `You don't have permission to access "${screen}". Ask an admin to enable it from Manage Users.`
            });
        }

        return res.redirect('/index.html');
    };
}

function requireLocalAccount(req, res, next) {
    if (!req.session?.user) return requireAuth(req, res, next);
    if (req.session.user.authMode === 'local') return next();
    if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ success: false, error: 'Wialon Reports is available to local accounts only.' });
    return res.redirect('/index.html');
}

module.exports = {
    requireAuth,
    requireAdmin,
    requirePermission,
    requireLocalAccount
};
