/**
 * Every user-visible Arabic string in both apps.
 *
 * Appendix B of the build guide is the source. Strings marked FIXED there
 * must not be reworded without the client's approval — SENT is the one that
 * matters most: the worker learns to look for exactly those two words.
 *
 * Adding a screen? Add its strings here, not inline in the view.
 */
export const T = {
  // ---- Shared ----
  appNameWorker: 'مبيعات المحل',
  appNameOwner: 'لوحة المالك',
  shopFallback: 'المحل',
  currency: 'ر.س',
  retry: 'إعادة المحاولة',
  cancel: 'إلغاء',
  save: 'حفظ',
  saved: 'تم الحفظ',
  close: 'إغلاق',
  back: 'رجوع',
  loading: 'جاري التحميل…',
  signOut: 'تسجيل الخروج',
  networkError: 'ما فيه اتصال بالإنترنت',
  unknownError: 'صار خطأ غير متوقع، حاول مرة ثانية',
  unreachable: 'ما قدرنا نوصل للنظام — تأكد من الإنترنت وحاول مرة ثانية',
  loadFailed: 'ما قدرنا نحمّل البيانات',
  loadFailedHint: 'هذا مو معناه إن ما فيه شي — الاتصال ما نجح. حاول مرة ثانية.',

  // ---- Sign in (both apps) ----
  // [4.2] A password replaced the six digits — the client's decision.
  signInPrompt: 'أدخل كلمة المرور',
  signInButton: 'دخول',
  signInWrong: 'كلمة المرور غير صحيحة',
  signInOffline: 'ما فيه اتصال بالإنترنت — كلمة المرور ما انفحصت، حاول لما ترجع الشبكة',
  signInRateLimited: 'محاولات كثيرة — انتظر دقائق وحاول مرة ثانية',
  signInServer: 'النظام ما يرد الحين — حاول بعد شوي',
  signInBusy: 'جاري الدخول…',
  showPassword: 'إظهار',
  hidePassword: 'إخفاء',
  sessionExpired: 'انتهت الجلسة — ادخل مرة ثانية. الصور اللي ما انرسلت محفوظة.',
  passwordRule: 'كلمة المرور لازم تكون 8 خانات على الأقل، وفيها حرف ورقم ورمز مثل ! @ # $',
  passwordRuleShort: '8 خانات على الأقل: حرف + رقم + رمز (! @ # $ …)',
  passwordSameAsOwner: 'هذي كلمة مرور المالك نفسها — اختر وحدة مختلفة للعامل',
  passwordSame: 'هذي نفس كلمة المرور الحالية',
  passwordMismatch: 'التأكيد ما يطابق كلمة المرور',

  // ---- Worker app ----
  captureButton: 'صوّر الدفتر',
  retake: 'إعادة التصوير',
  send: 'إرسال',
  sending: 'جاري الإرسال…',
  sent: 'تم الإرسال',                                  // FIXED — do not reword
  sentAgain: 'إرسال صورة ثانية',
  photoRequired: 'لازم تصوّر الدفتر أولاً',
  offlineBanner: 'لم يتم الإرسال بعد — سيتم تلقائياً عند رجوع الشبكة',
  offlineRetry: 'حاول الآن',
  alreadyApproved: 'تم اعتماد هذا اليوم، ما يمكن تعديله',
  badDate: 'التاريخ خارج المدة المسموحة',
  photoTooLarge: 'الصورة كبيرة جداً، صوّر مرة ثانية',
  uploadFailed: 'ما نجح الإرسال، حاول مرة ثانية',
  queueFull: 'فيه صور كثيرة بانتظار الإرسال، انتظر رجوع الشبكة',
  queueSaveFailed: 'ما قدرنا نحفظ الصورة على الجوال — حاول ترسلها مرة ثانية',
  queueBanner: (n) => `${n === 1 ? 'صورة وحدة' : `${n} صور`} ما انرسلت بعد — بتنرسل أول ما تفتح التطبيق والشبكة شغالة`,
  droppedBanner: (dates) => `ما قدرنا نرسل صورة يوم ${dates} — بلّغ صاحب المحل`,
  droppedDismiss: 'تمام',
  signOutConfirm: (n) => `فيه ${n} صور ما انرسلت. لو طلعت بتنحذف من الجوال. متأكد؟`,
  tooManyResends: 'أرسلت هذا اليوم مرات كثيرة — كلّم صاحب المحل',
  compressFailed: 'ما قدرنا نجهّز الصورة — صوّر مرة ثانية',
  cameraDenied: 'التطبيق يحتاج إذن الكاميرا — اسمح له من إعدادات المتصفح. فتحنا لك كاميرا الجوال بدالها.',
  cameraUnavailable: 'ما قدرنا نفتح الكاميرا داخل التطبيق — فتحنا لك كاميرا الجوال بدالها.',
  workerHint: 'صوّر صفحة اليوم من الدفتر كاملة، وخلّ الأرقام واضحة',

  // ---- Owner: navigation ----
  navReview: 'المراجعة',
  navToday: 'اليوم',
  navArchive: 'الأرشيف',
  navMonthly: 'التقرير',
  navMore: 'المزيد',

  // ---- Owner: review ----
  reviewQueue: 'قائمة المراجعة',
  reviewEmpty: 'كل شي محدّث، ما فيه شي بانتظار المراجعة',
  reviewEmptyHint: 'الأيام الجديدة تظهر هنا أول ما يرسل العامل صورة الدفتر',
  lowConfidence: 'القراءة غير مؤكدة، راجع الصورة',
  extractionFailed: 'ما قدر النظام يقرأ الصورة — اكتب الأرقام يدوياً من الصورة',
  // [4.2] Why it failed, so a permanent outage stands out from one blurry photo.
  extractionWhy: {
    quota: 'خلص حد القراءة المجاني لليوم — اضغط «أعد القراءة» بكرة، أو اكتب الأرقام',
    overloaded: 'خدمة القراءة كانت مشغولة — اضغط «أعد القراءة»',
    key: 'مفتاح خدمة القراءة غير صالح — يحتاج المطوّر',
    model: 'نموذج القراءة متوقف من جوجل — يحتاج المطوّر يغيّر GEMINI_MODEL',
    blocked: 'خدمة القراءة رفضت الصورة — اكتب الأرقام يدوياً',
    unreadable: 'الصورة ما انقرأت — تأكد إنها واضحة، أو اكتب الأرقام',
    download: 'ما قدرنا نفتح الصورة المرسلة',
    not_image: 'الملف المرسل مو صورة صحيحة',
    unknown: 'صار خطأ في القراءة — اضغط «أعد القراءة»',
  },
  // Short forms for the queue list; the card shows the full sentence.
  extractionShort: {
    quota: 'ما انقرأت — خلص الحد المجاني لليوم',
    overloaded: 'ما انقرأت — الخدمة كانت مشغولة',
    key: 'ما انقرأت — مفتاح الخدمة غير صالح',
    model: 'ما انقرأت — نموذج القراءة متوقف',
    blocked: 'ما انقرأت — اكتب الأرقام يدوياً',
    unreadable: 'الصورة ما انقرأت',
    download: 'ما قدرنا نفتح الصورة',
    not_image: 'الملف مو صورة صحيحة',
    unknown: 'ما انقرأت — أعد القراءة',
  },
  startReview: 'ابدأ المراجعة',
  readingWarning: 'انتبه: جمع الأسطر ما طابق، أو عمود ما انقرأ — راجع الأرقام مع الصورة',
  stillReading: 'جاري قراءة الصورة…',
  stillReadingHint: 'عادة تأخذ ثواني. حدّث الصفحة بعد شوي.',
  stuckReading: 'القراءة طوّلت أكثر من المعتاد',
  retryReading: 'أعد القراءة',
  retryQueued: 'رجعت للقراءة — حدّث الصفحة بعد دقيقة',
  typeInstead: 'أو اكتب الأرقام بنفسك من الصورة واعتمد',
  staleCard: 'العامل أرسل صورة جديدة لهذا اليوم — حمّلنا النسخة الجديدة',
  farFromAverage: (pct) => `الإجمالي ${pct < 0 ? 'أقل' : 'أعلى'} من متوسط آخر 7 أيام بـ ⁦${Math.abs(pct)}%⁩ — تأكد من الأرقام`,
  moveDay: 'هذا اليوم بتاريخ غلط؟',
  moveDayButton: 'انقله',
  moveDayDone: 'تم نقل اليوم',
  dateTaken: 'التاريخ الجديد فيه يوم مسجّل — ما نقدر ننقل فوقه',
  approve: 'اعتماد',
  approving: 'جاري الاعتماد…',
  approved: 'تم الاعتماد',
  approvedCountdown: (n) => (n === 1 ? 'باقي يوم واحد للمراجعة'
    : n === 2 ? 'باقي يومين للمراجعة'
    : n <= 10 ? `باقي ${n} أيام للمراجعة` : `باقي ${n} يوم للمراجعة`),
  reviewNext: 'التالي',
  waitingCount: (n) => `${n} بانتظار المراجعة`,

  // ---- Owner: figures ----
  cash: 'نقدي',
  mada: 'شبكة',
  total: 'الإجمالي',
  customers: 'الزبائن',
  todayTotal: 'إجمالي اليوم',
  avg7: 'متوسط آخر 7 أيام',
  avgWeekday: 'متوسط نفس اليوم من الأسبوع',
  comparisonNote: 'هذه مقارنات، مو أهداف',
  monthlyTarget: 'الهدف الشهري',
  perCustomer: 'متوسط الزبون',
  perDay: 'متوسط اليوم',
  bestDay: 'أعلى يوم',
  worstDay: 'أقل يوم',
  daysRecorded: 'أيام مسجّلة',
  noDataYet: 'ما فيه بيانات معتمدة بعد',

  // ---- Owner: archive & day ----
  archive: 'الأرشيف',
  dayDetail: 'تفاصيل اليوم',
  filterMonth: 'الشهر',
  filterAll: 'كل الأيام',
  statusApproved: 'معتمد',
  statusNeedsReview: 'بانتظار المراجعة',
  statusPending: 'جاري القراءة',
  sourceWorker: 'من العامل',
  sourceImport: 'استيراد قديم',
  modelReading: 'قراءة النظام الأصلية',
  confirmedFigures: 'الأرقام المعتمدة',
  revision: 'رقم المراجعة',
  submittedAt: 'وصلت',
  reviewedAt: 'اعتُمدت',
  notes: 'ملاحظات',
  editFigures: 'تعديل الأرقام',
  noPhoto: 'ما فيه صورة لهذا اليوم',
  photoZoomHint: 'قرّب بإصبعين',

  // ---- Owner: bulk import ----
  bulkImport: 'استيراد دفاتر قديمة',
  bulkPick: 'اختر الصور',
  bulkPickHint: 'تقدر تختار عشرات الصور مرة وحدة، أو تسحب مجلد كامل هنا',
  bulkAssignDates: 'حدّد تاريخ كل صورة',
  bulkAutoDate: 'التاريخ مقروء من الملف',
  bulkNeedsDate: 'يحتاج تاريخ',
  bulkStart: 'ابدأ الاستيراد',
  bulkSending: 'جاري الاستيراد…',
  bulkProgress: (done, total) => `${done} من ${total}`,
  bulkDone: 'خلص الاستيراد',
  bulkDoneHint: 'الصور الآن في قائمة المراجعة',
  bulkFailed: 'فشلت',
  bulkDuplicate: 'هذا التاريخ موجود مسبقاً وسيُستبدل',
  bulkDuplicateApproved: 'هذا اليوم معتمد — بيتخطّاه الاستيراد',
  bulkDuplicateBatch: 'تاريخ مكرر في نفس القائمة — صحّح واحد منهم',
  bulkFileDate: 'التاريخ من وقت حفظ الملف — تأكد منه',
  bulkLocked: 'معتمد مسبقاً — تخطّيناه',
  bulkRetryFailed: 'أعد المحاولة للي فشلت',
  bulkDailyCap: (n) => `الخدمة المجانية تقرأ تقريباً ${n} صورة باليوم. استوردنا أول ${n} — كمّل الباقي بكرة.`,
  bulkKeepScreen: 'الاستيراد يمشي على دفعات صغيرة عشان حدود الخدمة المجانية — لا تسكّر الصفحة، وخلّ الشاشة شغالة لين يخلص',
  bulkRemove: 'حذف من القائمة',
  bulkRateNote: 'استراحة قصيرة بين الدفعات…',

  // ---- Owner: export ----
  exportTitle: 'تصدير',
  exportFrom: 'من تاريخ',
  exportTo: 'إلى تاريخ',
  exportExcel: 'تصدير Excel',
  exportPdf: 'طباعة / حفظ PDF',
  exportNote: 'الأيام المعتمدة فقط تدخل في التصدير',
  exportEmpty: 'ما فيه أيام معتمدة في هذه المدة',

  // ---- Owner: settings ----
  settings: 'الإعدادات',
  shopName: 'اسم المحل',
  targetLabel: 'الهدف الشهري (ر.س)',
  workerCode: 'كلمة مرور العامل',
  workerCodeHint: 'غيّرها لو تسرّبت أو تغيّر العامل — جواله القديم يطلع تلقائياً.',
  workerCodeChanged: 'تم تغيير كلمة مرور العامل',
  workerCodeInvalid: 'كلمة المرور لازم تكون 8 خانات على الأقل، وفيها حرف ورقم ورمز',
  ownerPassword: 'كلمة مرورك أنت',
  ownerPasswordNew: 'كلمة المرور الجديدة',
  ownerPasswordConfirm: 'أعد كتابتها للتأكيد',
  ownerPasswordChanged: 'تم تغيير كلمة مرورك',
  storageUsage: 'مساحة الصور',
  storageOf: (used, files) => `${used} ميجا من 1024 · ${files} صورة`,
  settingsSaved: 'تم حفظ الإعدادات',

  // ---- Owner: misc ----
  addOldDay: 'إضافة يوم قديم',
  refresh: 'تحديث',
  ofMonth: 'من الشهر',
};

/** Arabic day names, Sunday-first to match Postgres extract(dow). */
export const WEEKDAYS = [
  'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت',
];

export const MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];
