// Battery Down uses the explicitly requested threshold of 8000 volts.
const BATTERY_DOWN_VOLTS = 8000;
const BATTERY_FILTERS = ['battery0', 'battery', 'battery-down', 'battery-zero', 'battery-low'];

function batteryReading(unit) {
    if (!unit || unit.batteryStatus === 'no_data' || unit.batteryVolts === null || unit.batteryVolts === undefined || String(unit.batteryVolts).trim() === '') return null;
    const value = Number(unit.batteryVolts);
    return Number.isFinite(value) && value >= 0 ? value : null;
}

function matchesBattery(unit, mode) {
    if (!mode || mode === 'all') return true;
    const value = batteryReading(unit);
    if (value === null) return false;
    if (mode === 'zero' || mode === '0v') return value === 0;
    if (mode === 'low') return value > 0 && value < BATTERY_DOWN_VOLTS;
    if (mode === 'down') return value < BATTERY_DOWN_VOLTS;
    return true;
}

function batteryMode(filter, query = {}) {
    if (filter === 'battery-zero') return 'zero';
    if (filter === 'battery-low') return 'low';
    if (BATTERY_FILTERS.includes(filter)) return query.battery === '0v' ? 'zero' : ['down', 'zero', 'low'].includes(query.battery) ? query.battery : 'down';
    return ['down', 'zero', '0v', 'low'].includes(query.battery) ? query.battery : 'all';
}

module.exports = { BATTERY_DOWN_VOLTS, BATTERY_FILTERS, batteryReading, matchesBattery, batteryMode };
