// EDIT BY NADA — dashboard presentation only; all counters and actions retain their shared data source.
(() => {
  const $ = id => document.getElementById(id);
  const icon = (name, className = '') => {
    const node = document.createElement('span');
    node.className = `dashboard-icon ${className}`;
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML = ObserverIcons.svg(name);
    return node;
  };
  const labelButton = (node, name, label) => {
    if (!node) return;
    const badge = node.querySelector('#maintenance-badge');
    const text = document.createElement('span'); text.textContent = label;
    node.replaceChildren(icon(name), text);
    if (badge) node.append(badge);
  };
  labelButton($('sms-nav-btn'), 'message-square', 'SMS');
  labelButton($('reports-toggle-btn'), 'chart-column', 'Reports');
  $('reports-toggle-btn')?.append(icon('chevron-right', 'dashboard-menu-chevron'));
  labelButton($('maintenance-btn'), 'wrench', 'Maintenance');
  labelButton($('manage-users-btn'), 'users', 'Manage users');
  const reportIcons = ['chart-column', 'clipboard-list', 'clipboard-check', 'wrench'];
  document.querySelectorAll('.report-icon').forEach((node, index) => node.replaceChildren(icon(reportIcons[index])));

  const backdrop = document.createElement('div');
  backdrop.className = 'dashboard-backdrop'; backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = '<div class="dashboard-aurora dashboard-aurora-green"></div><div class="dashboard-aurora dashboard-aurora-gold"></div><div class="dashboard-contours"></div><div class="dashboard-floor"></div>';
  document.body.prepend(backdrop);

  const welcome = document.querySelector('.welcome');
  if (welcome) {
    const copy = document.createElement('div'); copy.className = 'dashboard-welcome-copy';
    const eyebrow = document.createElement('div'); eyebrow.className = 'dashboard-eyebrow';
    eyebrow.append(icon('layout-dashboard'), document.createTextNode('FLEET OVERVIEW'));
    copy.append(eyebrow);
    for (const node of [...welcome.children]) copy.append(node);
    const intro = copy.querySelector('p');
    if (intro) intro.textContent = 'Your fleet, connected. Everything that needs your attention, in one place.';
    const cta = document.querySelector('.cta-row');
    if (cta) { labelButton(cta.querySelector('button'), 'truck', 'View all units'); cta.querySelector('button')?.append(icon('chevron-right')); copy.append(cta); }
    const visual = document.createElement('div'); visual.className = 'dashboard-fleet-visual';
    visual.innerHTML = '<div class="dashboard-orbit dashboard-orbit-outer" aria-hidden="true"></div><div class="dashboard-orbit dashboard-orbit-inner" aria-hidden="true"></div><div class="dashboard-orbit-sweep" aria-hidden="true"></div><div class="dashboard-unit-tile" aria-hidden="true"></div><div class="dashboard-connection"><span class="dashboard-connection-dot" aria-hidden="true"></span><span>Fleet connectivity</span></div><div class="dashboard-online-rate"><strong id="dashboard-online-rate">—</strong><span>Units online</span></div>';
    visual.querySelector('.dashboard-unit-tile').append(icon('truck'));
    welcome.replaceChildren(copy, visual);
  }

  const cards = [...document.querySelectorAll('.cards > .card')];
  const cardIcons = ['truck', 'activity', 'wifi-off', 'battery'];
  const descriptions = ['All fleet units', 'Sending updates', 'Check connection', 'Battery needs attention'];
  cards.forEach((card, index) => {
    card.style.setProperty('--reveal-delay', `${120 + index * 85}ms`);
    card.append(icon(cardIcons[index], 'dashboard-metric-icon'));
    const foot = document.createElement('span'); foot.className = 'dashboard-metric-detail';
    foot.append(document.createTextNode(descriptions[index]), icon('chevron-right'));
    card.append(foot);
    card.tabIndex = 0; card.setAttribute('role', 'link');
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); } });
  });
  document.querySelector('.card h3').textContent = 'Total units';
  document.querySelectorAll('.chart-panel').forEach((panel, index) => {
    panel.style.setProperty('--reveal-delay', `${430 + index * 100}ms`);
    const heading = panel.querySelector('h3');
    heading.prepend(icon(index ? 'battery' : 'activity', 'dashboard-chart-icon'));
    if (!index) {
      const sub = document.createElement('p'); sub.className = 'chart-subtitle';
      sub.textContent = 'Connection status across your fleet.'; heading.after(sub);
    } else panel.querySelector('.chart-subtitle').textContent = 'Healthy readings, depleted batteries and unavailable sensor data.';
  });

  // Derive the hero figure from the existing counters, including empty and error states.
  const updateRate = () => {
    const total = Number($('c-tot')?.textContent.trim()), online = Number($('c-on')?.textContent.trim());
    const value = $('dashboard-online-rate');
    if (value) value.textContent = Number.isFinite(total) && Number.isFinite(online) && total > 0 ? `${Math.round(online / total * 100)}%` : '—';
  };
  const counters = document.querySelector('.cards');
  if (counters) new MutationObserver(updateRate).observe(counters, { subtree: true, childList: true, characterData: true });
  updateRate();

  // Tilt follows the pointer only on precise pointing devices; keyboard and touch remain steady.
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = matchMedia('(hover: hover) and (pointer: fine)');
  cards.forEach(card => {
    card.addEventListener('pointermove', event => {
      if (motion.matches || !pointer.matches || event.pointerType !== 'mouse') return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--tilt-x', `${(0.5 - (event.clientY - rect.top) / rect.height) * 5}deg`);
      card.style.setProperty('--tilt-y', `${((event.clientX - rect.left) / rect.width - 0.5) * 6}deg`);
    });
    card.addEventListener('pointerleave', () => { card.style.removeProperty('--tilt-x'); card.style.removeProperty('--tilt-y'); });
  });
})();
