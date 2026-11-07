require('dotenv').config();

const crypto = require('crypto');
const fetch = require('node-fetch');
const xml2js = require('xml2js');

// =====================================================
// ENHANCEMENT 3 — fetch with timeout
// =====================================================
const VODAFONE_SMS_TIMEOUT_MS = Number(
    process.env.VODAFONE_SMS_TIMEOUT_MS || 15000
);

async function fetchWithTimeout(url, options = {}, timeoutMs = VODAFONE_SMS_TIMEOUT_MS) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(
                `Vodafone SMS request timeout after ${timeoutMs}ms: ${url}`
            );
        }
        throw error;
    } finally {
        clearTimeout(t);
    }
}

// =====================================================
// CONFIG
// =====================================================
const BASE_URL =
    process.env.VODAFONE_SMS_BASE_URL ||
    'https://e3len.vodafone.com.eg';

const NOTIFICATION_URL =
    process.env.VODAFONE_SMS_URL ||
    `${BASE_URL}/web2sms/sms/submit/Notification`;

const CAMPAIGN_URL =
    process.env.VODAFONE_SMS_CAMPAIGN_URL ||
    `${BASE_URL}/web2sms/sms/submit`;

const ACCOUNT_ID = process.env.VODAFONE_ACCOUNT_ID;
const PASSWORD = process.env.VODAFONE_PASSWORD;
const SENDER = process.env.VODAFONE_SENDER || 'OBSERVER';
const SECRET_KEY = process.env.VODAFONE_SECRET_KEY;

const ERROR_CODES = {
    '9001': 'SMS List exceeds the limit of MaxSms.',
    '9002': 'One of the mandatory fields is empty.',
    '9003': 'All given receivers have international MSISDN; local mode is enabled.',
    '9004': 'Please ensure the values of the dates.',
    '9005': 'Please ensure there are no null or empty fields.',
    '9006': 'Missing mandatory fields: accountId or password or secureHash.',
    '9007': 'Missing mandatory fields: startDate.',
    '9008': 'Missing mandatory fields: endDate.',
    '9009': 'There is no valid SMS Details.',
    '9010': 'Cannot request more than one report within the allowed time interval.',
    '9011': 'Account not found.',
    '9012': 'Account is not registered on SMS-API.',
    '9013': 'The given IP is not listed on the trusted IP list for the given account.',
    '9014': 'Please enter the correct password.',
    '9015': 'This is not a valid request.',
    '9016': 'SMS ID is empty.',
    '9017': 'Empty Required fields.',
    '9018': 'Date ranges are not supported.',
    '9019': 'Dates are not ordered.',
    '9020': 'Dates are in invalid formats.',
    '9021': 'Authorization failed, incorrect Secure Hash.',
    '9022': 'Empty receiver MSISDN.',
    '9023': 'Invalid MSISDN.',
    '9024': 'Unable to inquire about the SMSs by SMS IDs.',
    '9025': 'An error occurred while retrieving user action logs.',
    '9028': 'Unable to fetch loggable actions.',
    '9032': 'Account not eligible to send SMSAPI.',
    '9033': 'SMS-API Interface not accessible.',
    '9034': 'Sender name is not defined for this account.',
    '9035': 'Invalid Action name format.',
    '9036': 'No user action log found.',
    '9037': 'Start index exceeds total results.',
    '9038': 'Account Quota not found Exception.',
    '9039': 'Unable to fetch user action logs.'
};

function describeErrorCode(code) {
    return ERROR_CODES[String(code)] || `Unknown Vodafone error code: ${code}`;
}

// =====================================================
// CHECK CONFIG
// =====================================================

function checkConfig() {
    const missing = [];
    if (!ACCOUNT_ID) missing.push('VODAFONE_ACCOUNT_ID');
    if (!PASSWORD) missing.push('VODAFONE_PASSWORD');
    if (!SECRET_KEY) missing.push('VODAFONE_SECRET_KEY');
    if (!SENDER) missing.push('VODAFONE_SENDER');

    if (missing.length > 0) {
        throw new Error('Missing Vodafone environment variables: ' + missing.join(', '));
    }
}

// =====================================================
// MSISDN NORMALIZATION (Appendix A of the spec)
// =====================================================

function normalizeMsisdn(raw) {
    if (!raw) return raw;

    let n = String(raw).trim().replace(/[\s\-()]/g, '');

    if (n.startsWith('+')) n = n.slice(1);
    if (n.startsWith('0020')) n = n.slice(2);
    if (n.startsWith('00') && !n.startsWith('0020')) n = n.slice(2);

    if (/^0(10|11|12|15)\d{8}$/.test(n)) {
        n = '20' + n.slice(1);
    }

    if (/^(10|11|12|15)\d{8}$/.test(n)) {
        n = '20' + n;
    }

    return n;
}

// =====================================================
// SECURE HASH  (spec Section 5)
// =====================================================

function buildConcatenatedString(smsList, externalTrxId) {
    const parts = [
        `AccountId=${ACCOUNT_ID}`,
        `Password=${PASSWORD}`
    ];

    for (const sms of smsList) {
        parts.push(`SenderName=${sms.senderName}`);
        parts.push(`ReceiverMSISDN=${sms.receiverMSISDN}`);
        parts.push(`SMSText=${sms.smsText}`);
    }

    if (externalTrxId) {
        parts.push(`ExternalTrxId=${externalTrxId}`);
    }

    return parts.join('&');
}

function generateSecureHash(smsList, externalTrxId) {
    const data = buildConcatenatedString(smsList, externalTrxId);

    // The spec prose says hex-decode the key, but its own worked example
    // only matches with the key as a plain UTF-8 string. We follow the
    // example. If you get 9021, set VODAFONE_HEX_DECODE_KEY=true in .env.
    const key = process.env.VODAFONE_HEX_DECODE_KEY === 'true'
        ? Buffer.from(SECRET_KEY, 'hex')
        : SECRET_KEY;

    return crypto
        .createHmac('sha256', key)
        .update(data, 'utf8')
        .digest('hex')
        .toUpperCase();
}

// =====================================================
// XML BUILDING
// =====================================================

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function buildRequestXml(smsList, secureHash, externalTrxId) {
    const smsListXml = smsList.map(sms => `<SMSList>
  <SenderName>${xmlEscape(sms.senderName)}</SenderName>
  <ReceiverMSISDN>${xmlEscape(sms.receiverMSISDN)}</ReceiverMSISDN>
  <SMSText>${xmlEscape(sms.smsText)}</SMSText>
</SMSList>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<SubmitSMSRequest xmlns="http://www.edafa.com/web2sms/sms/model/">
<AccountId>${xmlEscape(ACCOUNT_ID)}</AccountId>
<Password>${xmlEscape(PASSWORD)}</Password>
<SecureHash>${xmlEscape(secureHash)}</SecureHash>
${smsListXml}${externalTrxId ? `\n<ExternalTrxId>${xmlEscape(externalTrxId)}</ExternalTrxId>` : ''}
</SubmitSMSRequest>`;
}

// =====================================================
// SEND (core) — supports up to 1000 SMS per request (spec 4.2)
// =====================================================

async function sendSmsBatch(smsList, options = {}) {
    checkConfig();

    if (!Array.isArray(smsList) || smsList.length === 0) {
        throw new Error('smsList must be a non-empty array');
    }

    if (smsList.length > 1000) {
        throw new Error('SMS List exceeds the limit of MaxSms (1000 per request).');
    }

    const normalized = smsList.map(sms => {
        if (!sms.receiverMSISDN) throw new Error('Receiver phone number is required');
        if (!sms.smsText) throw new Error('SMS text is required');

        return {
            senderName: sms.senderName || SENDER,
            receiverMSISDN: normalizeMsisdn(sms.receiverMSISDN),
            smsText: sms.smsText
        };
    });

    const externalTrxId = options.externalTrxId || '';
    const type = options.type === 'campaign' ? 'campaign' : 'notification';
    const url = type === 'campaign' ? CAMPAIGN_URL : NOTIFICATION_URL;

    const secureHash = generateSecureHash(normalized, externalTrxId);
    const xml = buildRequestXml(normalized, secureHash, externalTrxId);

    console.log('');
    console.log('========================================');
    console.log(`📱 VODAFONE SMS [${type.toUpperCase()}]`);
    console.log('========================================');
    console.log('Receivers:', normalized.map(s => s.receiverMSISDN).join(', '));
    console.log('URL:', url);
    console.log('========================================');

    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml',
            'Accept': 'application/xml'
        },
        body: xml
    });

    const responseText = await response.text();

    console.log('Vodafone HTTP Status:', response.status);
    console.log('Vodafone Response:', responseText);

    if (!response.ok) {
        throw new Error(`Vodafone SMS HTTP ${response.status}: ${responseText}`);
    }

    let parsed = null;
    try {
        parsed = await xml2js.parseStringPromise(responseText, { explicitArray: false });
    } catch (e) {
        // Not fatal — return raw text if parsing fails
    }

    const body = parsed && parsed.SubmitSMSResponse ? parsed.SubmitSMSResponse : null;

    let smsStatuses = [];
    if (body && body.SMSStatus) {
        smsStatuses = Array.isArray(body.SMSStatus) ? body.SMSStatus : [body.SMSStatus];
    }

    const resultStatus = body ? body.ResultStatus : null;
    const errorCode = body ? body.Description : null;

    if (resultStatus && resultStatus !== 'SUCCESS') {
        const errorMessage = errorCode
            ? `${resultStatus} (${errorCode}): ${describeErrorCode(errorCode)}`
            : resultStatus;
        const err = new Error(`Vodafone SMS rejected: ${errorMessage}`);
        err.vodafoneCode = errorCode;
        err.vodafoneResultStatus = resultStatus;
        err.rawResponse = responseText;
        throw err;
    }

    return {
        success: true,
        status: response.status,
        resultStatus: resultStatus || 'SUCCESS',
        smsStatuses,
        receivers: normalized.map(s => s.receiverMSISDN),
        raw: responseText
    };
}

// =====================================================
// SEND SINGLE SMS
// =====================================================

async function sendSms(receiverMSISDN, smsText, options = {}) {
    return sendSmsBatch(
        [{ receiverMSISDN, smsText }],
        options
    );
}

// =====================================================
// EXPORT
// =====================================================

module.exports = {
    sendSms,
    sendSmsBatch,
    normalizeMsisdn,
    describeErrorCode,
    ERROR_CODES
};
