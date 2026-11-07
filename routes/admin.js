const express = require('express');
const router = express.Router();

const User = require('../models/User');
const { requireAdmin } = require('../middleware/auth');

// All routes here require admin
router.use(requireAdmin);

// Keep only whitelisted permission keys, coerced to booleans —
// never trust the client to send arbitrary fields into the doc.
function sanitizePermissions(input) {
    if (!input || typeof input !== 'object') return undefined;
    const clean = {};
    for (const key of User.PERMISSION_SCREENS) {
        if (key in input) clean[key] = !!input[key];
    }
    return clean;
}

// =====================================================
// GET /api/admin/users  -> list all users (no password hashes)
// =====================================================

router.get('/users', async (req, res) => {
    try {
        const users = await User.find({}, '-passwordHash').sort({ createdAt: -1 });
        res.json({ success: true, users });
    } catch (error) {
        console.error('❌ List users error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// POST /api/admin/users  -> create a new user (admin or customer)
// =====================================================

router.post('/users', async (req, res) => {
    try {
        const {
            username,
            password,
            displayName,
            role,
            authMode,
            wialonAccounts,
            assignedUnitNames,
            reportEmail,
            permissions
        } = req.body;

        const useWialonAuth = authMode === 'wialon';

        // Wialon-auth users don't need (or store) a local password —
        // their username/password is checked against Wialon itself on
        // every login. Local-auth users still need both as before.
        if (!username || (!useWialonAuth && !password)) {
            return res.status(400).json({
                success: false,
                error: useWialonAuth
                    ? 'Username is required'
                    : 'Username and password are required'
            });
        }

        if (role && !['admin', 'customer'].includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'role must be "admin" or "customer"'
            });
        }

        const existing = await User.findOne({ username: username.trim().toLowerCase() });

        if (existing) {
            return res.status(409).json({
                success: false,
                error: 'This username already exists'
            });
        }

        const user = new User({
            username: username.trim().toLowerCase(),
            displayName: displayName || username,
            role: role || 'customer',
            authMode: useWialonAuth ? 'wialon' : 'local',
            // wialonAccounts/assignedUnitNames are ignored at request time
            // for authMode:'wialon' users (their own Wialon session already
            // scopes what they see) but we still allow saving them here in
            // case you switch a user back to 'local' auth later.
            wialonAccounts: Array.isArray(wialonAccounts)
                ? wialonAccounts
                : (wialonAccounts || '').split(',').map(s => s.trim()).filter(Boolean),
            assignedUnitNames: Array.isArray(assignedUnitNames)
                ? assignedUnitNames
                : (assignedUnitNames || '').split(',').map(s => s.trim()).filter(Boolean),
            reportEmail: reportEmail || '',
            permissions: sanitizePermissions(permissions) || {}
        });

        if (useWialonAuth) {
            // No local password to set — bcrypt-hashing an empty/undefined
            // string would create a usable (wrong) local password, so we
            // skip setPassword entirely; passwordHash stays unset, which
            // the schema now allows for authMode:'wialon'.
        } else {
            await user.setPassword(password);
        }

        await user.save();

        console.log(`✅ Admin created user: ${user.username} (${user.role})`);

        const safeUser = user.toObject();
        delete safeUser.passwordHash;

        res.json({ success: true, user: safeUser });

    } catch (error) {
        console.error('❌ Create user error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// PATCH /api/admin/users/:id  -> update wialonAccounts / reportEmail / isActive
// =====================================================

router.patch('/users/:id', async (req, res) => {
    try {
        const { wialonAccounts, assignedUnitNames, reportEmail, isActive, displayName, permissions, authMode } = req.body;

        const update = {};

        if (authMode !== undefined && ['local', 'wialon'].includes(authMode)) {
            update.authMode = authMode;
        }

        if (wialonAccounts !== undefined) {
            update.wialonAccounts = Array.isArray(wialonAccounts)
                ? wialonAccounts
                : (wialonAccounts || '').split(',').map(s => s.trim()).filter(Boolean);
        }

        if (assignedUnitNames !== undefined) {
            update.assignedUnitNames = Array.isArray(assignedUnitNames)
                ? assignedUnitNames
                : (assignedUnitNames || '').split(',').map(s => s.trim()).filter(Boolean);
        }

        if (reportEmail !== undefined) update.reportEmail = reportEmail;
        if (isActive !== undefined) update.isActive = isActive;
        if (displayName !== undefined) update.displayName = displayName;

        if (permissions !== undefined) {
            const clean = sanitizePermissions(permissions);
            for (const key of User.PERMISSION_SCREENS) {
                if (clean && key in clean) {
                    update[`permissions.${key}`] = clean[key];
                }
            }
        }

        const user = await User.findByIdAndUpdate(req.params.id, update, { new: true })
            .select('-passwordHash');

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({ success: true, user });

    } catch (error) {
        console.error('❌ Update user error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// DELETE /api/admin/users/:id
// =====================================================

router.delete('/users/:id', async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({ success: true });

    } catch (error) {
        console.error('❌ Delete user error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
