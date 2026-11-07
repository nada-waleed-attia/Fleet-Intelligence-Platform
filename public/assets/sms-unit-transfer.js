// EDIT BY NADA — shared vanilla-JS unit transfer list; checked rows become recipients only after Move.
(() => {
    const text = value => String(value ?? '').trim();
    const node = (tag, cls, label) => {
        const element = document.createElement(tag);
        if (cls) element.className = cls;
        if (label !== undefined) element.textContent = label;
        return element;
    };
    const statusOf = unit => typeof unit.isOffline === 'boolean' ? (unit.isOffline ? 'offline' : 'online') : ['online', 'offline'].includes(text(unit.status).toLowerCase()) ? text(unit.status).toLowerCase() : '';
    // EDIT BY NADA — unique field IDs keep existing accessible dropdown enhancements compatible.
    let sequence = 0;
    function create({ host, onChange }) {
        host.classList.add('sms-transfer');
        host.innerHTML = `
          <section class="sms-transfer-pane" aria-label="Available units">
            <div class="sms-transfer-heading"><h4>Available units</h4><span data-count="available" role="status">0</span></div>
            <div class="sms-transfer-tools">
              <label><span>Search available units</span><input type="search" data-search="available" placeholder="Search units…" autocomplete="off"></label>
              <label><span>Connection status</span><select data-status><option value="all">All statuses</option><option value="offline">Offline</option><option value="online">Online</option></select></label>
            </div>
            <label class="sms-transfer-checkall"><input type="checkbox" data-all="available">Select all shown<span data-marked="available">0 marked</span></label>
            <div class="sms-transfer-list" data-list="available" role="group" aria-label="Available units to move"></div>
          </section>
          <div class="sms-transfer-actions">
            <button type="button" data-move>Move <span aria-hidden="true">→</span></button>
            <button type="button" data-remove><span aria-hidden="true">←</span> Remove</button>
          </div>
          <section class="sms-transfer-pane sms-transfer-chosen" aria-label="Selected units">
            <div class="sms-transfer-heading"><h4>Selected units</h4><span data-count="selected" role="status">0</span><button type="button" data-clear>Clear all</button></div>
            <div class="sms-transfer-tools sms-transfer-selected-search"><label><span>Search selected units</span><input type="search" data-search="selected" placeholder="Search selected…" autocomplete="off"></label></div>
            <label class="sms-transfer-checkall"><input type="checkbox" data-all="selected">Select all shown<span data-marked="selected">0 marked</span></label>
            <div class="sms-transfer-list" data-list="selected" role="group" aria-label="Selected unit recipients"></div>
          </section>
          <p class="sms-transfer-feedback" role="status" aria-live="polite"></p>`;
        const get = selector => host.querySelector(selector);
        const searches = { available: get('[data-search="available"]'), selected: get('[data-search="selected"]') };
        const lists = { available: get('[data-list="available"]'), selected: get('[data-list="selected"]') };
        const all = { available: get('[data-all="available"]'), selected: get('[data-all="selected"]') };
        const move = get('[data-move]'), remove = get('[data-remove]'), clear = get('[data-clear]'), filter = get('[data-status]');
        filter.id = 'sms-transfer-status-' + (++sequence); filter.parentElement.htmlFor = filter.id;
        let units = new Map(), chosen = new Map(), phase = 'pending', error = '';
        const marked = { available: new Set(), selected: new Set() };
        const records = pane => [...(pane === 'selected' ? chosen : units).values()].filter(unit => pane === 'selected' || !chosen.has(text(unit.id)));
        const visible = pane => records(pane).filter(unit => {
            const term = searches[pane].value.trim().toLowerCase();
            return [unit.name, unit.id, unit.deviceType, unit.accountGroup, unit.serialNumber, unit.mobileNumber].join(' ').toLowerCase().includes(term)
                && (pane === 'selected' || filter.value === 'all' || statusOf(unit) === filter.value);
        });
        const commit = message => { get('.sms-transfer-feedback').textContent = message; onChange([...chosen.values()]); render(); };
        function render() {
            // EDIT BY NADA — checking rows must not jump either scrollable box back to the top.
            const scroll = { available: lists.available.scrollTop, selected: lists.selected.scrollTop };
            const focused = document.activeElement;
            const active = focused?.dataset.transferId ? { id: focused.dataset.transferId, pane: focused.dataset.pane } : null;
            const ready = phase === 'connected';
            host.dataset.state = phase;
            searches.available.disabled = !ready; filter.disabled = !ready;
            searches.selected.disabled = !chosen.size;
            for (const pane of ['available', 'selected']) {
                const rows = visible(pane), list = lists[pane], checked = rows.filter(unit => marked[pane].has(text(unit.id))).length;
                list.replaceChildren(); list.setAttribute('aria-busy', String(phase === 'loading'));
                if (pane === 'available' && !ready) {
                    const empty = node('div', 'sms-transfer-empty');
                    empty.append(node('strong', '', phase === 'loading' ? 'Loading units…' : phase === 'error' ? 'Unable to load units' : 'Waiting for Wialon'));
                    empty.append(node('span', '', phase === 'error' ? error : phase === 'loading' ? 'Please wait.' : 'Units, device types and SIMs will appear after connection.'));
                    list.append(empty);
                } else if (!rows.length) {
                    list.append(node('p', 'sms-transfer-empty', pane === 'selected' && !chosen.size ? 'Move units here to add them to this message.' : records(pane).length ? 'No units match these filters.' : pane === 'selected' ? 'No selected units.' : 'No more available units.'));
                } else rows.forEach(unit => {
                    const row = node('label', 'sms-transfer-row'), checkbox = node('input');
                    checkbox.type = 'checkbox'; checkbox.dataset.transferId = text(unit.id); checkbox.dataset.pane = pane;
                    checkbox.checked = marked[pane].has(text(unit.id)); checkbox.setAttribute('aria-label', (pane === 'selected' ? 'Mark for removal: ' : 'Mark to move: ') + text(unit.name));
                    checkbox.addEventListener('change', () => { if (checkbox.checked) marked[pane].add(text(unit.id)); else marked[pane].delete(text(unit.id)); render(); });
                    const copy = node('span', 'sms-transfer-copy'), status = statusOf(unit);
                    copy.append(node('strong', '', unit.name || text(unit.id)), node('small', '', `${unit.deviceType || '—'} · ${unit.accountGroup || '—'}`), node('small', 'sms-transfer-sim', unit.mobileNumber ? `SIM: ${unit.mobileNumber}` : 'SIM number missing'));
                    row.append(checkbox, copy);
                    if (status) { const badge = node('span', 'sms-transfer-status', status === 'offline' ? 'Offline' : 'Online'); badge.dataset.status = status; row.append(badge); }
                    list.append(row);
                });
                all[pane].checked = rows.length > 0 && checked === rows.length;
                all[pane].indeterminate = checked > 0 && checked < rows.length;
                all[pane].disabled = !rows.length || (pane === 'available' && !ready);
                get(`[data-count="${pane}"]`).textContent = pane === 'selected' ? chosen.size : `${rows.length} / ${records(pane).length}`;
                get(`[data-marked="${pane}"]`).textContent = `${marked[pane].size} marked`;
                list.scrollTop = scroll[pane];
            }
            move.disabled = !ready || !marked.available.size;
            move.firstChild.textContent = marked.available.size ? `Move (${marked.available.size}) ` : 'Move ';
            remove.disabled = !marked.selected.size; clear.disabled = !chosen.size;
            if (active) [...host.querySelectorAll('input[data-transfer-id]')].find(input => input.dataset.transferId === active.id && input.dataset.pane === active.pane)?.focus({ preventScroll: true });
        }
        // EDIT BY NADA — staging survives searches and filters; only explicit Move/Remove commits recipients.
        for (const pane of ['available', 'selected']) {
            searches[pane].addEventListener('input', render);
            all[pane].addEventListener('change', () => { for (const unit of visible(pane)) { if (all[pane].checked) marked[pane].add(text(unit.id)); else marked[pane].delete(text(unit.id)); } render(); });
        }
        filter.addEventListener('change', render);
        move.addEventListener('click', () => {
            if (phase !== 'connected') return;
            let count = 0;
            for (const id of marked.available) if (units.has(id) && !chosen.has(id)) { chosen.set(id, units.get(id)); count++; }
            marked.available.clear(); commit(`${count} unit${count === 1 ? '' : 's'} moved to Selected units.`);
        });
        remove.addEventListener('click', () => { const count = marked.selected.size; for (const id of marked.selected) chosen.delete(id); marked.selected.clear(); commit(`${count} unit${count === 1 ? '' : 's'} removed.`); });
        clear.addEventListener('click', () => { chosen.clear(); marked.selected.clear(); commit('Selected units cleared.'); });
        render();
        return {
            update(data) {
                // EDIT BY NADA — reconcile both committed and staged IDs against the latest backend response.
                units = new Map((data.units || []).filter(unit => unit.id != null).map(unit => [text(unit.id), unit]));
                chosen = new Map((data.selectedIds || []).map(text).filter(id => units.has(id)).map(id => [id, units.get(id)]));
                phase = data.phase || 'connected'; error = data.error || 'Please retry.';
                for (const id of marked.available) if (!units.has(id) || chosen.has(id)) marked.available.delete(id);
                for (const id of marked.selected) if (!chosen.has(id)) marked.selected.delete(id);
                render();
            }
        };
    }
    globalThis.ObserverUnitTransfer = { create };
})();
