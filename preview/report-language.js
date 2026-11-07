// EDIT BY NADA — shared report labels for the preview viewer and exported data.
(() => {
  const arabic = Object.freeze({
    'Fleet report · Demo': 'تقرير الأسطول · تجريبي',
    'Battery Report': 'تقرير البطارية', 'Zero-voltage readings only': 'القراءات الصفرية فقط',
    'Battery readings above 0 V and below 8000 V': 'قراءات البطارية أعلى من صفر وأقل من ٨٠٠٠ فولت',
    'Battery Down · 0 V or below 8000 V': 'انخفاض البطارية · صفر أو أقل من ٨٠٠٠ فولت',
    'Offline Units · More Than 12 Hours · Demo': 'الوحدات غير المتصلة · أكثر من ١٢ ساعة · تجريبي',
    'Sensor overview · Demo': 'نظرة عامة على الحساسات · تجريبي',
    'Sensor Report': 'تقرير الحساسات', 'Show all sensor values across all units': 'عرض جميع قيم الحساسات لكل الوحدات',
    'ID': 'رقم', 'Unit Name': 'اسم الوحدة', 'Device Type': 'نوع الجهاز',
    // EDIT BY NADA — use the requested device-number wording in Arabic report columns.
    'IMEI': 'رقم الجهاز', 'SIM Number': 'رقم الهاتف',
    // EDIT BY NADA — Sensor Report uses the same mobile-number label in Arabic and English.
    'Device IMEI': 'رقم الجهاز', 'Device SIM': 'رقم الهاتف',
    'Installation report': 'تقرير تركيب جديد', 'Maintenance report': 'تقرير الصيانة',
    'Unit number': 'رقم الصف', 'Wialon ID': 'معرّف Wialon', 'Account': 'الحساب',
    'Total': 'الإجمالي', 'Online': 'متصل', 'Offline': 'غير متصل',
    'Offline duration (hours)': 'مدة الانقطاع (ساعة)', 'Battery (V)': 'البطارية (فولت)',
    'Battery data': 'حالة بيانات البطارية', 'Internal Battery': 'البطارية الداخلية',
    'Total Fuel': 'إجمالي الوقود', 'Fuel %': 'نسبة الوقود',
    'Fuel Detection': 'رصد الوقود', 'Tank Capacity': 'سعة الخزان',
    'Serial Number': 'الرقم التسلسلي', 'Mobile Number': 'رقم الهاتف',
    'New IMEI': 'معرّف الجهاز الجديد IMEI', 'Old IMEI': 'معرّف الجهاز القديم IMEI',
    'Serial': 'الرقم التسلسلي', 'SIM': 'رقم الشريحة', 'Notes': 'ملاحظات',
    'ok': 'قراءة متاحة', 'zero': 'قراءة صفرية', 'no_data': 'لا توجد بيانات',
    'Detected': 'تم الرصد', 'Not detected': 'لم يُرصد', 'Yes': 'نعم', 'No': 'لا',
    'SMS': 'رسالة نصية', 'WhatsApp': 'واتساب', 'sms': 'رسالة نصية', 'whatsapp': 'واتساب',
    'auto': 'تلقائي', 'wialon': 'Wialon', 'pending': 'قيد الانتظار',
    'sent': 'تم الإرسال', 'delivered': 'تم التسليم', 'received': 'تم الاستلام',
    'Not supported': 'غير مدعوم',
    'Local demo attachment': 'مرفق التقرير', 'Local demo signature': 'التوقيع الإلكتروني',
    'Vehicle': 'الوحدة', 'From': 'من', 'To': 'إلى', 'Fuel (L)': 'الوقود (لتر)',
    'Distance (km)': 'المسافة (كم)', 'Trips': 'الرحلات', 'Fuel consumption': 'استهلاك الوقود',
    'Mileage': 'المسافة المقطوعة', 'No sample results': 'لا توجد نتائج تجريبية',
    'Wialon sample report · Demo': 'تقرير Wialon · تجريبي',
    'Messaging report · Demo': 'تقرير الرسائل · تجريبي',
    'Recipient': 'المستلم', 'Message': 'الرسالة', 'Channel': 'القناة',
    'Source': 'المصدر', 'Status': 'الحالة', 'Created': 'التاريخ',
    'submitted': 'تم التقديم', 'simulated': 'محاكاة محلية (لم تُرسل)', 'failed': 'فشل', 'manual': 'يدوي', 'alert': 'تنبيه تلقائي'
  });
  const text = (value, lang) => {
    if (lang !== 'ar' || typeof value !== 'string') return value;
    if (Object.hasOwn(arabic, value)) return arabic[value];
    if (/^\d+(?:\.\d+)? h$/.test(value)) return value.replace(/ h$/, ' ساعة');
    if (value.endsWith(' · Demo')) return `${arabic[value.slice(0, -7)] || value.slice(0, -7)} · تجريبي`;
    return value;
  };
  const results = (records, lang) => records.map(record => ({
    ...record,
    tables: (record.tables || []).map(table => ({ ...table, name: text(table.name, lang), headers: (table.headers || []).map(header => text(header, lang)) }))
  }));
  // Translate known labels and status values; preserve names, IDs, readings and authored notes.
  const report = (value, lang) => {
    const headers = value.rows[0] || [];
    const translatedColumns = new Set(['Status', 'Battery data', 'Fuel Detection', 'Source', 'Channel', 'Offline duration (hours)']);
    return { ...value, lang, title: text(value.title, lang), subtitle: text(value.subtitle, lang),
      rows: value.rows.map((row, index) => row.map((cell, column) => index === 0 || translatedColumns.has(headers[column]) ? text(cell, lang) : cell)),
      images: (value.images || []).map(image => ({ ...image, label: text(image.label, lang) })) };
  };
  globalThis.ObserverReportLanguage = Object.freeze({ text, results, report });
})();
