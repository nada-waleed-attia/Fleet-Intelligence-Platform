const axios = require('axios');
const { normalizeMsisdn } = require('./vodafoneSms');

// =====================================================
// WHATSAPP SENDER (Meta WhatsApp Cloud API)
// =====================================================
// New channel requested alongside Vodafone SMS: "محتاج تابه لما
// ابعت WhatsApp massages تطلع علي الواتس" — a tab that actually
// sends WhatsApp messages (not just SMS).
//
// This uses Meta's official WhatsApp Cloud API (the standard way
// to send WhatsApp business messages programmatically). It needs
// a WhatsApp Business account + phone number set up in Meta's
// Business Manager first — that part can't be done from here,
// it's account/business verification on Meta's side. Once you
// have it, put these in .env:
//
//   WHATSAPP_TOKEN            -> permanent access token
//   WHATSAPP_PHONE_NUMBER_ID  -> the sender's phone_number_id
//   WHATSAPP_API_VERSION      -> optional, defaults to v20.0
//
// IMPORTANT LIMITATION (Meta's rule, not ours): outside the
// 24-hour customer-service window, WhatsApp only allows sending
// pre-approved "template" messages (created & approved in Meta
// Business Manager), not free-form text. So sendWhatsAppMessage()
// below sends free text by default (works if the recipient
// messaged you in the last 24h, or during testing), and there's
// a sendWhatsAppTemplate() for approved templates for cold
// outbound (e.g. the offline-alert notifications), which is what
// you'll want for automatic system alerts once you register a
// template like "vehicle_offline_alert" in Meta Business Manager.
// =====================================================

function getConfig() {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v20.0';

    if (!token || !phoneNumberId) {
        const err = new Error(
            'WhatsApp is not configured yet. Add WHATSAPP_TOKEN and ' +
            'WHATSAPP_PHONE_NUMBER_ID to .env (from Meta Business Manager > ' +
            'WhatsApp > API Setup) before sending WhatsApp messages.'
        );
        err.code = 'WHATSAPP_NOT_CONFIGURED';
        throw err;
    }

    return {
        token,
        phoneNumberId,
        baseUrl: `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`
    };
}

// Meta wants the number WITHOUT a leading "+" (e.g. 201000000000).
// Reuse the same Egyptian-number normalizer already used for SMS.
function toWhatsappNumber(raw) {
    return normalizeMsisdn(raw);
}

async function sendWhatsAppMessage(rawNumber, text) {
    const { token, baseUrl } = getConfig();
    const to = toWhatsappNumber(rawNumber);

    try {
        const response = await axios.post(
            baseUrl,
            {
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body: text, preview_url: false }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        return {
            to,
            messageId: response.data?.messages?.[0]?.id || null,
            raw: response.data
        };

    } catch (error) {
        const apiError = error.response?.data?.error;
        const message = apiError
            ? `WhatsApp API error ${apiError.code || ''}: ${apiError.message || 'Unknown error'}`
            : error.message;
        const wrapped = new Error(message);
        wrapped.raw = error.response?.data;
        throw wrapped;
    }
}

// For pre-approved templates (needed for cold/automatic outbound
// outside the 24h window). `components` follows Meta's template
// parameter format — pass [] if the template has no variables.
async function sendWhatsAppTemplate(rawNumber, templateName, languageCode = 'ar', components = []) {
    const { token, baseUrl } = getConfig();
    const to = toWhatsappNumber(rawNumber);

    try {
        const response = await axios.post(
            baseUrl,
            {
                messaging_product: 'whatsapp',
                to,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: languageCode },
                    components
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        return {
            to,
            messageId: response.data?.messages?.[0]?.id || null,
            raw: response.data
        };

    } catch (error) {
        const apiError = error.response?.data?.error;
        const message = apiError
            ? `WhatsApp API error ${apiError.code || ''}: ${apiError.message || 'Unknown error'}`
            : error.message;
        const wrapped = new Error(message);
        wrapped.raw = error.response?.data;
        throw wrapped;
    }
}

function isWhatsAppConfigured() {
    return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

module.exports = {
    sendWhatsAppMessage,
    sendWhatsAppTemplate,
    isWhatsAppConfigured,
    toWhatsappNumber
};
