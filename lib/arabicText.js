// =====================================================
// DEPRECATED — not used by lib/reportPdf.js anymore.
//
// This originally wrapped arabic-reshaper + bidi-js to manually
// shape/reorder Arabic text before drawing it with pdfkit. It
// turned out pdfkit (via fontkit) already does correct Arabic
// letter-joining AND right-to-left reordering on its own, as long
// as the font has proper OpenType 'arab' GSUB tables (see
// lib/fonts/NotoNaskhArabic-*.ttf). Running text through this
// shaper first and THEN through pdfkit's own shaping caused it to
// be shaped twice, which is what produced garbled/disconnected
// Arabic in exported PDFs (Wialon trip reports + SMS reports).
//
// Kept here only for reference. Do not reintroduce a call to
// shapeArabic() in the PDF drawing path — pass raw strings instead.
// =====================================================

const ArabicReshaperModule = require('arabic-reshaper');
const ArabicReshaper = ArabicReshaperModule.default || ArabicReshaperModule;

const bidiFactoryModule = require('bidi-js');
const bidiFactory = bidiFactoryModule.default || bidiFactoryModule;
const bidi = bidiFactory();

function shapeArabic(text) {
    if (!text) return '';
    const str = String(text);

    try {
        const reshaped = ArabicReshaper.convertArabic(str);
        const embeddingLevels = bidi.getEmbeddingLevels(reshaped);
        return bidi.getReorderedString(reshaped, embeddingLevels);
    } catch (err) {
        // If shaping fails for any reason, fall back to the raw
        // string rather than crashing the whole report export.
        console.error('⚠️ Arabic shaping failed:', err.message);
        return str;
    }
}

module.exports = { shapeArabic };
