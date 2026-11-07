// EDIT BY NADA — small offline preview renderers; these are not bundled Chart.js/html5-qrcode.
(() => {
  const P = globalThis.ObserverPreview;
  class LocalChart {
    static register() {}
    constructor(canvas, config) {
      this.canvas = canvas; this.config = config; this.hidden = new Set();
      // EDIT BY NADA — animate only the dashboard charts, unless reduced motion is requested.
      this.isDashboardChart = ['chart-status', 'chart-battery'].includes(canvas.id);
      if (this.isDashboardChart) {
        config.data.datasets[0].backgroundColor = config.type === 'doughnut' ? ['#518c69', '#c56d77'] : ['#518c69', '#d0aa51', '#9cb985'];
        if (config.type !== 'doughnut') config.data.labels = ['Healthy battery', 'Needs attention', 'No data'];
      }
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
      this.progress = this.isDashboardChart && !this.reducedMotion.matches ? 0 : 1;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', config.data.labels.map((label, i) => `${label}: ${config.data.datasets[0].data[i]}`).join(', '));
      this.legend = document.createElement('div'); this.legend.className = 'preview-chart-key'; canvas.after(this.legend);
      config.data.labels.forEach((label, i) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = `${label}: ${config.data.datasets[0].data[i]}`; button.style.setProperty('--legend-color', config.data.datasets[0].backgroundColor[i]); button.setAttribute('aria-pressed', 'true'); button.addEventListener('click', () => { this.hidden.has(i) ? this.hidden.delete(i) : this.hidden.add(i); button.setAttribute('aria-pressed', String(!this.hidden.has(i))); this.draw(); }); this.legend.append(button); });
      this.observer = new ResizeObserver(() => this.draw()); this.observer.observe(canvas.parentElement); this.draw();
      // EDIT BY NADA — render Cairo on the canvas once the local font has loaded.
      document.fonts?.ready.then(() => this.draw());
      // EDIT BY NADA — replay dashboard chart animation when the pointer enters its panel.
      this.panel = canvas.closest('.chart-panel');
      this.onPointerEnter = event => { if (event.pointerType === 'mouse') this.animate(); };
      if (this.isDashboardChart && this.panel) this.panel.addEventListener('pointerenter', this.onPointerEnter);
      if (this.progress < 1) this.animate();
    }
    animate() {
      cancelAnimationFrame(this.animationFrame);
      if (this.reducedMotion.matches) { this.progress = 1; this.draw(); return; }
      this.progress = 0; this.draw(); const start = performance.now(), duration = 1500;
      const tick = now => { const t = Math.min(1, Math.max(0, (now - start) / duration)); this.progress = 1 - Math.pow(1 - t, 3); this.draw(); if (t < 1) this.animationFrame = requestAnimationFrame(tick); };
      this.animationFrame = requestAnimationFrame(tick);
    }
    draw() {
      const { canvas, config } = this, values = config.data.datasets[0].data.map((v, i) => this.hidden.has(i) ? 0 : Number(v)), colors = config.data.datasets[0].backgroundColor;
      // EDIT BY NADA — canvas labels follow the preview's light or dark theme.
      const chartStyle = getComputedStyle(canvas), ink = chartStyle.getPropertyValue('--preview-chart-ink').trim() || '#dbe8f5', muted = chartStyle.getPropertyValue('--preview-chart-muted').trim() || '#91a4bb';
      const width = Math.max(1, Math.min(canvas.parentElement.clientWidth - 24, 650)), height = 250, ratio = devicePixelRatio || 1;
      if (canvas.style.width !== width + 'px') canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      canvas.width = width * ratio; canvas.height = height * ratio; const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height); ctx.font = '14px Cairo'; ctx.textAlign = 'center';
      if (config.type === 'doughnut') {
        const total = values.reduce((a, b) => a + b, 0), radius = Math.min(85, Math.max(5, width / 2 - 18)), cx = width / 2, cy = 115; let angle = -Math.PI / 2;
        values.forEach((value, i) => { const next = angle + (total ? value / total : 0) * Math.PI * 2 * this.progress; ctx.beginPath(); ctx.arc(cx, cy, radius, angle, next); ctx.strokeStyle = colors[i]; ctx.lineWidth = 34; ctx.stroke(); angle = next; });
        ctx.fillStyle = ink; ctx.font = this.isDashboardChart ? 'bold 34px Cairo' : 'bold 28px Cairo'; ctx.fillText(String(Math.round(total * this.progress)), cx, cy + 8);
      } else {
        const max = Math.max(1, ...values), step = width / values.length;
        values.forEach((value, i) => {
          const bar = value / max * 150 * this.progress, x = i * step + step / 2;
          ctx.fillStyle = colors[i]; ctx.fillRect(i * step + step * 0.25, 195 - bar, step * 0.5, bar);
          ctx.fillStyle = ink; ctx.font = this.isDashboardChart ? '600 18px Cairo' : '14px Cairo';
          ctx.fillText(String(Math.round(value * this.progress)), x, 183 - bar);
          ctx.font = this.isDashboardChart ? '13px Cairo' : '11px Cairo';
          const label = config.data.labels[i];
          // EDIT BY NADA — larger dashboard labels wrap on narrow screens instead of overlapping.
          if (this.isDashboardChart && ctx.measureText(label).width > step - 10 && label.includes(' ')) {
            const words = label.split(' '), split = Math.ceil(words.length / 2);
            ctx.fillText(words.slice(0, split).join(' '), x, 215);
            ctx.fillText(words.slice(split).join(' '), x, 234);
          } else ctx.fillText(label, x, 218);
        });
      }
      if (!this.isDashboardChart) { ctx.fillStyle = muted; ctx.font = '10px Cairo'; ctx.fillText('Local preview renderer · click labels to toggle', width / 2, 245); }
    }
    destroy() { cancelAnimationFrame(this.animationFrame); this.panel?.removeEventListener('pointerenter', this.onPointerEnter); this.observer.disconnect(); this.legend.remove(); }
  }
  class LocalScanner {
    constructor(id) { this.element = document.getElementById(id); }
    async start(camera, options, onSuccess) { this.element.textContent = 'Use the local scanner dialog in the preview shell.'; const value = await P.call('scan'); if (value !== null) onSuccess(value); }
    async stop() { await P.call('scan-stop'); }
    clear() { this.element.replaceChildren(); }
  }
  globalThis.Chart = LocalChart;
  globalThis.Html5Qrcode = LocalScanner;
})();
