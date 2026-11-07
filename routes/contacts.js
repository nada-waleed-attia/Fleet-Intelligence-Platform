const express = require('express');
const router = express.Router();

const { requireAuth, requirePermission } = require('../middleware/auth');
const SmsContact = require('../models/SmsContact');

// =====================================================
// GET /api/contacts?group=Ops+Team
// List saved contacts, optionally filtered by group.
// =====================================================

router.get('/', requireAuth, requirePermission('sms'), async (req, res) => {
    try {
        const filter = {};
        if (req.query.group) filter.group = req.query.group;

        const contacts = await SmsContact.find(filter).sort({ group: 1, name: 1 });
        res.json({ success: true, contacts });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// GET /api/contacts/groups
// Distinct group names, for the group picker.
// =====================================================

router.get('/groups', requireAuth, requirePermission('sms'), async (req, res) => {
    try {
        const groups = await SmsContact.distinct('group');
        res.json({ success: true, groups: groups.sort() });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// POST /api/contacts
// body: { name, phoneNumber, group?, notes? }
// =====================================================

router.post('/', requireAuth, requirePermission('sms'), async (req, res) => {
    try {
        const { name, phoneNumber, group, notes } = req.body;

        if (!name || !phoneNumber) {
            return res.status(400).json({ success: false, error: 'Name and phone number are required' });
        }

        const contact = await SmsContact.create({
            name: String(name).trim(),
            phoneNumber: String(phoneNumber).trim(),
            group: group ? String(group).trim() : 'General',
            notes: notes || '',
            createdBy: req.session.user.username
        });

        res.json({ success: true, contact });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =====================================================
// DELETE /api/contacts/:id
// =====================================================

router.delete('/:id', requireAuth, requirePermission('sms'), async (req, res) => {
    try {
        await SmsContact.findByIdAndDelete(req.params.id);
        res.json({ success: true });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
