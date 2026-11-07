// EDIT BY NADA — Unit Detail presentation; values come only from the existing unit response.
(() => {
  const $ = id => document.getElementById(id);
  const icon = name => {
    const node = document.createElement('span'); node.className = 'ud-icon'; node.setAttribute('aria-hidden', 'true');
    node.innerHTML = ObserverIcons.svg(name); return node;
  };
  const labelButton = (node, symbol, label) => {
    const text = document.createElement('span'); text.textContent = label; node.replaceChildren(icon(symbol), text);
  };
  const backdrop = document.createElement('div'); backdrop.className = 'ud-backdrop'; backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = '<div class="ud-glow ud-glow-green"></div><div class="ud-glow ud-glow-gold"></div><div class="ud-contours"></div><div class="ud-floor"></div>';
  document.body.prepend(backdrop);
  labelButton(document.querySelector('.back-btn'), 'arrow-left', 'Back to units');
  const exportButton = document.querySelector('.excel-btn');
  labelButton(exportButton, 'file-chart-column', 'Export unit report'); exportButton.disabled = true;
  const headerNote = document.createElement('p'); headerNote.className = 'ud-header-note';
  headerNote.textContent = 'Connection, power and sensor details.'; document.querySelector('.brand-text').append(headerNote);
  const hero = document.querySelector('.unit-title');
  const identity = document.createElement('div'); identity.className = 'ud-identity';
  const eyebrow = document.createElement('p'); eyebrow.className = 'ud-eyebrow'; eyebrow.textContent = 'UNIT OVERVIEW';
  identity.append(eyebrow, $('u-name'));
  const account = document.createElement('div'); account.className = 'ud-account'; account.append(icon('users'), $('u-account')); identity.append(account);
  const identifier = document.createElement('span'); identifier.className = 'ud-identifier';
  identifier.textContent = `Wialon ID · ${new URLSearchParams(location.search).get('id') || '—'}`; identity.append(identifier);
  const visual = document.createElement('div'); visual.className = 'ud-unit-visual'; visual.setAttribute('aria-hidden', 'true');
  visual.innerHTML = '<div class="ud-orbit ud-orbit-one"></div><div class="ud-orbit ud-orbit-two"></div><div class="ud-unit-tile"></div>';
  visual.querySelector('.ud-unit-tile').append(icon('truck'));
  const status = document.createElement('div'); status.className = 'ud-status-holder';
  const statusLabel = document.createElement('span'); statusLabel.className = 'ud-status-caption'; statusLabel.textContent = 'Connection status';
  status.append(statusLabel, $('u-status-badge')); status.setAttribute('aria-live', 'polite');
  const heroSide = document.createElement('div'); heroSide.className = 'ud-hero-side'; heroSide.append(visual, status);
  hero.replaceChildren(identity, heroSide);

  const connection = document.createElement('section'); connection.className = 'ud-section';
  const sensors = document.createElement('section'); sensors.className = 'ud-section';
  const sectionTitle = (section, text, symbol) => {
    const h = document.createElement('h3'); h.className = 'ud-section-title'; h.append(icon(symbol), document.createTextNode(text)); section.append(h);
  };
  sectionTitle(connection, 'Connection overview', 'activity'); sectionTitle(sensors, 'Power & sensors', 'battery');
  const connectionGrid = document.createElement('div'); connectionGrid.className = 'ud-connection-grid'; connection.append(connectionGrid);
  const sensorGrid = document.createElement('div'); sensorGrid.className = 'ud-sensor-grid'; sensors.append(sensorGrid);
  hero.after(connection, sensors);
  for (const id of ['u-device-type', 'u-device-imei', 'u-device-sim']) {
    const card = document.createElement('div'), label = document.createElement('div'), value = document.createElement('div');
    card.className = 'field-card'; label.className = 'label'; value.className = 'value'; value.id = id; value.textContent = '—'; card.append(label, value); connectionGrid.append(card);
  }
  const fields = [
    ['u-lastmsg', 'Last message', 'message-square', 'Latest update received', connectionGrid],
    ['u-offlinedays', 'Offline duration', 'wifi-off', 'Time since last message', connectionGrid],
    ['u-location', 'Last known location', 'globe', 'Reported by the unit', connectionGrid],
    ['u-device-type', 'Device Type', 'truck', 'Device type recorded for this unit', connectionGrid],
    ['u-device-imei', 'Device IMEI', 'clipboard-check', 'Device identifier from Wialon', connectionGrid],
    ['u-device-sim', 'Device SIM Number', 'message-square', 'SIM number recorded for this unit', connectionGrid],
    ['u-battery', 'Vehicle battery', 'battery', 'Latest voltage reading', sensorGrid],
    ['u-devbattery', 'Internal battery', 'battery', 'Device backup battery', sensorGrid],
    ['u-mileage', 'Mileage sensor', 'chart-column', 'Sensor availability', sensorGrid],
    ['u-fuel', 'Fuel sensor', 'fuel', 'Sensor availability', sensorGrid]
  ];
  fields.forEach(([id, title, symbol, description, grid], index) => {
    const card = $(id).closest('.field-card'); card.dataset.field = id; card.style.setProperty('--card-delay', `${100 + index * 65}ms`);
    card.querySelector('.label').textContent = title;
    const tile = icon(symbol); tile.classList.add('ud-card-icon');
    const detail = document.createElement('p'); detail.className = 'ud-card-detail'; detail.textContent = description;
    card.append(tile, detail); grid.append(card);
  });
  const technical = $('u-battsource').closest('.field-card'); technical.hidden = true;
  const oldGrid = document.querySelector('.grid'); oldGrid.hidden = true;
  // Keep hidden original fields available for the original renderer, without extra empty cards.
  const dateFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const decorate = unit => {
    const rawTime = unit?.lastMessageTime || $('u-lastmsg').textContent.trim();
    const last = Date.parse(rawTime);
    if (Number.isFinite(last)) { $('u-lastmsg').textContent = dateFormat.format(new Date(last)); $('u-lastmsg').title = rawTime; }
    const offline = unit ? !!unit.isOffline : $('u-status-badge').classList.contains('offline');
    hero.dataset.connection = offline ? 'offline' : 'online';
    $('u-offlinedays').textContent = offline && Number.isFinite(last) ? `${Math.max(0, (Date.now() - last) / 3600000).toFixed(1)} h` : '—';
    $('u-offlinedays').closest('.field-card').querySelector('.ud-card-detail').textContent = offline ? 'Time since last message' : 'Unit is online';
    if (unit) {
      for (const [id, value] of [['u-battery', unit.batteryVolts], ['u-devbattery', unit.deviceBatteryVolts]]) $(id).textContent = value === null || value === undefined || value === '' ? '—' : `${value} V`;
      $('u-mileage').textContent = typeof unit.hasMileage === 'boolean' ? unit.hasMileage ? 'Available' : 'Not available' : '—';
      $('u-fuel').textContent = typeof unit.hasFuel === 'boolean' ? unit.hasFuel ? 'Available' : 'Not available' : '—';
      $('u-battery-card').classList.toggle('batt-zero', unit.batteryStatus === 'zero');
      $('u-battery-card').querySelector('.ud-card-detail').textContent = unit.batteryStatus === 'zero' ? 'Zero voltage reported' : unit.batteryVolts === null || unit.batteryVolts === undefined ? 'No voltage reading available' : 'Latest voltage reading';
      $('u-name').textContent = unit.name || '—'; $('u-account').textContent = unit.accountGroup || '—'; $('u-location').textContent = unit.location || '—';
      const value = input => input === null || input === undefined || input === '' || input === 'N/A' ? '—' : String(input);
      $('u-device-type').textContent = value(unit.deviceType);
      $('u-device-imei').textContent = value(unit.imei || unit.serialNumber);
      $('u-device-sim').textContent = value(unit.mobileNumber);
      identifier.textContent = `Wialon ID · ${unit.id ?? new URLSearchParams(location.search).get('id') ?? '—'}`;
    }
    exportButton.disabled = false;
  };
  const originalRender = window.renderUnit;
  window.renderUnit = unit => { originalRender(unit); decorate(unit); };
  const originalError = window.showError;
  window.showError = message => { originalError(message); exportButton.disabled = true; $('content').style.display = 'none'; };
  if ($('u-name').textContent.trim() !== '-') decorate();
})();
