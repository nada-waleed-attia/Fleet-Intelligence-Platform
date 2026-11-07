// The requested Battery Down threshold is explicitly 8000 volts.
(() => {
  const thresholdVolts = 8000;
  const reading = unit => {
    if (!unit || unit.batteryStatus === 'no_data' || unit.batteryVolts === null || unit.batteryVolts === undefined || String(unit.batteryVolts).trim() === '') return null;
    const value = Number(unit.batteryVolts); return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const matches = (unit, mode) => {
    if (!mode || mode === 'all') return true;
    const value = reading(unit); if (value === null) return false;
    if (mode === '0v' || mode === 'zero') return value === 0;
    if (mode === 'down') return value < thresholdVolts;
    if (mode === 'low') return value > 0 && value < thresholdVolts;
    return true;
  };
  globalThis.ObserverBattery = Object.freeze({ thresholdVolts, reading, matches });
})();
