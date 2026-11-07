// EDIT BY NADA — connect the shared two-box unit selector to existing Wialon loading and send flows.
(() => {
    const legacy = document.getElementById('send-unit-picker');
    if (!legacy || window.ObserverSmsUnits) return;
    const create = (tag, cls, text) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const phone = value => {
        let number = String(value || '').trim().replace(/[\s().-]/g, '').replace(/^\+/, '').replace(/^00/, '');
        if (/^01[0125]\d{8}$/.test(number)) number = '20' + number.slice(1);
        return /^\d{10,15}$/.test(number) ? number : '';
    };
    const picker = create('section', 'sms-live-picker'); picker.setAttribute('aria-label', 'Wialon unit recipients');
    const toolbar = create('div', 'sms-live-toolbar'), heading = create('h3', '', 'Unit recipients'), refresh = create('button', '', 'Refresh units');
    refresh.type = 'button'; refresh.addEventListener('click', () => window.loadSendHelpers());
    toolbar.append(heading, refresh);
    const description = create('p', '', 'Mark units on the left, then Move them to Selected units.');
    const connection = create('span', 'sms-live-connection'); connection.hidden = true;
    const host = create('div'), notice = create('p', 'sms-live-notice'); notice.setAttribute('role', 'status');
    picker.append(toolbar, description, connection, host, notice);
    legacy.closest('.row').after(picker); legacy.parentElement.hidden = true;
    document.querySelector('label:has(+ #send-numbers)')?.replaceChildren(document.createTextNode('Additional phone numbers (optional)'));
    let units = [], loading = true, error = '', pending = false;
    const selected = new Map();
    // EDIT BY NADA — left-hand marks are staging only; the send flow consumes committed right-hand units.
    const transfer = ObserverUnitTransfer.create({ host, onChange: rows => { selected.clear(); rows.forEach(unit => selected.set(String(unit.id), unit)); render(); } });
    function render() {
        const phase = loading ? 'loading' : pending ? 'pending' : error ? 'error' : 'connected';
        connection.dataset.state = phase;
        transfer.update({ units, selectedIds: [...selected.keys()], phase, error });
        const missing = [...selected.values()].filter(unit => !phone(unit.mobileNumber)).length;
        notice.hidden = !missing;
        notice.textContent = missing ? missing + ' selected unit(s) have no valid SIM. Review or remove them before sending.' : '';
        refresh.disabled = loading;
    }
    const accept = data => {
        loading = false; pending = !!data.success && data.integrationAvailable === false;
        error = data.success ? '' : data.error || 'Unable to load units from Wialon.';
        units = data.success && !pending && Array.isArray(data.units) ? data.units : [];
        const available = new Map(units.map(unit => [String(unit.id), unit]));
        for (const id of selected.keys()) { if (available.has(id)) selected.set(id, available.get(id)); else selected.delete(id); }
        render();
    };
    window.ObserverSmsUnits = {
        loading() { loading = true; error = ''; render(); },
        prepare() {
            const result = document.getElementById('send-result');
            if ((selected.size && (loading || error)) || [...selected.values()].some(unit => !phone(unit.mobileNumber))) {
                result.textContent = loading ? 'Wait for Wialon units to load.' : error || 'A selected unit has no valid SIM number.';
                return { valid: false };
            }
            const additional = document.getElementById('send-numbers').value.split(/[,;\n]+/).map(value => value.trim()).filter(Boolean);
            if (additional.some(value => !phone(value))) { result.textContent = 'Review the additional phone numbers.'; return { valid: false }; }
            const numbers = [...new Set([...selected.values()].map(unit => phone(unit.mobileNumber)).concat(additional.map(phone)))];
            legacy.value = selected.size === 1 ? selected.keys().next().value : '';
            return { valid: true, numbers: numbers.join(',') };
        }
    };
    window.addEventListener('observer:sms-units', event => accept(event.detail));
    if (window.observerSmsUnitLoad) accept(window.observerSmsUnitLoad); else render();
})();
