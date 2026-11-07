const nodemailer = require('nodemailer');

// =====================================================
// MAILER
// Gmail SMTP
// =====================================================

function isConfigured() {
    return Boolean(
        process.env.SMTP_HOST &&
        process.env.SMTP_PORT &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS
    );
}


// =====================================================
// CREATE TRANSPORTER
// =====================================================

function getTransporter() {

    if (!isConfigured()) {
        throw new Error(
            'SMTP is not configured. Check SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS in .env'
        );
    }

    const port = Number(process.env.SMTP_PORT);

    return nodemailer.createTransport({

        host: process.env.SMTP_HOST,

        port,

        secure: port === 465,

        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        },

        tls: {
            rejectUnauthorized: true
        }
    });
}


// =====================================================
// TEST SMTP CONNECTION
// =====================================================

async function verifySMTP() {

    const transporter = getTransporter();

    try {

        await transporter.verify();

        console.log('✅ SMTP connection successful');

        return true;

    } catch (error) {

        console.error(
            '❌ SMTP connection failed:',
            error.message
        );

        return false;
    }
}


// =====================================================
// SEND REPORT EMAIL
// =====================================================

async function sendReportEmail({
    to,
    subject,
    text,
    attachmentBuffer,
    attachmentName
}) {

    const transporter =
        getTransporter();

    const fromAddress =
        process.env.SMTP_FROM ||
        process.env.SMTP_USER;


    if (!to) {
        throw new Error(
            'Recipient email address is required'
        );
    }


    const mailOptions = {

        from:
            `"Observer Fleet" <${fromAddress}>`,

        to,

        subject:
            subject || 'Observer Fleet Report',

        text:
            text || 'Please find the attached report.',

        attachments:
            attachmentBuffer
                ? [
                    {
                        filename:
                            attachmentName ||
                            'report.xlsx',

                        content:
                            attachmentBuffer
                    }
                ]
                : []
    };


    try {

        const info =
            await transporter.sendMail(
                mailOptions
            );

        console.log(
            '✅ Email sent successfully:',
            info.messageId
        );

        return info;

    } catch (error) {

        console.error(
            '❌ Email sending failed:',
            error.message
        );

        if (
            error.code === 'EAUTH' ||
            error.responseCode === 535
        ) {

            throw new Error(
                'Gmail authentication failed. ' +
                'Use a Google App Password in SMTP_PASS, ' +
                'not your normal Gmail password.'
            );
        }

        // Common on shared hosting (e.g. Hostinger): outbound SMTP
        // ports (25/465/587) are blocked, or the provider's mail
        // server rejects unfamiliar sending IPs (SPF/greylisting).
        if (
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ESOCKET'
        ) {
            throw new Error(
                `Could not reach the SMTP server (${error.code}). This usually means ` +
                'the hosting provider is blocking outbound SMTP ports (25/465/587), or ' +
                'the mail provider is rejecting connections from this server\'s IP. ' +
                'Check with Hostinger whether SMTP ports are open on this plan, and/or ' +
                'ask them for the server\'s outbound IP (see GET /api/server-ip) to ' +
                'whitelist it with your SMTP provider.'
            );
        }

        throw error;
    }
}


// =====================================================
// EXPORTS
// =====================================================

module.exports = {

    isConfigured,

    verifySMTP,

    sendReportEmail

};
