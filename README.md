# Observer Fleet Dashboard — Phase 1 + 2

## Phase 1: Login + Multi-Tenant Auth

- شاشة **Login** (`/login.html`) بلوجو Observer.
- كل الصفحات بعد تسجيل الدخول محمية (middleware `requireAuth`) — لو مش
  عامل login بترجعك تلقائي لـ `/login.html`.
- **MySQL** بتخزن المستخدمين (`models/User.js`): admin أو customer.
- كل customer ليه `wialonAccounts` (لستة بالـ accountGroup بتاعته في
  Wialon) — الداشبورد (`/api/dashboard`) بتفلتر الوحدات تلقائي بناءً
  عليها. الـ admin بيشوف كل حاجة.
- كارت جديد في الداشبورد: **Battery = 0V** (عدّاد + فلتر موجود بالفعل).
- زرار **Logout** ولوجو Observer في هيدر الداشبورد.

## Phase 2: Excel Export (Real Reports)

- `lib/wialon.js` — كل منطق الاتصال بـ Wialon بقى في مكان واحد
  (`getUnitsForUser` بترجع الوحدات جاهزة ومفلترة حسب المستخدم).
- `routes/reports.js` → `GET /api/reports/export?filter=all|battery0|offline`
  — بيطلّع ملف **Excel (.xlsx)** حقيقي (مش print/PDF)، بعمود الـ
  Battery مميز بالأحمر للقيم صفر.
- التقرير بيحترم صلاحيات المستخدم زي الداشبورد بالظبط (كل عميل يصدّر
  عرباته بس، الـ admin يصدّر الكل).
- زرارين جداد في الداشبورد: **Export Excel** (كل البيانات) و
  **Battery=0 Excel** (تقرير الـ Battery=0V المطلوب بالتحديد).

## التشغيل محليًا

```bash
cd observer-fleet
npm install
cp .env.example .env
# افتح .env وحط فيه: WIALON_TOKEN, DB_NAME / DB_USER / DB_PASS, SESSION_SECRET

# شغل MySQL محليًا (أو استخدم Atlas وحط الـ connection string في .env)

npm run seed     # بيعمل أول admin + عميل تجريبي
npm start
```

هيديك يطبع:
```
✅ Created admin user: admin / ChangeMe123!
✅ Created customer user: demo_customer / Customer123!
```

افتح `http://localhost:3000` → هيوديك لصفحة اللوجين.

⚠️ **مهم:** غيّر الباسورد بتاع الـ admin بعد أول دخول (لسه مفيش شاشة
"change password" — هنضيفها في مرحلة لاحقة لو عايز).

## إزاي تضيف عميل جديد

عدّل `seed.js` وضيف عنصر جديد في `usersToCreate`، أو اعمل script صغير
منفصل بنفس الفكرة:

```js
const user = new User({
    username: 'customer2',
    displayName: 'شركة كذا',
    role: 'customer',
    wialonAccounts: ['اسم الـ Account بتاعهم في Wialon بالظبط'],
    reportEmail: 'client@example.com'
});
await user.setPassword('كلمة السر');
await user.save();
```

القيمة في `wialonAccounts` **لازم تطابق بالظبط** القيمة اللي بترجع من
Wialon في `unit.prp.account` (أو `unit.creator` لو مفيش account مسجل).
لو مش متأكد إيه القيم الموجودة، شغل `/api/dashboard` بحساب admin وشوف
عمود Account في الجدول.

## Phase 3: Unit Detail Screen (Independent Per-Unit Report)

- `GET /api/units/:id` — بيانات وحدة واحدة، محمي وبيحترم صلاحيات العميل
  (لو العميل مش صاحب الوحدة دي بيرجع 404).
- `public/unit.html` — شاشة تفاصيل كاملة للوحدة: الحالة، آخر رسالة،
  أيام الأوفلاين، الموقع، البطارية (وبطارية الجهاز)، وجود حساس
  Mileage/Fuel. عليها لوجو Observer وزرار رجوع للداشبورد.
- كليك على أي صف في جدول الداشبورد بيوديك مباشرة لصفحة التفاصيل
  بتاعت الوحدة دي (`/unit.html?id=123`).
- `GET /api/reports/export-unit/:id` — **تقرير Excel مستقل لكل وحدة**
  لوحدها (زي ما طلبت: "تقرير مستقل لكل عميل").

## Phase 4: Login Redesign + User Management UI + Email Reports

- **Login page** اتعمل من جديد بستايل تقني غامق (glass card، لوجو Observer،
  حقل "Email") زي التصميم اللي بعتّه.
- **`/admin-users.html`** — صفحة إدارة يوزرز كاملة، متاحة للـ admin بس:
  - عمل عميل جديد (username, password, role, Wialon accounts, report email)
    من غير ما تلمس الكود أو تشغّل `seed.js` تاني.
  - تعديل إيميل التقارير لأي عميل من الجدول مباشرة.
  - **Send Report** — زرار يبعت تقرير Excel فورًا لإيميل العميل.
  - حذف يوزر.
  - زرار "Manage Users" ظاهر في هيدر الداشبورد للـ admin بس.
- **`lib/mailer.js`** — طبقة إرسال إيميل عبر SMTP (nodemailer). لو الـ
  `.env` مفيهوش SMTP_* هيرجع رسالة واضحة بدل ما يكرش السيرفر.
- **`POST /api/reports/send-email/:userId`** (admin only) — بيبني تقرير
  Excel مفلتر حسب صلاحيات العميل، ويبعته كمرفق على `reportEmail` بتاعه.
- شكل الـ Excel اتظبط عليه هيدر بألوان الـ letterhead (Observer + خطوط
  ملونة) في أعلى كل تقرير.

### تفعيل الإيميل (SMTP)

أضف في `.env`:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password   # App Password مش الباسورد العادي
SMTP_FROM=your_email@gmail.com
```
لو بتستخدم Gmail، لازم تعمل [App Password](https://myaccount.google.com/apppasswords)
مش الباسورد بتاع الحساب العادي (Google بترفض الاتصال المباشر).

## Phase 5: Fix — Per-Customer Scoping by Exact Unit Name

**المشكلة اللي كانت بتحصل:** كل عرباتك مسجلة تحت نفس الـ Wialon
"Account" (Main Account) — فلما كنا بنفلتر بالـ accountGroup، أي عميل
كان بيشوف كل العربيات لأن الكل بيطابق نفس القيمة.

**الحل:** أضفنا `assignedUnitNames` — تحديد دقيق بالاسم بالظبط
(زي `CR14`, `EX-033`) لكل عميل، بدل الاعتماد على الـ Account Group.

### إزاي تحدد عربيات كل عميل

من `/admin-users.html`:
1. لما تعمل عميل جديد، دوس على رابط **"Show all available unit names"**
   جنب حقل "Assigned Units" — هيديك كل أسماء العربيات الموجودة فعليًا
   في Wialon.
2. انسخ الأسماء اللي بتخص العميل ده وحطها في الحقل، مفصولة بفاصلة:
   `CR14, EX-033, GR03`
3. لعميل موجود بالفعل، فيه نفس الحقل قابل للتعديل جنب كل صف في
   جدول الـ Users — عدّل واضغط Save.

`wialonAccounts` (القديم) لسه شغال كـ fallback لو `assignedUnitNames`
فاضي — مفيد بس لو فعلاً عندك حسابات Wialon مختلفة لكل عميل.

⚠️ **لازم تشغّل `npm run seed` تاني** بعد التحديث ده (أو تعدّل يدوي من
الواجهة) عشان `demo_customer` ياخد `assignedUnitNames` الصح بدل
الاعتماد على الـ Account القديم.

## Phase 6: Summary Page → Then Units Table

بناءً على طلبك، الترتيب بقى:

**Login → `/index.html` (صفحة Summary بالكروت والإحصائيات) → لما يدوس على أي
كارت أو "View All Units" يدخل `/units.html` (الجدول التفصيلي بكل
الوحدات) → لما يدوس على وحدة يدخل `/unit.html` (تفاصيل الوحدة).**

- `/index.html` — صفحة ترحيب + 6 كروت إحصائية (Total, Online, Offline,
  Mileage, Fuel, Battery=0V). كل كارت قابل للضغط ويوديك لـ `/units.html`
  مع فلتر جاهز (مثلاً الضغط على "Offline" يفتح الجدول مفلتر أوفلاين
  على طول).
- `/units.html` — الجدول اللي كان قبل كده في `index.html` (فيه كل
  أزرار Export Excel / PDF والفلاتر)، مع زرار "← Summary" للرجوع.
- كل الصفحات لسه محمية بنفس صلاحيات كل عميل (customer يشوف بس عرباته
  المحددة له، admin يشوف الكل).

## Phase 7: Summary Charts + Smarter Battery Detection

### الجرافيكس
صفحة الـ Summary (`/index.html`) بقى فيها جرافين تحت الكروت:
- **Online vs Offline** (Doughnut chart)
- **Battery Status breakdown** (OK / Zero / No Data) — Bar chart

### حل مشكلة Battery = 0V (بدون الحاجة لـ debug-dump.js يدوي)

بدل ما نستنى نتيجة تشخيص يدوي، خلينا الكود نفسه يجرب كذا مصدر بيانات
بالترتيب لكل وحدة:

1. `unit.sens` (تعريفات الحساسات) — زي الأول
2. **لو مفيش نتيجة**، يدوّر في **آخر رسالة خام** (`unit.lmsg.p`) على
   المفاتيح الشائعة اللي بيستخدمها أغلب الأجهزة (Teltonika وغيرها):
   - `io_66` (Battery Voltage)
   - `pwr_int`
   - `battery_voltage`
   - `io_67` / `pwr_ext` (External Power - fallback أخير)
3. لو القيمة الرقم كبير (>100) بيعتبرها **mV** ويحوّلها لـ Volts
   تلقائيًا (÷1000).

كل وحدة دلوقتي بترجع معاها **`batterySource`** — يقولك بالظبط الرقم
جاي منين (`sens:adc12`, `lmsg:io_66`, `none`... إلخ). تقدر تشوفه في
صفحة تفاصيل الوحدة (`/unit.html?id=...`) تحت "Battery Data Source".

⚠️ **لسه محتاجين نتأكد 100%:** الـ fallback ده مبني على افتراضات
شائعة (io_66/io_67) مش على بيانات حقيقية من نظامك، لأننا لسه ما
شفناش نتيجة `debug-dump.js`. لو بعد التحديث ده لسه القيم غلط أو
`batterySource` بيطلع `none` لمعظم الوحدات، شغّل:
```
node debug-dump.js CR14
```
وابعتلي الـ output عشان نظبط المفاتيح بالظبط على حسب جهازك الحقيقي.

## اللي لسه هيتعمل / محتاج منك

1. ✅ Login + ربط كل عميل بيوزر — **تم**
2. ✅ تقرير Battery = 0V حقيقي (Excel export) + تصدير عام — **تم**
3. ✅ Dashboard تفصيلي خاص بكل عميل (شاشة تانية لما تدوس على أي وحدة) — **تم**
4. ✅ إرسال التقارير على الإيميل (يدوي من زرار Send Report) — **تم**
5. ⏳ **جدولة تلقائية** (يومي/أسبوعي) للإيميل — سهل نضيفها لما تحدد
   المعاد المطلوب (cron موجود بالفعل في `server.js` بيتفحص كل ساعة).
6. ⏳ لسه محتاجين نحل مشكلة **Battery = 0V الحقيقية** (نتيجة
   `debug-dump.js`) — دي أولوية عشان من غيرها التقارير بتاعت البطارية
   مش دقيقة.
7. ⚠️ **مهم:** التوكن اللي بعتّه قبل كده في الشات لسه معرّض — اعمل
   regenerate ليه من Wialon فورًا لو لسه ما عملتوش.

## Phase 8: Vodafone Integration Fix + SMS Tab (Send / Report / Status) + New Logo

### 1) تصحيح تكامل Vodafone (`lib/vodafoneSms.js`)
الكود القديم كان بيعمل الـ SecureHash ومبنى الـ XML بطريقة مختلفة عن المستند
الرسمي "E'len SMS API - Interface Specification V5.0". اتصلح بالكامل:

- **صيغة الـ SecureHash** بقت مطابقة تمامًا للمستند: تجميع
  `AccountId=..&Password=..&SenderName=..&ReceiverMSISDN=..&SMSText=..` (لكل
  رسالة بالترتيب) `&ExternalTrxId=..` (لو موجودة)، وعمل HMAC-SHA256 عليها.
  **اتأكد بالاختبار الفعلي** ضد المثالين الموجودين في المستند الرسمي (رسالة
  واحدة و3 رسائل) والنتيجة طابقت الـ Hash المكتوب بالظبط.
  ⚠️ **ملحوظة مهمة:** المستند بيقول في النص إن الـ Secret Key المفروض
  يتحول من hex string لبايتس (`pack('H*', ...)`) قبل ما يُستخدم كمفتاح، لكن
  لما جربت الطريقة دي على المثال الرسمي نفسه، النتيجة ما طابقتش. استخدام
  الـ Secret Key كـ **نص عادي** (زي ما هو) هو اللي طابق المثال الرسمي بالظبط.
  الكود دلوقتي شغال بالطريقة دي. لو حصل يومًا خطأ `9021 Authorization failed,
  incorrect Secure Hash` مع حساب حقيقي، حط `VODAFONE_HEX_DECODE_KEY=true`
  في `.env` عشان يرجع لطريقة الـ hex-decode اللي في النص.
- **شكل الـ XML** بقى `SubmitSMSRequest` ب `SMSList` متكررة (مش `SMS` جوه
  `SMSList` واحد) زي المستند بالظبط.
- **API endpoints اتنين منفصلين** زي ما المستند بيقول:
  - Notification: `.../web2sms/sms/submit/Notification` (للتنبيهات الفردية)
  - Campaign: `.../web2sms/sms/submit` (للإرسال الجماعي)
  خليت `VODAFONE_SMS_BASE_URL` في `.env` تحدد الـ host بس، والكود بيبني
  المسارين تلقائي.
- دعم إرسال أكتر من رسالة في الطلب الواحد (`sendSmsBatch`) + `ExternalTrxId`
  اختياري + **جدول أكواد الأخطاء الرسمي كامل** (9001 → 9039) عشان أي خطأ
  يرجع رسالة مفهومة مش رقم فاضي.
- **تطبيع أرقام الموبايل** (`normalizeMsisdn`) لكل الصيغ المصرية المذكورة في
  Appendix A من المستند (`010...`, `0020...`, `+20...`, `20...`).

### 2) تبويب SMS جديد (`/sms.html`)
فيه 3 تابات:
- **Send SMS** — ابعت رسالة واحدة لرقم أو مجموعة أرقام (مفصولين بفاصلة أو
  سطر جديد)، وكل محاولة بتتسجل في قاعدة البيانات.
- **Monthly Report** — فلتر بالشهر، بيوريك عدد الرسائل اللي طلعت (ناجحة/فاشلة)
  والأرقام المرسل لها والنص والتاريخ.
- **Status** — آخر رسالة اتبعتت (رقم، نص، تاريخ، حالة)، عدد الرسائل النهاردة
  وفي الشهر ده، وكمان الـ **IP الفعلي بتاع السيرفر** (اللي المفروض يتسجل عند
  Vodafone كـ "trusted IP").

⚠️ **بخصوص "الرصيد المتبقي":** مستند Vodafone الرسمي **مفيهوش أي endpoint
لمعرفة الرصيد/الكوتة المتبقية** — دي بتتحدد حسب العقد بينكم وبين Vodafone.
اللي التبويب بيوريه هو **عدد اللي إحنا فعلاً بعتناه من النظام ده**. لو
عندك رقم الكوتة الشهرية من Vodafone، حطه في `.env`:
```
VODAFONE_MONTHLY_QUOTA=1000
```
وهيبان تلقائي "Remaining Quota" = الكوتة - اللي اتبعت.

### 3) اللوجو
اتحدث `public/assets/logo-icon.jpg` باللوجو الجديد (خلفية بيضا) اللي بعتّه.
النسخة القديمة (خلفية سودا) محفوظة في
`public/assets/logo-icon-old-black-bg.jpg` لو حبيت ترجعلها.

### 4) IP الاستضافة (Hostinger) لتفعيل Vodafone
مافيش طريقة نعرف الـ IP الحقيقي بتاع سيرفر Hostinger من هنا (لسه مش
شغال Live). لما ترفع الكود على السيرفر وتشغّله:
1. افتح `/sms.html` → تبويب **Status** → هتلاقي **Outbound Server IP** —
   ده بالظبط الـ IP اللي المفروض تدّيه لـ Vodafone (أو الـ customer care
   agent بتاعهم) عشان يضيفوه في قايمة الـ "trusted IPs" للحساب (Section 4.3
   من المستند). لو السيرفر شغال ورا Load Balancer/Proxy، اطلب من Hostinger
   تأكيد الـ IP الثابت (Static/Dedicated IP) لأن الـ endpoint ده بيقرا الـ
   IP اللي السيرفر بيطلع بيه فعليًا على الإنترنت وقتها.
2. Vodafone SMS API **بترفض أي طلب مش جاي من IP مسجل** (رسالة الخطأ
   الرسمية لو حصل: `9013 - The given IP is not listed on the trusted IP
   list for the given account`).

### 5) مشكلة الإيميل (SMTP) اللي بتطلع Error
حسّنت رسائل الخطأ في `lib/mailer.js` — لو المشكلة سببها بلوك على بورتات
SMTP (بيحصل كتير مع الاستضافات المشتركة زي Hostinger) أو رفض الاتصال من
الـ IP، هتبان رسالة واضحة تقولك السبب المحتمل بدل error عام. **لو المشكلة
لسه موجودة، محتاجين نص رسالة الـ Error بالظبط اللي بتطلع عشان نشخصها
بدقة** — فيه فرق كبير بين "port blocked" و"authentication failed" و"IP
rejected by SMTP provider".

### 6) ربط اليوزر بنفس حساب Wialon
النظام أصلاً بيدعم ده جزئيًا: كل عميل (`User` في MySQL) ليه
`assignedUnitNames` — قائمة بأسماء العربيات **بالظبط** زي ما هي مسجلة في
Wialon، فلما العميل يدخل بالـ username/password بتاعه على Observer، هو
بيشوف **بالظبط نفس الوحدات** اللي هو شايفها لو دخل على Wialon مباشرة (مش
كل الأسطول). التفاصيل وإزاي تحددها لكل عميل موجودة في "Phase 5" فوق.

⚠️ **الفرق المهم:** اليوزر/الباسورد بتاع Observer **مش نفس** يوزر/باسورد
Wialon الأصلي (منفصلين تمامًا، ده أفضل من ناحية الأمان — العميل مايقدرش
يدخل على إعدادات Wialon الحساسة). لو فعلاً عايز نفس الـ username/password
تحديدًا (يستخدم بيانات دخوله على Wialon نفسها للدخول على Observer)، ده حل
تاني مختلف تمامًا (auth عن طريق Wialon token login بدل جدول Users بتاعنا)
وهيحتاج توضيح: هل كل عميل عنده يوزر Wialon منفصل فعلاً وليه صلاحية محدودة
على نفس الوحدات بس من ناحية Wialon نفسها؟

## Phase 9: Contacts, Detailed Reports, Vodafone Quota (renews on the 11th), Alert Throttling, Wialon Unit Import

### 1) تبويب "Contacts" — تسجيل رقم/مجموعة أرقام مسبقًا
تبويب جديد بجانب Send. تسجل اسم + رقم + اسم مجموعة (اختياري، افتراضي
"General")، والأرقام دي بتفضل محفوظة. من تبويب **Send**، فيه dropdown
"Load from saved group" — تختار المجموعة وهي بتملى خانة الأرقام تلقائي
بدل ما تكتبها كل مرة.

### 2) تقرير مفصّل بفلتر يوم/شهر
تبويب **Report** دلوقتي فيه فلترين: **يوم محدد** (`date`) أو **شهر كامل**
(`month`) — لو اخترت يوم بيتجاهل الشهر. والجدول بقى فيه الأعمدة المطلوبة
كلها: **رقم الموبايل - رقم الجهاز (Device ID) - اسم/رقم العربية - اسم
العميل**. اسم العميل بيتحسب تلقائي بمطابقة اسم العربية مع
`assignedUnitNames` بتاعة كل عميل.

⚠️ عشان عمود "رقم الجهاز/العربية/اسم العميل" يظهر، المفروض الرسالة تتبعت
وهي **مرتبطة بعربية معينة**. في تبويب Send فيه dropdown جديد "Related
vehicle (optional)" — لو اخترت العربية، البيانات دي هتتسجل صح في
التقرير. الرسائل التلقائية (تنبيهات الأوفلاين) بترتبط بالعربية تلقائيًا
لأن السيستم أصلاً عارف عنها.

### 3) تبويب "Quota" — الرصيد الإجمالي المتعاقد عليه + تجديد يوم 11
تبويب جديد (Admin فقط للتعديل، الكل يقدر يشوف): تحط فيه **العدد الإجمالي
للرسائل المتعاقد عليها مع فودافون**، ويوم التجديد (افتراضي **11** زي ما
طلبت). النظام بيحسب "الدورة الحالية" تلقائيًا حسب اليوم ده — يعني لو
النهاردة 30 أغسطس، الدورة الحالية بدأت 11 أغسطس وهتخلص 11 سبتمبر. لما
اليوم يعدي 11 الشهر الجاي، الدورة الجديدة تبدأ تلقائي والعداد يتصفر لوحده
(من غير ما حد يعمل حاجة يدوي) لأن الحساب بيتم live من قاعدة البيانات مش
تخزين شهري ثابت.

### 4) تبويب "Status" — المستخدم والمتبقي
اتحدث ليعتمد على "الدورة" الجديدة (مش الشهر الميلادي العادي) — بيوريك
**Used This Cycle** و**Remaining This Cycle** ومدى الدورة الحالية بالتاريخ،
مع progress bar بصري.

### 5) حد أقصى لعدد مرات إرسال تنبيه لنفس الجهاز
قبل كده كان بيبعت تنبيه واحد بس طول ما العربية أوفلاين. دلوقتي أضفت في
`.env`:
```
MAX_ALERTS_PER_EPISODE=3
ALERT_REPEAT_HOURS=6
```
يعني هيبعت تنبيه، وبعد كده يعيد كل 6 ساعات (تقدر تغيّرها)، لحد أقصى 3
مرات (تقدر تغيّرها) طول ما العربية لسه أوفلاين. لو رجعت أونلاين وبعدين
أوفلاين تاني، العداد يرجع يبدأ من جديد (episode جديدة).

### 6) ربط كل عميل بنفس الـ units اللي شايفها في Wialon فعليًا
في صفحة **Manage Users**، تحت خانة "Assigned Units" بقى فيه خانة تانية:
**"Customer's own Wialon API token"**. أي وقت تبعتلي توكن الـ API الخاص
بحساب العميل على Wialon (بييجي من: داخل حساب Wialon بتاعه → User settings
→ "Access via Wialon Local API" → generate token)، تحطه هنا وتدوس
**Import units** — النظام هيسجل دخول بالتوكن ده، يجيب بالظبط الوحدات اللي
الحساب ده شايفها على Wialon، ويحفظها في Assigned Units أوتوماتيك. كده مفيش
كتابة أسماء يدوي، ومضمون إن اللي العميل شايفه في Observer هو **بالظبط**
نفس اللي شايفه لو دخل Wialon مباشرة.

⚠️ **ليه توكن مش يوزر/باسورد؟** التوكن أأمن بكتير — نقدر نستخدمه للقراءة
بس من غير ما نخزن باسورد حقيقي لحساب حساس. لو مش عارف تجيب التوكن من
Wialon قولّي وهوريك بالظبط منين.

## Phase 10: Real-Letterhead SMS Reports (Excel + PDF, English + Arabic)

### 1) `GET /api/sms/report/export?date=&month=&format=xlsx|pdf&lang=en|ar`
تبويب **Report** في `/sms.html` بقى فيه صف أزرار تصدير: **Excel (EN/AR)**،
و **View/Download PDF (EN/AR)**. الرابط بيستخدم نفس فلتر اليوم/الشهر
اللي مختار على الشاشة وقتها.

- **PDF**: كل صفحة بتستخدم **نفس الـ letterhead الحقيقي** اللي بعتّه
  (`public/assets/letterhead-reference.pdf`) كخلفية كاملة — اتحول لصورة
  مرة واحدة (`public/assets/generated/letterhead-1.png`) وبيتكرر في كل
  صفحة، مش تقليد بالألوان بس زي التقارير القديمة.
- **العربي فعلاً بيشتغل صح**: العناوين والأعمدة بالعربي بتتعمل لها
  reshaping (ربط الحروف الصحيح) + bidi (ترتيب من اليمين لليسار) عن طريق
  `lib/arabicText.js` (`arabic-reshaper` + `bidi-js`) قبل ما تتكتب في
  الـ PDF بخط `Noto Naskh Arabic` (من باكدج `@fontsource/noto-naskh-arabic`).
  الأعمدة نفسها بترتيب RTL (من اليمين) في نسخة اللغة العربية.
- كل خلية (اسم عميل، رقم موبايل، تاريخ...) بتتفحص **لوحدها** — لو فيها
  حروف عربية بتاخد الخط العربي، ولو أرقام/إنجليزي بتاخد Helvetica —
  بغض النظر عن لغة التقرير ككل. كده اسم عميل عربي بيظهر صح حتى في
  تقرير إنجليزي، والعكس.
- **الأرقام والتواريخ دايمًا بالأرقام اللاتينية (Western numerals)**
  حتى في النسخة العربية — الأرقام العربية الهندية (٠-٩) مش موجودة في
  الخط المستخدم وبتظهر مربعات فاضية لو استخدمناها، والأرقام اللاتينية
  أصلاً هي الشائعة في المستندات التجارية المصرية.
- **Excel**: نفس البيانات بصيغة `.xlsx` بعناوين أعمدة عربي أو إنجليزي
  حسب `lang`، مع اللوجو مضاف فوق الشيت.
- `?download=1` يجبر التحميل بدل العرض المباشر في المتصفح (الأزرار
  "View" بتفتح بدون download، وأزرار "Download" و Excel كلها بتحمّل).

### 2) تعديل حد التنبيهات التلقائية ليطابق المطلوب بالظبط
`.env.example` و`server.js` اتحدثوا:
```
MAX_ALERTS_PER_EPISODE=4   # كان 3
ALERT_REPEAT_HOURS=4       # كان 6
```
يعني تنبيه أقصاه 4 مرات، كل 4 ساعات، طول ما نفس العربية لسه أوفلاين
بشكل متواصل (episode واحدة) — بالظبط زي ما طلبت. ⚠️ لو عندك ملف `.env`
حقيقي على السيرفر (مش `.env.example`)، لازم تحدّث القيمتين دول فيه
يدويًا لأن `.env` الحقيقي مش بيتغير تلقائي من التحديث ده.

### 3) اللي لسه محتاج مراجعة منك
- **الرصيد الإجمالي المتعاقد عليه من فودافون**: لسه محتاج الرقم الفعلي
  تحطه من تبويب **Quota** في الواجهة (مفيش endpoint في مستند Vodafone
  يجيبه أوتوماتيك، زي ما اتوضح قبل كده في Phase 9).
- **جرّب الأزرار الجديدة على بيانات حقيقية** بعد الرفع، وابعتلي لو أي
  عمود ناقص بيانات (زي `unitId`/`unitName`) عشان الرسائل اليدوية لازم
  تتبعت مع اختيار "Related vehicle" من تبويب Send عشان التقرير يطلع
  كامل الأعمدة.

## Phase 11: Compare + Permissions + WhatsApp Channel + Combined Reports

هذا الجزء بيرد على آخر قايمة طلبات بعتّها (اليوزرز، الواتساب، الصلاحيات،
اللغة العربية، تقارير وايلون). أول حاجة عملتها هي **مقارنة**: قعدت أراجع
كل نقطة طلبتها مع اللي فعلاً موجود في الكود من Phase 1 لحد Phase 10،
ولقيت إن جزء كبير من القايمة **كان اتعمل بالفعل** من غير ما تلاحظ (لأنه
جوه فيتشرز تانية)، فبدل ما أعيده كتبته هنا موضح مقابل كل نقطة.

### جدول المقارنة (طلبك ← الحالة)

| # | طلبك | الحالة |
|---|------|--------|
| تابة أسجل فيها رقم/مجموعة | ✅ موجود من Phase 9 — تبويب **Contacts** في `/sms.html` |
| تقرير بفلتر يوم/شهر بكل الأعمدة المطلوبة | ✅ موجود من Phase 9 — تبويب **Report**، فلتر Day/Month |
| تابة العدد الإجمالي المتعاقد + تجديد يوم 11 | ✅ موجود من Phase 9 — تبويب **Quota** |
| تابة تطلع المتبقي والمستخدم | ✅ موجود من Phase 9 — تبويب **Status** (اسمه بقى **"Remaining Messages"** في الشريط — طلبك رقم 4 في القايمة التانية) |
| حد أقصى لعدد التنبيهات لنفس الجهاز | ✅ موجود من Phase 9/10 — `MAX_ALERTS_PER_EPISODE` / `ALERT_REPEAT_HOURS` (4 رسائل، كل 4 ساعات) |
| يوزر لكل عميل يشوف بس عرباته | ✅ موجود من Phase 5 + 9 — `assignedUnitNames` + استيراد من توكن Wialon بتاعه |
| 4 رسائل/يوم كل 4 ساعات بعد كده توقف | ✅ نفس الميكانيزم فوق — لو عايز حد يومي منفصل (مش بس "أثناء استمرار الأوفلاين")، قولّي عشان أضيفه كمنطق تاني |
| تاب + تقارير بفلتر شهر لأي أرقام | ✅ موجود (Report tab) |
| تعديل مسمى تاب "المتبقي" | ✅ **اتعمل دلوقتي** — الاسم بقى **"Remaining Messages"** بدل "Status" |
| تاب إرسال Bulk / رقم واحد | ✅ موجود (Send SMS + Contacts) |
| زرار تقارير يطلع كل الرسائل (عرض/دونلود، EN/AR/Excel/PDF) | ✅ موجود من Phase 10، **وزودت عليه دلوقتي** فلتر Channel (SMS/WhatsApp) و Source (يدوي / تنبيه تلقائي من وايلون) عشان تقدر تفصل "الرسائل الطالعة من وايلون" لوحدها |
| تقرير الأرقام اللي اتبعتلها رسائل (Excel/PDF) | ✅ نفس تقرير الـ Report — فيه عمود **perNumber breakdown** في الـ JSON، والملف نفسه فيه كل رقم وحالته |

| تقرير الرسائل اللي "طلعت fail" | ✅ فلتر الحالة (Failed) موجود في نفس التقرير — كل صف بيوضح Submitted/Failed + رسالة الخطأ. **ملحوظة:** مستند Vodafone الرسمي مفيهوش endpoint لـ "delivery report" حقيقي بعد الإرسال (يعني نقدر نعرف إن الطلب اتقبل من الـ API أو لأ، مش إن الرسالة فعلاً وصلت لموبايل العميل) — لو عندك أي مستند تاني منهم بيوضح delivery receipts ابعتهولي أضيفه |
| letterhead في التقارير | ✅ موجود من Phase 10 (PDF بيستخدم `letterhead-reference.pdf` الحقيقي كخلفية كل صفحة) |
| تابة WhatsApp | 🆕 **اتعمل دلوقتي** — `lib/whatsapp.js` + Channel selector في Send tab. **محتاج منك:** حساب WhatsApp Business على Meta Business Manager + `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` (تفاصيل تحت) |
| تقرير الرسائل WhatsApp/SMS مع بعض | 🆕 **اتعمل دلوقتي** — نفس تقرير الـ Report دلوقتي فيه عمود **Channel** وفلتر بيه |
| كل تقارير وايلون تتصدر من Observer | ⚠️ **محتاج توضيح** — لو قصدك تقارير الـ SMS/WhatsApp المرتبطة بوايلون، دي بقت كلها هنا. لو قصدك تقارير Wialon الجاهزة بتاعته هو (Mileage, Fuel, Trips... إلخ) فديه حاجة تانية تحتاج ربط بـ Wialon Reports API (`report/exec_report`) — قولّي بالظبط إسم/نوع كل تقرير عايزه من وايلون وأنا أضيفه |
| صلاحيات اليوزرات بـ checkbox لكل الشاشات | 🆕 **اتعمل دلوقتي بالكامل** — تفاصيل تحت |
| مشكلة اللغة العربية في التقارير | ⚠️ اللي موجود بالفعل (من Phase 10) بيعمل reshaping + bidi + خط عربي مخصص لكل خلية فيها عربي، والأرقام دايمًا لاتينية. **لو لسه فيه مشكلة محددة (مثلاً حروف بتطلع مقطوعة أو بالعكس)، ابعتلي screenshot من التقرير الغلط عشان أقدر أصلحها بدقة** — من غيره مش هعرف أفرق نظريًا |

### 1) صلاحيات اليوزرات (Screen Permissions) — جديد بالكامل
من `/admin-users.html` دلوقتي، سواء وأنت بتعمل يوزر جديد أو تعدل واحد
موجود، فيه شبكة **checkboxes** لكل شاشة في النظام:
`Dashboard`, `Units Table`, `SMS Send + Contacts`, `WhatsApp Send`,
`SMS/WhatsApp Reports`, `Quota Tab`, `Remaining Messages Tab`,
`Manage Users (Admin)`.

- الـ **Admin** دايمًا بيشوف كل حاجة بغض النظر عن الـ checkboxes.
- الـ **Customer** بيشوف بس اللي متعلّم عليه — الصلاحية دي بتتفعّل على
  مستوى السيرفر (API + الصفحة نفسها بترجعله 403/redirect لو حاول يدخل
  شاشة مش مسموح له بيها)، مش مجرد إخفاء بصري.
- ⚠️ **مهم:** الصلاحيات بتتحفظ في الـ session وقت الـ login، فلو غيّرت
  صلاحيات يوزر وهو داخل بالفعل، **لازم يعمل logout/login تاني** عشان
  التغيير يتفعّل — ده نفس السلوك القديم بتاع `assignedUnitNames`.

### 2) تابة WhatsApp — جديد بالكامل
- `lib/whatsapp.js` بيستخدم **WhatsApp Cloud API** الرسمي من Meta (مش
  مكتبة تالتة زي Twilio) — ده الطريق الرسمي لإرسال رسائل WhatsApp
  برمجيًا كـ business.
- في `/sms.html`، تبويب **Send SMS** بقى فيه اختيار **Channel**:
  `SMS (Vodafone)` أو `WhatsApp` — نفس الشاشة، نفس الأرقام، بس بيختار
  إزاي يبعت.
- ⚠️ **محتاج منك قبل ما يشتغل فعليًا:**
  1. حساب **WhatsApp Business** متسجل في **Meta Business Manager**
     (ده حساب/تفعيل بتعمله إنت من عندهم، مش حاجة أقدر أعملهالك من هنا).
  2. من جوه الحساب: **API Setup** هيدّيك `WHATSAPP_TOKEN` (Access
     Token) و `WHATSAPP_PHONE_NUMBER_ID`. حطهم في `.env` (موجودين
     كـ placeholders في `.env.example`).
  3. **قاعدة مهمة من Meta نفسها (مش حاجة إحنا حطيناها):** تقدر تبعت
     رسالة نص حر لأي رقم **لو هو كلمك في آخر 24 ساعة**. لو عايز تبعت
     تنبيه تلقائي (زي تنبيهات الأوفلاين) بره الـ 24 ساعة دي، لازم
     **Template معتمد من Meta** مسبقًا (زي `vehicle_offline_alert`) —
     فيه دالة `sendWhatsAppTemplate()` جاهزة في الكود لما يكون عندك
     Template متسجل.

### 3) التقارير بقت موحّدة (SMS + WhatsApp)
- `SmsLog` (رغم اسمه القديم) بقى فيه حقل **`channel`**: `sms` أو
  `whatsapp`.
- تبويب **Report** في `/sms.html` بقى فيه فلترين إضافيين: **Channel**
  (All / SMS only / WhatsApp only) و **Source** (All / Manual / Auto
  alert from Wialon) — وده اللي بيرد على طلب "تقارير وايلون كلها تتصدر
  من Observer": أي رسالة اتبعتت تلقائي بسبب تنبيه أوفلاين من وايلون
  (`source: alert`) تقدر تفلترها لوحدها دلوقتي.
- ملفات الـ Excel والـ PDF (EN/AR) بقى فيهم عمود **Channel** و
  **Source** كمان.

### 4) اللي لسه محتاج منك عشان نقفل الباقي
1. **حساب WhatsApp Business + التوكن** (فوق) — من غيره التبويب موجود
   بس مش هيقدر يبعت فعليًا.
2. **توضيح "تقارير وايلون"**: لو قصدك تقارير Wialon الجاهزة (Trips,
   Fuel Consumption, Mileage...) مش بس رسائلنا، محتاج قايمة بأسماء
   التقارير دي بالظبط عشان أربطها بـ Wialon Reports API.
3. **مثال حقيقي لمشكلة اللغة العربية** لو لسه موجودة بعد كل التحديثات
   اللي في Phase 10 — Screenshot من الملف الغلط يوفر وقت كبير في
   التشخيص.
4. **جرّب صلاحيات اليوزرات على السيرفر الحقيقي** بعد الرفع، وقولّي لو
   شاشة معينة اتخفت غلط أو ظهرت غلط.

## Phase 12: Wialon Reports (Trips / Tracks / Fuel Consumption...)

بيرد على طلبك: **"تقارير وايلون كلها تتصدر من Observer"**، وبالتحديد
تقارير وايلون الجاهزة (Trips, Tracks, Fuel Consumption... أو أي تقرير
تاني موجود فعليًا في حسابك على وايلون) — مش بس تقارير الـ SMS/WhatsApp.

### إزاي شغالة
النظام **مش بيخترع تقارير جديدة ولا بيحفظ IDs ثابتة** — بيقرأ التقارير
(Report Templates) الموجودة بالفعل في حسابك على Wialon (اللي إنت أو
حد عندك عمله من قبل جوه Wialon نفسه: Reports → Report templates)،
ويسيبك تختار منها، تختار العربيات، وتختار الفترة، ويشغلها ويطلعلك
النتيجة Excel أو PDF (إنجليزي أو عربي، بنفس الـ letterhead والخط
العربي المستخدم في تقارير الـ SMS).

- **`GET /api/wialon-reports/templates`** — يرجع كل الـ Report
  Templates الموجودة في حساب وايلون بتاعك (اسم كل تقرير + الـ resource
  بتاعه).
- **`/wialon-reports.html`** — الشاشة: اختار Template، اختار عربية/عربيات
  (أو سيبها فاضية = كل العربيات المسموح لك تشوفها)، اختار From/To،
  دوس **Run Report** للمعاينة على الشاشة، أو صدّر على طول Excel/PDF
  (EN/AR).
- زرار **"Wialon Reports"** ظهر في هيدر `/index.html`، `/units.html`،
  و`/sms.html` — بس لو عندك صلاحية `wialonReports` (أو انت admin).
- صلاحية جديدة في `/admin-users.html`: **"Wialon Reports
  (Trips/Tracks/Fuel...)"** — checkbox زي الباقي.

### ⚠️ محتاج منك عشان يشتغل فعليًا
1. **لازم يكون عندك على الأقل Report Template واحد متعمل بالفعل جوه
   Wialon نفسه** (مش هنا) — من Wialon → Reports → Report templates.
   Observer بيشغل التقارير دي، مش بيعملها من الصفر.
2. لو حساب Wialon بتاعك فيه **أكتر من resource واحد** فيه report
   templates، محتاج تحدد `WIALON_RESOURCE_ID` في `.env` (الافتراضي:
   بيكتشف أول resource لوحده لو مفيش غيره).
3. **الكود ده لسه محتاج اختبار على بيانات حقيقية** — بنيته بالظبط على
   تسلسل Wialon Remote API الرسمي (`report/exec_report` →
   `report/select_result_rows` → `report/cleanup_result`)، لكن شكل
   الأعمدة بالظبط بيختلف حسب كل template، فلو أي تقرير طلع الأعمدة
   بتاعته غلط أو فاضية، ابعتلي اسم الـ Template + screenshot من
   المعاينة عشان أظبطها.

## Phase 13: Maintenance Requests — wiring fixes + email + report export

راجعت الـ tabs اللي عملتهم إنت (Wialon Reports + Maintenance) ولقيت الآتي
واتصلح:

1. **باج خطير: تقرير الصيانة كان معطّل بالكامل.** `GET /:id` كان متسجل
   في الكود *قبل* `GET /report`، فأي طلب لـ `/api/maintenance/report`
   كان بيتفسر على إنه "جيب طلب رقمه report" بدل ما يجيب التقرير — وده
   كان بيرجع خطأ 500. اتنقل `/report` (والـ export الجديد بتاعه)
   يتسجلوا قبل `/:id` — وده pattern مهم في Express: أي route شكله
   ثابت (`/report`) لازم يتسجل *قبل* أي route شكله متغير (`/:id`) لو
   بنفس عدد الأجزاء، وإلا المتغير هياكله.
2. **صلاحية `maintenance` كانت مش موجودة في checkbox list بتاع
   `/admin-users.html`** — الأدمن ما كانش يقدر يديها لأي عميل خالص
   حتى لو عايز. اتضافت.
3. **صفحة `/maintenance.html` ما كانتش محمية بالصلاحية** زي باقي
   الصفحات المحمية (`units.html`, `sms.html`, `wialon-reports.html`) —
   كانت بترد لأي يوزر عامل login بس، مش بس اللي عنده صلاحية. اتصلحت.
4. **زرار "🔧 Maintenance" كان في `index.html` بس** — اتضاف كمان في
   `units.html` و `sms.html`.
5. **إشعار إيميل جديد** عند إنشاء طلب صيانة: بيتبعت لـ
   `SUPPORT_EMAIL` (افتراضيًا `Support@obserevereg.com`، معدّل من
   `.env`) — لو SMTP مش متظبط لسه بيسجل تحذير في الـ console وميوقفش
   إنشاء الطلب.
6. **`GET /api/maintenance/report/export?format=xlsx|pdf&lang=en|ar`**
   — تصدير Excel/PDF لتقرير طلبات الصيانة (كان JSON بس قبل كده)، فيه
   عمود "Closed By" يوضح الطلب اتقفل بواسطة العميل ولا الدعم/الأدمن.

### ⚠️ لسه محتاج منك
- SMTP لسه فيه بيانات placeholder في `.env` — لازم تحط بيانات Gmail
  حقيقية (App Password، مش الباسورد العادي) عشان إشعار الدعم يشتغل
  فعليًا.
- `WIALON_RESOURCE_ID` في `.env` قيمته شكلها مش صح (مش رقم Wialon
  عادي) — راجعها، رغم إن شاشة Wialon Reports مش محتاجاها فعليًا
  (بتاخد الـ resourceId تلقائيًا من كل Template).

## Phase 14: Login بنفس يوزر/باسورد Wialon (اختياري لكل عميل)

بيرد على آخر طلب: عميل يدخل على Observer **بنفس** يوزر وباسورد حسابه على
Wialon (مش يوزر منفصل زي كل العملاء لحد دلوقتي).

### إزاي شغالة
- من `/admin-users.html`، وقت عمل عميل جديد (أو تعديل واحد موجود)، فيه
  دلوقتي حقل **"Login Method"**: `Local` (زي القديم) أو **`Same as
  Wialon`**.
- لو اخترت `Same as Wialon`: مفيش حقل password يتطلب هنا خالص — العميل
  هيدخل بنفس يوزر وباسورد Wialon بتاعه، والسيستم بيبعتهم لـ Wialon
  نفسه (`core/login`) في كل مرة يعمل login، **مفيش أي باسورد بيتخزن
  عندنا في الداتابيز خالص**.
- أهم حاجة: الـ session اللي بترجع من Wialon بعد اللوجين ده بتبقى
  **مقفولة أصلاً على نفس الوحدات** اللي حساب Wialon ده شايفها — يعني
  مفيش حاجة اسمها "Assigned Units" هنا خالص، ومفيش احتمال يحصل فرق أو
  غلط بين اللي شايفه على Wialon واللي شايفه على Observer، لأنهم نفس
  الـ session بالظبط.
- لو حد كتب يوزر مش موجود عندنا خالص وجرب يدخل بيه، والسيستم لقى إن
  Wialon قبل اليوزر/الباسورد دول، بيعمل **حساب Observer تلقائي** ليه
  (بصلاحيات محدودة افتراضيًا: Dashboard + Units بس، تقدر تزودها بعدين
  من `/admin-users.html`) — ده أساسًا نفس فكرة "Signup" اللي كانت في
  القايمة الأولى، بس أبسط لأنه نفس اليوزر/الباسورد بالظبط بدل خطوتين.

### ⚠️ حاجات لازم تعرفها/تتأكد منها
1. **الـ endpoint المستخدم هو `core/login`** (يوزر+باسورد مباشرة، مش
   `token/login` اللي بيستخدم توكن). ده الاسم الموثق في Wialon Remote
   API، بس **لسه محتاج اختبار فعلي** على حساب حقيقي عندك — لو رجع خطأ
   غريب، ابعتلي نص الخطأ بالظبط زي ما عملنا مع Vodafone وهظبطه.
2. **الـ Wialon session بتاعة العميل ده بتفضل شغالة طول ما هو داخل** —
   لو فضل مفتوح فترة طويلة من غير حركة، Wialon هيقفلها هو نفسه
   (session timeout)، وقتها هيرجعله في الداشبورد رسالة "انتهت الجلسة،
   سجل دخول تاني" بدل الصفحة تفضل فاضية أو تدي خطأ غريب. ده مطبق دلوقتي
   على `/api/dashboard` — لو حابب نفس السلوك في شاشات تانية (Units
   Table، Reports، SMS...) قولّي وأمدّه عليهم كمان.
3. **العملاء القدام (اللي دخلوا بـ `assignedUnitNames`) مش بيتأثروا
   خالص** — الميزة دي اختيارية لكل عميل لوحده من `Login Method`، مش
   تغيير عام.
4. لو حابب تجرب على عميل حقيقي، أسهل حاجة: اعمل يوزر جديد بنفس اليوزر
   نيم بتاعه على Wialon بالظبط، اختار `Same as Wialon`، وسيبه يدخل
   بباسوردهم الحالي على Wialon.

## Phase 15: "Login with Wialon" اتحوّلت لـ OAuth الرسمي (بدل يوزر/باسورد مباشر)

بعد ما جرّبنا `core/login` (يوزر/باسورد مباشر) طلع بيرجع `{"error":7}` —
اتأكدنا إن Wialon نفسه **قافل الطريقة دي من 2015** (موثّق رسميًا في
مكتباتهم)، ومش حاجة في الكود عندنا. البديل الرسمي اللي Wialon بينصح
بيه هو **OAuth flow**: العميل يدخل باسورده على صفحة Wialon نفسها،
مش عندنا خالص، وWialon يرجّعلنا Token بس.

### الفرق عن Phase 14
- ✅ نفس الفكرة الأساسية فضلت زي ما هي: كل عميل بيشوف بالظبط نفس
  الوحدات اللي شايفها على Wialon، من غير Assigned Units يدوي
- ❌ اللي اتغيّر: العميل مبيكتبش باسورد Wialon في فورم Observer خالص.
  بدل كده بيدوس زرار **"Login with Wialon"** في صفحة اللوجين، بينقله
  لصفحة Wialon الرسمية، يدخل بياناته هناك، وWialon يرجّعه تلقائي لصفحة
  `/wialon-callback.html` عندنا ومعاه Token بس (مش الباسورد)

### ⚠️ محتاج منك خطوة واحدة عشان يشتغل
لازم تسجّل الأبلكيشن بتاعك عند Wialon الأول (مرة واحدة بس):
1. ادخل حساب Wialon بتاعكم → **Apps** → **Local apps** (أو من
   `hosting.wialon.com/local.html`)
2. اعمل تطبيق جديد، وحط الـ **Redirect URL** بالظبط:
   `https://yourdomain.com/wialon-callback.html` (استبدل الدومين
   بالدومين الحقيقي بتاعكم على Hostinger)
3. Wialon هيدّيك **Client ID** — حطه في `.env`:
   ```
   WIALON_OAUTH_CLIENT_ID=<اللي هتاخده من Wialon>
   WIALON_OAUTH_REDIRECT_URI=https://yourdomain.com/wialon-callback.html
   ```
4. لو الحساب على `hosting.wialon.eu` بدل `.com`، غيّر
   `WIALON_HOSTING_URL` في `.env` كمان

من غير الخطوة دي، زرار "Login with Wialon" هيدّي خطأ واضح إنه لسه مش
متظبط، بدل ما يفشل صامت.

### طريقة الاختبار
1. اعمل عميل جديد من `/admin-users.html` بـ Login Method = "Same as
   Wialon" (اختياري — لو العميل مش موجود عندنا أصلًا وسجّل دخول ناجح
   من Wialon، هيتعمله حساب تلقائي بنفس الطريقة القديمة)
2. من صفحة `/login.html` دوس **"Login with Wialon"**
3. هيوديك لصفحة Wialon، ادخل بيوزر/باسورد Wialon الحقيقيين
4. هيرجعك تلقائي لـ Observer وتلاقي نفسك داخل، شايف بالظبط عرباتك

## ملاحظات أمان قبل الإنتاج

- استخدم HTTPS (خلي `NODE_ENV=production` علشان الكوكيز تبقى `secure`).
- `SESSION_SECRET` لازم يكون string عشوائي طويل، متسيبوش زي الـ example.
- ماتشيلش `.env` على Git.


## MySQL / cPanel deployment

This version uses MySQL/MariaDB instead of MongoDB. The application logic, routes,
Wialon integration, frontend pages, PDF generation, SMS/WhatsApp flows, and session
behavior are preserved.

1. Create a MySQL database and user in cPanel and grant ALL PRIVILEGES.
2. Import `observer_fleet_mysql.sql` using phpMyAdmin.
3. Upload this project to cPanel Node.js Application.
4. Set the environment variables from `.env.example` in cPanel:
   `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`, `SESSION_SECRET`
   plus the existing Wialon/Vodafone variables.
5. Run `npm install`.
6. Run `npm run seed` only if you need to create/update the initial local users.
7. Start/restart the Node.js application.

The production `.env` file is intentionally not included in this ZIP. Configure
secrets through cPanel environment variables instead.

## فحص استجابة الوحدة بعد ٦ ساعات أوفلاين

كل دقيقة، يفحص النظام آخر رسالة لكل وحدة. إذا تجاوز الانقطاع ٦ ساعات، يسأل Wialon عن الأوامر التي يدعمها الجهاز على SMS/GSM. إذا كان `query_pos` مدعومًا، يرسله كطلب موقع قياسي مرة واحدة خلال فترة الانقطاع. بعد ١٥ دقيقة، يسجل هل وصلت رسالة جديدة من الوحدة إلى Wialon. عدم وصول رد يعني **لا توجد استجابة مؤكدة**، ولا يثبت وحده أن الجهاز معلّق؛ قد تكون الشبكة أو الـSIM غير متاحة.

لا يلزم إعداد أمر يدوي لكل وحدة. Wialon يحدد تلقائيًا إن كان `query_pos` متاحًا لهذا الجهاز عبر SMS/GSM. الوحدة التي لا تملك رقم SIM أو لا تدعم هذا الأمر يتم تجاوزها وتسجيل السبب في تقرير الرسائل تحت المصدر `activation`؛ لا يُرسل لها أمر تخميني. إذا فشل الإرسال، يعيد النظام المحاولة بعد ٣٠ دقيقة. عند عودة الوحدة وإرسالها بيانات، تُسجّل الاستجابة ويُعاد ضبط حالة الانقطاع.

الإعدادات الاختيارية: `DEVICE_ACTIVATION_OFFLINE_HOURS` (افتراضي ٦)، `DEVICE_ACTIVATION_RESPONSE_MINUTES` (افتراضي ١٥)، و`DEVICE_ACTIVATION_RETRY_MINUTES` (افتراضي ٣٠). تمت إزالة الإرسال العام الثابت `bestpassword R`؛ لا تستخدمه كأمر استعلام لأنه قد يعيد تشغيل بعض الأجهزة.
