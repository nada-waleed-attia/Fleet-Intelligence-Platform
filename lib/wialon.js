const WIALON_HOST =
    process.env.WIALON_HOST || 'https://hst-api.wialon.eu';

const TOKEN = process.env.WIALON_TOKEN;

// =====================================================
// REPORT TIMEZONE (Cairo by default)
// =====================================================
const REPORT_TZ = process.env.REPORT_TZ || 'Africa/Cairo';

function formatTime(sec) {
    if (!sec) return 'No Data';
    return new Date(sec * 1000).toLocaleString('en-US', {
        timeZone: REPORT_TZ
    });
}

// =====================================================
// ENHANCEMENT 2 — bounded-concurrency mapper + knob
// =====================================================
const { mapLimit } = require('./parallel');
// 1 = same behavior as the old sequential code (safe default).
// Raise only after confirming serial/mobile/device type still fill in.
const WIALON_CONCURRENCY = Number(process.env.WIALON_CONCURRENCY || 1);


// =====================================================
// WIALON REQUEST
// =====================================================

async function wialonRequest(sid, service, params = {}) {

    const url =
        `${WIALON_HOST}/wialon/ajax.html` +
        `?svc=${encodeURIComponent(service)}` +
        `&params=${encodeURIComponent(JSON.stringify(params))}` +
        (sid ? `&sid=${encodeURIComponent(sid)}` : '');

    console.log('');
    console.log('➡️ WIALON REQUEST');
    console.log('➡️ Service:', service);
    console.log('➡️ Has SID:', !!sid);
    console.log('➡️ SID length:', sid ? String(sid).length : 0);

    const controller = new AbortController();
    const timeoutMs = Number(process.env.WIALON_REQUEST_TIMEOUT || 20000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response;

    try {
        response = await fetch(url, {
            method: 'POST',
            signal: controller.signal
        });
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(
                `Wialon request timeout after ${timeoutMs}ms: ${service}`
            );
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(`Invalid JSON from Wialon (${service}): ${text}`);
    }

    console.log('⬅️ WIALON RESPONSE:', service, '| error:', data?.error ?? 0);

    if (data && data.error) {
        throw new Error(
            `Wialon API error (${service}): ${JSON.stringify(data)}`
        );
    }

    return data;
}


// =====================================================
// WIALON LOGIN USING TOKEN
// =====================================================

async function wialonLogin(customToken) {

    const tokenToUse = customToken || TOKEN;

    if (!tokenToUse) {
        throw new Error('WIALON_TOKEN is missing from .env');
    }

    const data = await wialonRequest(null, 'token/login', {
        token: tokenToUse
    });

    console.log('');
    console.log('========================================');
    console.log('WIALON TOKEN LOGIN');
    console.log('========================================');
    console.log('Login response received:', !!data);
    console.log('Has EID:', !!data?.eid);
    console.log('EID length:', data?.eid ? String(data.eid).length : 0);
    console.log('Wialon user:', data?.user?.nm || 'Unknown');
    console.log('========================================');
    console.log('');

    if (!data || !data.eid) {
        throw new Error('Wialon Login Failed: ' + JSON.stringify(data));
    }

    return data.eid;
}


// =====================================================
// DIRECT LOGIN
// =====================================================

async function wialonDirectLogin(username, password) {

    const data = await wialonRequest(null, 'core/login', {
        user: username,
        password: password
    });

    if (!data || !data.eid) {

        const knownErrors = {
            1: 'Invalid session',
            7: 'Access denied for this Wialon account',
            8: 'Invalid Wialon username or password',
            9: 'Wialon authorization server is unavailable',
            11: 'Password reset required on Wialon',
            1006: 'Too many failed attempts',
            1011: 'Wialon session expired or IP changed'
        };

        const code = data && data.error;

        throw new Error(
            'Wialon direct login failed: ' +
            (knownErrors[code] || JSON.stringify(data))
        );
    }

    return {
        eid: data.eid,
        wialonUser: data.user || null
    };
}


// =====================================================
// TOKEN LOGIN FULL
// =====================================================

async function wialonTokenLoginFull(token) {

    if (!token) {
        throw new Error('Wialon access_token is missing');
    }

    const data = await wialonRequest(null, 'token/login', { token });

    console.log('');
    console.log('========================================');
    console.log('WIALON OAUTH TOKEN LOGIN');
    console.log('========================================');
    console.log('Has response:', !!data);
    console.log('Has EID:', !!data?.eid);
    console.log('EID length:', data?.eid ? String(data.eid).length : 0);
    console.log('Wialon username:', data?.user?.nm || 'Unknown');
    console.log('Wialon user ID:', data?.user?.id || 'Unknown');
    console.log('========================================');
    console.log('');

    if (!data || !data.eid) {
        throw new Error('Wialon token login failed: ' + JSON.stringify(data));
    }

    // ---- SESSION TEST ----

    console.log('🔎 Testing Wialon SID with core/search_items...');

    const testResult = await wialonRequest(data.eid, 'core/search_items', {
        spec: {
            itemsType: 'avl_unit',
            propName: 'sys_name',
            propValueMask: '*',
            sortType: 'sys_name'
        },
        force: 1,
        flags: 1,
        from: 0,
        to: 0
    });

    console.log('✅ Wialon SID test successful.');
    console.log(
        '✅ Units visible to this Wialon login:',
        testResult?.items?.length || 0
    );

    return {
        eid: data.eid,
        wialonUser: data.user || null
    };
}


// =====================================================
// FETCH UNITS
// =====================================================

async function fetchUnitsData(sid) {

    if (!sid) {
        throw new Error('WIALON_SESSION_MISSING');
    }

    const searchParams = {
        spec: {
            itemsType: 'avl_unit',
            propName: 'sys_name',
            propValueMask: '*',
            sortType: 'sys_name'
        },
        force: 1,
        flags:
            1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256 | 512 |
            1024 | 2048 | 4096 | 8192 | 16384 | 32768,
        from: 0,
        to: 0
    };

    const data = await wialonRequest(sid, 'core/search_items', searchParams);

    console.log(
        '🩺 Wialon dataFlags requested vs applied:',
        searchParams.flags,
        '=>',
        data?.dataFlags
    );

    if (Array.isArray(data.items) && data.items[0]) {
        console.log('🩺 First unit raw keys:', Object.keys(data.items[0]));
    }

    return data.items || [];
}


// =====================================================
// FETCH UNIT ADVANCED PROPERTIES
// =====================================================

async function requestWithRetry(sid, service, params, attempts = 3) {

    let lastError = null;

    for (let i = 1; i <= attempts; i++) {

        try {
            return await wialonRequest(sid, service, params);
        } catch (error) {

            lastError = error;

            console.warn(
                `⚠️ ${service} failed (attempt ${i}/${attempts}): ${error.message}`
            );

            if (i < attempts) {
                await new Promise(r => setTimeout(r, 400 * i));
            }
        }
    }

    throw lastError;
}

async function fetchUnitAdvancedProps(sid, unitId) {

    if (!sid || !unitId) {
        return null;
    }

    try {

        const data = await requestWithRetry(sid, 'core/search_item', {
            id: Number(unitId),
            flags: 257
        });

        const item = data?.item || null;

        console.log('');
        console.log('🔐 ========================================');
        console.log('🔐 ADVANCED PROPERTIES');
        console.log('🔐 UNIT ID:', unitId);
        console.log('🔐 WIALON APPLIED FLAGS:', data?.flags);
        console.log('🔐 UID:', JSON.stringify(item?.uid));
        console.log('🔐 UID2:', JSON.stringify(item?.uid2));
        console.log('🔐 PH:', JSON.stringify(item?.ph));
        console.log('🔐 PH2:', JSON.stringify(item?.ph2));
        console.log('🔐 HW:', JSON.stringify(item?.hw));
        console.log('🔐 RAW KEYS:', item ? Object.keys(item) : []);
        console.log('🔐 ========================================');
        console.log('');

        return item;

    } catch (error) {

        console.error(
            `⚠️ Advanced properties error for unit ${unitId}:`,
            error.message
        );

        return null;
    }
}


// =====================================================
// TEMP DIAGNOSTIC: SINGLE UNIT, MAX FLAGS
// =====================================================

async function debugSingleUnitMaxFlags(sid, unitId) {

    const data = await wialonRequest(sid, 'core/search_item', {
        id: Number(unitId),
        flags: 0x1FFFFFFF
    });

    console.log('🩺 DEBUG single unit dataFlags applied:', data?.flags);
    console.log('🩺 DEBUG single unit raw item:', JSON.stringify(data?.item));

    return data;
}


// =====================================================
// GET LAST MESSAGE
// =====================================================

async function fetchLastMessage(sid, unitId) {

    const now = Math.floor(Date.now() / 1000);

    try {

        const data = await wialonRequest(sid, 'messages/load_last', {
            itemId: Number(unitId),
            lastTime: now,
            lastCount: 1,
            flags: 1,
            flagsMask: 65281,
            loadCount: 1
        });

        const messages =
            data && Array.isArray(data.messages) ? data.messages : [];

        if (messages.length === 0) {
            return null;
        }

        let latest = messages[0];

        for (const msg of messages) {
            if ((msg?.t || 0) > (latest?.t || 0)) {
                latest = msg;
            }
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const ageSeconds = nowSec - (latest?.t || 0);

        console.log(
            `🕒 unit ${unitId} lastMessage age:`,
            `${ageSeconds}s`,
            `(msg.t=${latest?.t}, now=${nowSec})`
        );

        return latest;

    } catch (error) {

        console.error(`Message error for unit ${unitId}:`, error.message);

        return null;
    }
}


// =====================================================
// HW TYPE NAMES
// =====================================================
// FIX: the old version called core/get_hw_types with {} which
// returns an empty list, then cached that empty result forever.
// Now we try several param shapes, take the first non-empty
// result, and NEVER cache an empty map.
// =====================================================

let hwTypeNameCache = null;

async function fetchHwTypeNames(sid) {

    if (hwTypeNameCache && Object.keys(hwTypeNameCache).length > 0) {
        return hwTypeNameCache;
    }

    const attempts = [
        {},   // original call (worked in the previous version)
        {
            filterType: 'type',
            filterValue: ['auto', 'tracker', 'mobile', 'other'],
            includeType: true,
            ignoreRename: true
        }
    ];

    for (const params of attempts) {

        try {

            const data = await wialonRequest(
                sid,
                'core/get_hw_types',
                params
            );

            const map = {};

            (Array.isArray(data) ? data : []).forEach(hw => {
                if (hw && hw.id != null) {
                    map[String(hw.id)] = hw.name || hw.nm || `HW ${hw.id}`;
                }
            });

            if (Object.keys(map).length > 0) {

                console.log(
                    '✅ Loaded Wialon hw type names:',
                    Object.keys(map).length,
                    '| params:',
                    JSON.stringify(params)
                );

                hwTypeNameCache = map;

                return map;
            }

            console.warn(
                '⚠️ core/get_hw_types returned an empty list for params:',
                JSON.stringify(params)
            );

        } catch (error) {

            console.error(
                '⚠️ core/get_hw_types failed for params',
                JSON.stringify(params),
                '-',
                error.message
            );
        }
    }

    console.warn(
        '⚠️ Could not load any hw type names. Device types will show ' +
        'as "Unknown HW (<id>)". Check that the token/user has rights ' +
        'to read hw types.'
    );

    return {};
}


// =====================================================
// LOGOUT
// =====================================================

async function wialonLogout(sid) {

    if (!sid) {
        return;
    }

    try {
        await wialonRequest(sid, 'core/logout', {});
        console.log('✅ Wialon logout successful');
    } catch (error) {
        console.error('⚠️ Wialon logout error:', error.message);
    }
}


// =====================================================
// NUMBER
// =====================================================

function toNumber(value) {

    if (value === undefined || value === null || value === '') {
        return null;
    }

    if (typeof value === 'object') {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}


// =====================================================
// GET MESSAGE PARAMS
// =====================================================

function getMessageParams(unit, lastMessage) {

    if (lastMessage?.p && typeof lastMessage.p === 'object') {
        return lastMessage.p;
    }

    if (unit?.lmsg?.p && typeof unit.lmsg.p === 'object') {
        return unit.lmsg.p;
    }

    if (unit?.last_message?.p && typeof unit.last_message.p === 'object') {
        return unit.last_message.p;
    }

    return {};
}


// =====================================================
// FIND SENSOR BY NAME
// =====================================================

function findSensor(unit, sensorNames, options = {}) {

    const sensors = unit?.sens || {};

    const excludeContains = (options.excludeContains || []).map(
        s => String(s).trim().toLowerCase()
    );

    const candidates = sensorNames.map(
        s => String(s).trim().toLowerCase()
    );

    // ---- pass 1: exact match ----

    for (const id of Object.keys(sensors)) {

        const sensor = sensors[id];

        if (!sensor) continue;

        const name = String(sensor.n || '').trim().toLowerCase();

        if (candidates.includes(name)) {
            return sensor;
        }
    }

    // ---- pass 2: fuzzy / substring match ----

    for (const id of Object.keys(sensors)) {

        const sensor = sensors[id];

        if (!sensor) continue;

        const name = String(sensor.n || '').trim().toLowerCase();

        if (!name) continue;

        if (excludeContains.some(x => name.includes(x))) continue;

        if (candidates.some(c => name.includes(c))) {
            return sensor;
        }
    }

    return null;
}


// =====================================================
// SENSOR PARAMETER
// =====================================================

function getSensorParameter(sensor) {

    if (!sensor) return null;

    const expression = String(sensor.p || '').trim();

    const match = expression.match(/^([a-zA-Z0-9_]+)$/);

    if (!match) return null;

    return match[1];
}


// =====================================================
// SENSOR CONSTANT
// =====================================================

function getSensorConstant(sensor) {

    if (!sensor) return null;

    const expression = String(sensor.p || '').trim();

    const match = expression.match(/^const(-?\d+(\.\d+)?)$/i);

    if (!match) return null;

    return Number(match[1]);
}


// =====================================================
// VOLTAGE CONVERSION
// =====================================================

function convertVoltage(raw, type) {

    const value = toNumber(raw);

    if (value === null || value <= 0) {
        return null;
    }

    let voltage = value / 1000;

    if (value >= 5 && value <= 100) {
        voltage = value;
    }

    if (type === 'main') {
        if (voltage >= 5 && voltage <= 100) {
            return Number(voltage.toFixed(2));
        }
        return null;
    }

    if (type === 'internal') {
        if (voltage >= 1 && voltage <= 6) {
            return Number(voltage.toFixed(2));
        }
        return null;
    }

    return null;
}


// =====================================================
// FIND MAIN BATTERY
// =====================================================

function findMainBattery(unit, lastMessage) {

    const params = getMessageParams(unit, lastMessage);

    const sensor = findSensor(
        unit,
        [
            'battery',
            'voltage sensor',
            'external battery',
            'unit battery',
            'main battery',
            'vehicle battery'
        ],
        { excludeContains: ['internal', 'device'] }
    );

    if (!sensor) {
        return { value: 0, source: 'battery_sensor_not_found' };
    }

    const parameter = getSensorParameter(sensor);

    if (!parameter) {
        return { value: 0, source: 'battery_parameter_not_found' };
    }

    const raw = params[parameter];

    const voltage = convertVoltage(raw, 'main');

    console.log(
        `🔋 ${unit.nm} MAIN:`,
        `${parameter}=${raw}`,
        `=> ${voltage ?? 0}V`
    );

    if (voltage !== null) {
        return {
            value: voltage,
            source: `sensor:${sensor.n}(${parameter})`
        };
    }

    return { value: 0, source: `invalid:${parameter}=${raw}` };
}


// =====================================================
// FIND INTERNAL BATTERY
// =====================================================

function findInternalBattery(unit, lastMessage) {

    const params = getMessageParams(unit, lastMessage);

    const sensor = findSensor(unit, [
        'internal battery',
        'device battery',
        'internal batt',
        'backup battery'
    ]);

    if (!sensor) {
        return { value: 0, source: 'internal_sensor_not_found' };
    }

    const parameter = getSensorParameter(sensor);

    if (!parameter) {
        return { value: 0, source: 'internal_parameter_not_found' };
    }

    const raw = params[parameter];

    const voltage = convertVoltage(raw, 'internal');

    console.log(
        `🔋 ${unit.nm} INTERNAL:`,
        `${parameter}=${raw}`,
        `=> ${voltage ?? 0}V`
    );

    if (voltage !== null) {
        return {
            value: voltage,
            source: `sensor:${sensor.n}(${parameter})`
        };
    }

    return { value: 0, source: `invalid:${parameter}=${raw}` };
}


// =====================================================
// GENERIC NUMERIC SENSOR FINDER
// =====================================================

function findNumericSensor(unit, lastMessage, sensorNames, label, options = {}) {

    const sensor = findSensor(unit, sensorNames, options);

    if (!sensor) {
        return { value: null, source: `${label}_sensor_not_found` };
    }

    const value = resolveSensorValue(unit, lastMessage, sensor);

    console.log(
        `⛽ ${unit.nm} ${label}:`,
        `formula="${sensor.p}"`,
        `=> ${value ?? 'null (unresolved)'}`
    );

    if (value !== null) {
        return {
            value,
            source: `sensor:${sensor.n}(${sensor.p})`
        };
    }

    return { value: null, source: `invalid_formula:${sensor.p}` };
}


// =====================================================
// RESOLVE SENSOR VALUE
// =====================================================

function resolveSensorValue(unit, lastMessage, sensor, depth = 0) {

    if (!sensor || depth > 4) {
        return null;
    }

    const constantValue = getSensorConstant(sensor);

    if (constantValue !== null) {
        return constantValue;
    }

    const parameter = getSensorParameter(sensor);

    if (parameter) {
        const params = getMessageParams(unit, lastMessage);
        return toNumber(params[parameter]);
    }

    return evaluateSensorFormula(unit, lastMessage, sensor.p, depth);
}


// =====================================================
// EVALUATE SENSOR FORMULA
// =====================================================

function evaluateSensorFormula(unit, lastMessage, expression, depth) {

    if (!expression) {
        return null;
    }

    let expr = String(expression);

    let hadUnresolvedRef = false;

    expr = expr.replace(/\[([^\]]+)\]/g, (match, sensorName) => {

        const refSensor = findSensor(unit, [
            String(sensorName).trim().toLowerCase()
        ]);

        const value = resolveSensorValue(
            unit,
            lastMessage,
            refSensor,
            depth + 1
        );

        if (value === null) {
            hadUnresolvedRef = true;
            return '0';
        }

        return String(value);
    });

    if (hadUnresolvedRef) {
        return null;
    }

    expr = expr.replace(/const(-?\d+(\.\d+)?)/gi, '$1');

    const params = getMessageParams(unit, lastMessage);

    let hadUnresolvedParam = false;

    expr = expr.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, identifier => {

        const value = toNumber(params[identifier]);

        if (value === null) {
            hadUnresolvedParam = true;
            return '0';
        }

        return String(value);
    });

    if (hadUnresolvedParam) {
        return null;
    }

    if (!/^[\d\s+\-*/().]+$/.test(expr)) {
        return null;
    }

    try {

        // eslint-disable-next-line no-new-func
        const result = Function('"use strict"; return (' + expr + ');')();

        return Number.isFinite(result) ? result : null;

    } catch {

        return null;
    }
}


// =====================================================
// RAW PARAM FALLBACK
// =====================================================

function findRawParam(unit, lastMessage, paramNames) {

    const params = getMessageParams(unit, lastMessage);

    for (const name of paramNames) {

        if (
            params[name] !== undefined &&
            params[name] !== null &&
            params[name] !== ''
        ) {
            return {
                value: toNumber(params[name]),
                paramName: name
            };
        }
    }

    return null;
}


// =====================================================
// FIND MILEAGE SENSOR
// =====================================================

function findMileageSensor(unit, lastMessage) {

    const result = findNumericSensor(
        unit,
        lastMessage,
        ['mileage sensor', 'mileage', 'odometer'],
        'MILEAGE'
    );

    if (result.value !== null) {

        result.value = Number((result.value * 0.005).toFixed(2));

        return result;
    }

    const raw = findRawParam(unit, lastMessage, [
        'can_milege',
        'Can_milege',
        'CAN_mileage',
        'can_mileage',
        'CAN_MILEGE'
    ]);

    if (raw && raw.value !== null) {

        const value = Number((raw.value * 0.005).toFixed(2));

        console.log(
            `⛽ ${unit.nm} MILEAGE (raw fallback):`,
            `${raw.paramName}=${raw.value}`,
            `=> ${value}`
        );

        return {
            value,
            source: `raw_param_fallback:${raw.paramName}*0.005`
        };
    }

    result.value = 0;

    return result;
}


// =====================================================
// FIND TOTAL FUEL
// =====================================================

function findTotalFuel(unit, lastMessage) {

    const sensor = findSensor(unit, [
        'total fuel',
        'total fuel used',
        'total-fuel'
    ]);

    if (!sensor) {
        return { value: 0, source: 'TOTAL_FUEL_sensor_not_found' };
    }

    const rawValue = resolveSensorValue(unit, lastMessage, sensor);

    console.log(
        `⛽ ${unit.nm} TOTAL_FUEL:`,
        `formula="${sensor.p}"`,
        `=> ${rawValue ?? 0}`
    );

    if (rawValue === null) {
        return { value: 0, source: `invalid_formula:${sensor.p}` };
    }

    return {
        value: Number(rawValue.toFixed(2)),
        source: `sensor:${sensor.n}(${sensor.p})`
    };
}


// =====================================================
// FIND FUEL PERCENTAGE
// =====================================================

function findFuelPercentage(unit, lastMessage) {

    const result = findNumericSensor(
        unit,
        lastMessage,
        ['fuel percentage', 'fuel %', 'fuel level'],
        'FUEL_PCT'
    );

    if (result.value !== null) {

        result.value = Math.round(result.value * 10) / 10;

        if (result.value > 100) {

            console.warn(
                `⚠️ ${unit.nm} FUEL_PCT anomaly: raw result ${result.value}% ` +
                `exceeds 100%, clamping to 100. ` +
                `Check this unit's "Fuel level" sensor calibration table in Wialon.`
            );

            result.value = 100;

            result.source = `${result.source}|clamped_from_over_100`;
        }

        return result;
    }

    const raw = findRawParam(unit, lastMessage, [
        'CAN_FLS',
        'can_fls',
        'CanFls'
    ]);

    if (raw && raw.value !== null) {

        let value = Math.round(((raw.value / 250) * 100) * 10) / 10;

        if (value > 100) {

            console.warn(
                `⚠️ ${unit.nm} FUEL_PCT (raw fallback) anomaly: raw result ${value}% ` +
                `exceeds 100%, clamping to 100. ` +
                `Check this unit's CAN_FLS calibration/scale in Wialon.`
            );

            value = 100;
        }

        console.log(
            `⛽ ${unit.nm} FUEL_PCT (raw fallback):`,
            `${raw.paramName}=${raw.value}`,
            `=> ${value}%`
        );

        return {
            value,
            source: `raw_param_fallback:(${raw.paramName}/250)*100`
        };
    }

    result.value = 0;

    return result;
}


// =====================================================
// FIND FUEL DETECTION
// =====================================================

function findFuelDetection(unit, lastMessage) {

    const result = findNumericSensor(
        unit,
        lastMessage,
        ['fuel detection'],
        'FUEL_DETECTION'
    );

    if (result.value !== null) {
        result.value = Math.round(result.value * 100) / 100;
    } else {
        result.value = 0;
    }

    return result;
}


// =====================================================
// FIND TANK CAPACITY
// =====================================================

function findTankCapacity(unit, lastMessage) {

    const result = findNumericSensor(
        unit,
        lastMessage,
        ['tank capacity'],
        'TANK_CAPACITY'
    );

    if (result.value === null) {
        result.value = 0;
    }

    return result;
}


// =====================================================
// CURRENT UNIT MESSAGE TIME
// =====================================================

function getUnitLastMessageTime(unit) {

    return (
        toNumber(unit?.lmsg?.t) ||
        toNumber(unit?.last_message?.t) ||
        0
    );
}


// =====================================================
// POSITION
// =====================================================

function getPosition(unit, lastMessage) {

    if (unit?.pos && unit.pos.y != null && unit.pos.x != null) {
        return unit.pos;
    }

    if (lastMessage?.pos && lastMessage.pos.y != null && lastMessage.pos.x != null) {
        return lastMessage.pos;
    }

    if (unit?.lmsg?.pos && unit.lmsg.pos.y != null && unit.lmsg.pos.x != null) {
        return unit.lmsg.pos;
    }

    return null;
}


// =====================================================
// PROCESS UNIT
// =====================================================

function processUnit(unit, lastMessage = null, hwTypeNames = {}) {

    const now = Math.floor(Date.now() / 1000);

    const lastMessageTime = getUnitLastMessageTime(unit);

    const diffHours = lastMessageTime
        ? (now - lastMessageTime) / 3600
        : 99999;

    const isOffline6h = diffHours > 6;

    const batteryResult = findMainBattery(unit, lastMessage);
    const deviceBatteryResult = findInternalBattery(unit, lastMessage);
    const mileageResult = findMileageSensor(unit, lastMessage);
    const totalFuelResult = findTotalFuel(unit, lastMessage);
    const fuelPercentageResult = findFuelPercentage(unit, lastMessage);
    const fuelDetectionResult = findFuelDetection(unit, lastMessage);
    const tankCapacityResult = findTankCapacity(unit, lastMessage);

    const rawHwType =
        unit.hw != null ? unit.hw :
        unit?.prp?.dev_hw != null ? unit.prp.dev_hw :
        unit?.prp?.hw != null ? unit.prp.hw :
        null;

    const resolvedDeviceType =
        (rawHwType != null && hwTypeNames[String(rawHwType)]) ||
        (rawHwType != null ? `Unknown HW (${rawHwType})` : 'Unknown');

    if (String(resolvedDeviceType).startsWith('Unknown')) {

        console.warn(
            `⚠️ [${unit.nm}] device type not resolved from Wialon hw types. ` +
            `raw hw id: ${rawHwType}. ` +
            `Check core/get_hw_types on the Wialon side for this id.`
        );
    }

    const serialNumber =
        (unit.uid !== undefined && unit.uid !== null && String(unit.uid).trim() !== '')
            ? String(unit.uid).trim()
            : (
                unit.uid2 !== undefined && unit.uid2 !== null && String(unit.uid2).trim() !== ''
                    ? String(unit.uid2).trim()
                    : 'N/A'
            );

    const mobileNumber =
        (unit.ph !== undefined && unit.ph !== null && String(unit.ph).trim() !== '')
            ? String(unit.ph).trim()
            : (
                unit.ph2 !== undefined && unit.ph2 !== null && String(unit.ph2).trim() !== ''
                    ? String(unit.ph2).trim()
                    : 'N/A'
            );

    console.log('🔢 SERIAL / MOBILE:', serialNumber, '/', mobileNumber);

    if (String(unit?.nm || '').toLowerCase().includes('xtcan')) {

        console.log(
            '🐛 XTCAN DEBUG unit.uid/uid2/ph/ph2/hw:',
            unit.uid,
            unit.uid2,
            unit.ph,
            unit.ph2,
            unit.hw
        );

        console.log('🐛 XTCAN DEBUG resolved device type:', resolvedDeviceType);

        console.log('🐛 XTCAN DEBUG full raw unit:', JSON.stringify(unit));
    }

    const battery = batteryResult.value;
    const deviceBattery = deviceBatteryResult.value;

    const position = getPosition(unit, lastMessage);

    let location = 'Unknown';

    if (position && position.y != null && position.x != null) {
        location =
            `${Number(position.y).toFixed(4)}, ` +
            `${Number(position.x).toFixed(4)}`;
    }

    let hasMileage = false;
    let hasFuel = false;

    const sensors = unit?.sens || {};

    for (const id of Object.keys(sensors)) {

        const sensor = sensors[id] || {};

        const name = String(sensor.n || '').toLowerCase();

        if (name.includes('mileage') || name.includes('can_mileage')) {
            hasMileage = true;
        }

        if (name.includes('fuel') || name.includes('can_fls')) {
            hasFuel = true;
        }
    }

    let batteryStatus = 'ok';

    if (!lastMessageTime) {
        batteryStatus = 'no_data';
    } else if (battery === 0) {
        batteryStatus = 'zero';
    }

    console.log('');
    console.log('========================================');
    console.log('WIALON UNIT');
    console.log('========================================');

    if (!global.__stcanDebugDumped) {

        global.__stcanDebugDumped = true;

        console.log('🔧 FULL RAW UNIT (one-time dump):', JSON.stringify(unit));
        console.log('🔧 unit.prp:', JSON.stringify(unit?.prp || {}));
        console.log('🔧 unit.hw / hwId:', unit?.hw, unit?.hwId);
    }

    console.log(
        '🔎 SENSOR NAMES:',
        Object.values(unit?.sens || {}).map(s => s.n)
    );

    console.log('UNIT:', unit.nm);
    console.log('ID:', unit.id);
    console.log('WIALON LMSG TIME:', unit?.lmsg?.t);

    console.log(
        'LAST MESSAGE DATE:',
        lastMessageTime ? formatTime(lastMessageTime) : 'NO DATA'
    );

    console.log(
        'OFFLINE HOURS:',
        diffHours === 99999 ? 'N/A' : diffHours.toFixed(2)
    );

    console.log('STATUS:', isOffline6h ? 'OFFLINE' : 'ONLINE');
    console.log('BATTERY:', battery, 'V');
    console.log('BATTERY SOURCE:', batteryResult.source);
    console.log('DEVICE BATTERY:', deviceBattery, 'V');
    console.log('DEVICE BATTERY SOURCE:', deviceBatteryResult.source);
    console.log('MILEAGE:', mileageResult.value, '| SOURCE:', mileageResult.source);
    console.log('TOTAL FUEL:', totalFuelResult.value, '| SOURCE:', totalFuelResult.source);
    console.log('FUEL PERCENTAGE:', fuelPercentageResult.value, '| SOURCE:', fuelPercentageResult.source);
    console.log('FUEL DETECTION:', fuelDetectionResult.value, '| SOURCE:', fuelDetectionResult.source);
    console.log('TANK CAPACITY:', tankCapacityResult.value, '| SOURCE:', tankCapacityResult.source);
    console.log('SERIAL NUMBER:', serialNumber);
    console.log('MOBILE NUMBER:', mobileNumber);
    console.log('DEVICE TYPE (from Wialon):', resolvedDeviceType);
    console.log('========================================');

    return {

        id: unit.id,

        name: unit.nm || 'Unnamed Unit',

        deviceType: resolvedDeviceType,

        serialNumber,

        mobileNumber,

        accountGroup:
            unit.prp?.account ||
            unit.creator ||
            'Main Account',

        status:
            lastMessageTime && !isOffline6h
                ? 'Online'
                : 'Offline',

        lastMessageTime:
            lastMessageTime
                ? formatTime(lastMessageTime)
                : 'No Data',

        location,

        offlineDays:
            diffHours !== 99999
                ? Math.floor(diffHours / 24)
                : 'N/A',

        batteryVolts: Number(battery.toFixed(2)),

        deviceBatteryVolts: Number(deviceBattery.toFixed(2)),

        batteryStatus,

        batterySource: batteryResult.source,

        deviceBatterySource: deviceBatteryResult.source,

        mileageSensor: mileageResult.value,

        mileageSource: mileageResult.source,

        totalFuel: totalFuelResult.value,

        totalFuelSource: totalFuelResult.source,

        fuelPercentage: fuelPercentageResult.value,

        fuelPercentageSource: fuelPercentageResult.source,

        fuelDetection: fuelDetectionResult.value,

        fuelDetectionSource: fuelDetectionResult.source,

        tankCapacity: tankCapacityResult.value,

        tankCapacitySource: tankCapacityResult.source,

        isOffline: isOffline6h,

        hasMileage,

        hasFuel
    };
}


// =====================================================
// BUILD UNITS FROM SID
// =====================================================
// Per-unit work runs through mapLimit() with bounded
// concurrency instead of one at a time.
// =====================================================

async function buildUnitsFromSid(sid) {

    if (!sid) {
        throw new Error('WIALON_SESSION_MISSING');
    }

    const rawUnits = await fetchUnitsData(sid);

    const hwTypeNames = await fetchHwTypeNames(sid);

    const worker = async (unit) => {

        // ---- FETCH SERIAL / MOBILE / HW if ANY of them is missing ----

        if (
            (!unit.uid && !unit.uid2) ||
            (!unit.ph && !unit.ph2) ||
            unit.hw == null
        ) {

            const advanced = await fetchUnitAdvancedProps(sid, unit.id);

            if (advanced) {

                if (advanced.uid !== undefined && advanced.uid !== null && advanced.uid !== '') {
                    unit.uid = advanced.uid;
                }

                if (advanced.uid2 !== undefined && advanced.uid2 !== null && advanced.uid2 !== '') {
                    unit.uid2 = advanced.uid2;
                }

                if (advanced.ph !== undefined && advanced.ph !== null && advanced.ph !== '') {
                    unit.ph = advanced.ph;
                }

                if (advanced.ph2 !== undefined && advanced.ph2 !== null && advanced.ph2 !== '') {
                    unit.ph2 = advanced.ph2;
                }

                if (advanced.hw !== undefined && advanced.hw !== null) {
                    unit.hw = advanced.hw;
                }
            }
        }

        // ---- LAST MESSAGE ----

        let lastMessage = null;

        try {
            lastMessage = await fetchLastMessage(sid, unit.id);
        } catch (error) {
            console.error(`Message error for ${unit.nm}:`, error.message);
        }

        // ---- PROCESS ----

        return processUnit(unit, lastMessage, hwTypeNames);
    };

    const units = await mapLimit(rawUnits, WIALON_CONCURRENCY, worker);

    // Drop entries that failed inside the worker
    // (mapLimit returns { error, __failed: true } for those).

    const cleanUnits = [];

    for (let i = 0; i < units.length; i++) {

        const result = units[i];

        if (result && result.__failed) {

            console.error(
                `⚠️ buildUnitsFromSid: unit #${i} (${rawUnits[i]?.nm || rawUnits[i]?.id}) failed: ${result.error}`
            );

            continue;
        }

        cleanUnits.push(result);
    }

    return cleanUnits;
}


// =====================================================
// ENRICH MISSING SERIAL/MOBILE/DEVICE TYPE
// =====================================================

async function enrichMissingAdvancedProps(units) {

    const needsEnrichment = units.some(
        u =>
            u.serialNumber === 'N/A' ||
            u.mobileNumber === 'N/A' ||
            String(u.deviceType || '').startsWith('Unknown')
    );

    if (!needsEnrichment) {
        return units;
    }

    let adminSid = null;

    try {

        adminSid = await wialonLogin();

        const adminUnits = await fetchUnitsData(adminSid);

        const hwTypeNames = await fetchHwTypeNames(adminSid);

        const byId = new Map(adminUnits.map(u => [String(u.id), u]));

        for (const unit of units) {

            const needsUid = unit.serialNumber === 'N/A';
            const needsPhone = unit.mobileNumber === 'N/A';
            const needsDeviceType = String(unit.deviceType || '').startsWith('Unknown');

            if (!needsUid && !needsPhone && !needsDeviceType) {
                continue;
            }

            const adminUnit = byId.get(String(unit.id));

            if (adminUnit) {

                if (needsUid && (adminUnit.uid || adminUnit.uid2)) {
                    unit.serialNumber = adminUnit.uid || adminUnit.uid2;
                }

                if (needsPhone && (adminUnit.ph || adminUnit.ph2)) {
                    unit.mobileNumber = adminUnit.ph || adminUnit.ph2;
                }

                if (needsDeviceType && adminUnit.hw != null) {

                    const resolvedFromAdmin = hwTypeNames[String(adminUnit.hw)];

                    if (resolvedFromAdmin) {

                        unit.deviceType = resolvedFromAdmin;

                    } else {

                        unit.deviceType = `Unknown HW (${adminUnit.hw})`;

                        console.warn(
                            `⚠️ [${unit.name}] hw id ${adminUnit.hw} not found in core/get_hw_types even under the master token.`
                        );
                    }
                }

                if (unit.serialNumber === 'N/A' || unit.mobileNumber === 'N/A') {

                    console.warn(
                        `⚠️ [${unit.name}] visible to master account but uid/ph fields are empty in Wialon itself (not an access-rights issue — check the unit's Connectivity settings in Wialon).`
                    );
                }

                continue;
            }

            console.warn(
                `🚫 [${unit.name}] (id ${unit.id}) is NOT visible to the master/admin Wialon account at all. ` +
                `Serial/Mobile can only come from the logged-in user's own token. ` +
                `Fix: in Wialon, open this unit (or the acting user) → Access tab → ` +
                `grant the "View connectivity settings" special access right.`
            );
        }

    } catch (error) {

        console.error(
            '⚠️ Could not backfill serial/mobile from master token:',
            error.message
        );

    } finally {

        if (adminSid) {
            await wialonLogout(adminSid);
        }
    }

    return units;
}


// =====================================================
// GET UNITS FOR USER
// =====================================================

async function getUnitsForUser(sessionUser) {

    if (sessionUser && sessionUser.wialonSid) {

        try {

            const units = await buildUnitsFromSid(sessionUser.wialonSid);

            return await enrichMissingAdvancedProps(units);

        } catch (error) {

            const message = String((error && error.message) || '');

            // FIX: tighter session-expiry detection
            if (/invalid session|not logged|"error":1[,}]/i.test(message)) {

                const sessionError = new Error('WIALON_SESSION_EXPIRED');

                sessionError.code = 'WIALON_SESSION_EXPIRED';

                throw sessionError;
            }

            throw error;
        }
    }

    let sid = null;

    try {

        sid = await wialonLogin();

        const units = await buildUnitsFromSid(sid);

        let filteredUnits = units;

        if (sessionUser && sessionUser.role !== 'admin') {

            const assignedNames = sessionUser.assignedUnitNames || [];

            if (assignedNames.length > 0) {

                const allowedNames = new Set(
                    assignedNames.map(name => String(name).trim().toLowerCase())
                );

                filteredUnits = units.filter(unit =>
                    allowedNames.has(String(unit.name).trim().toLowerCase())
                );

            } else {

                const allowed = new Set(sessionUser.wialonAccounts || []);

                filteredUnits = units.filter(unit =>
                    allowed.has(unit.accountGroup)
                );
            }
        }

        return filteredUnits;

    } finally {

        if (sid) {
            await wialonLogout(sid);
        }
    }
}


// =====================================================
// KNOWN DEVICE TYPE KEYWORDS
// =====================================================

const KNOWN_DEVICE_TYPE_KEYWORDS = [
    'stcan',
    'iotm',
    'dascam',
    'dashcam',
    'dash cam',
    'vw-',
    'gs10g',
    'wanway',
    'xirgo'
];


// =====================================================
// IS STCAN/IOTM/DASHCAM/SENSOR-BEARING UNIT
// =====================================================

function isStcanUnit(unit) {

    const deviceType = String(unit?.deviceType || '').toLowerCase();

    const unitName = String(unit?.name || '').toLowerCase();

    if (
        KNOWN_DEVICE_TYPE_KEYWORDS.some(
            keyword =>
                deviceType.includes(keyword) ||
                unitName.includes(keyword)
        )
    ) {
        return true;
    }

    const hasAnySensorData = Boolean(
        (unit?.mileageSource && !unit.mileageSource.endsWith('_not_found')) ||
        (unit?.totalFuelSource && !unit.totalFuelSource.endsWith('_not_found')) ||
        (unit?.fuelPercentageSource && !unit.fuelPercentageSource.endsWith('_not_found')) ||
        (unit?.tankCapacitySource && !unit.tankCapacitySource.endsWith('_not_found'))
    );

    if (hasAnySensorData) {
        return true;
    }

    if (deviceType.includes('fms500')) {
        return true;
    }

    return false;
}


// =====================================================
// GET STCAN/IOTM/DASCAM UNITS
// =====================================================

async function getStcanUnitsForUser(sessionUser) {

    const units = await getUnitsForUser(sessionUser);

    return units.filter(isStcanUnit);
}


// =====================================================
// FETCH UNIT NAMES FOR CUSTOMER TOKEN
// =====================================================

async function fetchUnitNamesForToken(customerToken) {

    let sid = null;

    try {

        sid = await wialonLogin(customerToken);

        const rawUnits = await fetchUnitsData(sid);

        return rawUnits.map(u => u.nm).filter(Boolean);

    } finally {

        if (sid) {
            await wialonLogout(sid);
        }
    }
}


// =====================================================
// DUMP ALL UNITS: DEVICE TYPE + FULL SENSOR LIST
// =====================================================

async function dumpAllUnitsSensorsAndTypes() {

    let sid = null;

    try {

        console.log('🔑 Logging in to Wialon...');

        sid = await wialonLogin();

        console.log('📦 Fetching all units...');

        const units = await fetchUnitsData(sid);

        console.log(`📦 Got ${units.length} unit(s).`);

        console.log('🏷️  Fetching hardware type names (core/get_hw_types)...');

        const hwTypeNames = await fetchHwTypeNames(sid);

        const report = [];

        for (const unit of units) {

            const hwId =
                unit.hw !== undefined && unit.hw !== null
                    ? unit.hw
                    : null;

            const deviceTypeName =
                hwId !== null
                    ? (hwTypeNames[String(hwId)] || `Unknown HW (${hwId})`)
                    : 'Unknown (no hw id returned)';

            const sensors = unit.sens || {};

            const sensorList = Object.values(sensors).map(s => ({
                name: s?.n || '',
                parameter: s?.p || '',
                sensorType: s?.t ?? null,
                raw: s || {}
            }));

            const entry = {
                unitId: unit.id,
                unitName: unit.nm,
                deviceType: deviceTypeName,
                hwId,
                serialNumber: unit.uid || unit.uid2 || 'N/A',
                phone: unit.ph || unit.ph2 || 'N/A',
                sensorCount: sensorList.length,
                sensors: sensorList
            };

            report.push(entry);

            console.log('');
            console.log('==============================================');
            console.log('Unit:', entry.unitName, '| ID:', entry.unitId);
            console.log('Device Type:', entry.deviceType, '(hw id:', entry.hwId, ')');
            console.log('Serial:', entry.serialNumber, '| Phone:', entry.phone);
            console.log(`Sensors (${entry.sensorCount}):`);

            if (sensorList.length === 0) {

                console.log('  (no sensors configured on this unit)');

            } else {

                sensorList.forEach(s => {

                    console.log(
                        `  - "${s.name}"  =>  parameter: "${s.parameter}"` +
                        (s.sensorType !== null ? `  (sensorType: ${s.sensorType})` : '')
                    );

                    const isFuelRelated = /fuel/i.test(s.name || '');

                    console.log(
                        (isFuelRelated
                            ? '    🔍 FULL RAW (FUEL SENSOR): '
                            : '    🔍 FULL RAW: ') +
                        JSON.stringify(s.raw)
                    );
                });
            }
        }

        const deviceTypeCounts = {};
        const sensorNameCounts = {};

        for (const entry of report) {

            deviceTypeCounts[entry.deviceType] =
                (deviceTypeCounts[entry.deviceType] || 0) + 1;

            for (const s of entry.sensors) {

                const key = String(s.name || '').trim();

                if (!key) continue;

                sensorNameCounts[key] = (sensorNameCounts[key] || 0) + 1;
            }
        }

        console.log('');
        console.log('');
        console.log('================ SUMMARY ================');

        console.log('\nDevice types found across the account:');

        Object.entries(deviceTypeCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([type, count]) => {
                console.log(`  ${type}: ${count} unit(s)`);
            });

        console.log('\nUnique sensor names found across the account:');

        Object.entries(sensorNameCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([name, count]) => {
                console.log(`  "${name}": appears on ${count} unit(s)`);
            });

        try {

            const fs = require('fs');

            const outPath = 'wialon-units-report.json';

            fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

            console.log(`\n✅ Full report saved to ${outPath}`);

        } catch (error) {

            console.warn(
                '⚠️ Could not write wialon-units-report.json ' +
                '(this is fine if running in a read-only ' +
                'environment like a serverless route):',
                error.message
            );
        }

        return report;

    } finally {

        if (sid) {
            await wialonLogout(sid);
        }
    }
}


// =====================================================
// CHECK UNITS VISIBILITY (diagnostic)
// =====================================================

async function checkUnitsVisibility(unitsToCheck) {

    if (!Array.isArray(unitsToCheck) || unitsToCheck.length === 0) {

        throw new Error(
            'checkUnitsVisibility: pass an array of ' +
            '{ name, uid } objects (at least one of the ' +
            'two per entry).'
        );
    }

    let sid = null;

    const results = [];

    try {

        console.log('\n========================================');
        console.log('🔎 CHECKING UNIT VISIBILITY (master token)');
        console.log('========================================');

        sid = await wialonLogin();

        const rawUnits = await fetchUnitsData(sid);

        console.log(`📦 Master token sees ${rawUnits.length} unit(s) total.`);

        const byUid = new Map();
        const byName = new Map();

        for (const unit of rawUnits) {

            const uid = unit.uid || unit.uid2;

            if (uid) {
                byUid.set(String(uid).trim(), unit);
            }

            if (unit.nm) {
                byName.set(String(unit.nm).trim().toLowerCase(), unit);
            }
        }

        for (const target of unitsToCheck) {

            const targetUid = target.uid ? String(target.uid).trim() : null;

            const targetName = target.name
                ? String(target.name).trim().toLowerCase()
                : null;

            const foundByUid = targetUid ? byUid.get(targetUid) : null;

            const foundByName = targetName ? byName.get(targetName) : null;

            const found = foundByUid || foundByName || null;

            const entry = {
                queried: target,
                visible: Boolean(found),
                matchedBy: foundByUid ? 'uid' : (foundByName ? 'name' : null),
                wialonId: found?.id ?? null,
                wialonName: found?.nm ?? null
            };

            results.push(entry);

            if (entry.visible) {

                console.log(
                    `✅ VISIBLE  | ` +
                    `queried: ${target.name || target.uid} | ` +
                    `matched by ${entry.matchedBy} | ` +
                    `Wialon id: ${entry.wialonId} | ` +
                    `Wialon name: ${entry.wialonName}`
                );

            } else {

                console.log(
                    `🚫 NOT VISIBLE | ` +
                    `queried: ${target.name || target.uid} | ` +
                    `not found by uid or name in the master ` +
                    `token's unit list -> real ACL/access-rights ` +
                    `problem for this unit/resource in Wialon.`
                );
            }
        }

        console.log('\n========================================');

        console.log(
            `SUMMARY: ${results.filter(r => r.visible).length} visible, ` +
            `${results.filter(r => !r.visible).length} not visible ` +
            `(out of ${results.length} checked)`
        );

        console.log('========================================\n');

        return results;

    } finally {

        if (sid) {
            await wialonLogout(sid);
        }
    }
}


// =====================================================
// EXPORTS
// =====================================================

module.exports = {

    wialonRequest,

    wialonLogin,

    wialonDirectLogin,

    wialonTokenLoginFull,

    fetchUnitsData,

    fetchUnitAdvancedProps,

    fetchHwTypeNames,

    wialonLogout,

    processUnit,

    getUnitsForUser,

    getStcanUnitsForUser,

    fetchUnitNamesForToken,

    debugSingleUnitMaxFlags,

    dumpAllUnitsSensorsAndTypes,

    checkUnitsVisibility,

    formatTime,

    REPORT_TZ
};