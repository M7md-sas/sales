/**
 * اختبار الأمن — الخطوة 9 من دليل الإعداد، مؤتمتة.
 *
 * كيف تشغّله:
 *   1. افتح تطبيق العامل في المتصفح وسجّل الدخول بحساب العامل.
 *   2. افتح أدوات المطوّر (F12) ← تبويب Console.
 *   3. الصق هذا الملف كاملاً واضغط Enter.
 *
 * ثم كرّره بحساب المالك على /owner/ — النتيجة المتوقعة معكوسة تماماً،
 * وهذا مطبوع في آخر التقرير.
 *
 * لا يكتب أي شيء في قاعدة البيانات إلا في فحص واحد يُفترض أن يفشل،
 * وإن نجح فأنت أمام ثغرة لا أمام بيانات فاسدة — راجع DEVIATIONS.md بند 4.
 */
(async () => {
  const base = location.pathname.includes('/owner') ? '../js/' : './js/';
  const { supabase } = await import(`${base}core/supabase.js`);
  const { CONFIG } = await import(`${base}config.js`);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    console.error('❌ لست مسجّل الدخول. سجّل الدخول أولاً ثم أعد التشغيل.');
    return;
  }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', session.user.id).maybeSingle();
  const role = profile?.role ?? 'unknown';

  console.log(`%c اختبار الأمن — الحساب الحالي: ${role} `,
              'background:#1F6F8B;color:#fff;padding:4px 8px;font-weight:bold');

  const results = [];
  const check = async (name, expectation, fn) => {
    let outcome;
    try {
      outcome = await fn();
    } catch (error) {
      outcome = { blocked: true, note: String(error?.message ?? error).slice(0, 80) };
    }
    const blocked = Boolean(outcome.blocked);
    const wantBlocked = expectation === 'blocked';
    results.push({
      'الفحص': name,
      'المتوقع': wantBlocked ? 'محجوب' : 'مسموح',
      'الفعلي': blocked ? 'محجوب' : 'مسموح',
      'النتيجة': blocked === wantBlocked ? '✅ PASS' : '❌ FAIL',
      'ملاحظة': outcome.note ?? '',
    });
  };

  // للعامل كل هذه يجب أن تكون محجوبة، وللمالك كلها مسموحة.
  const want = role === 'owner' ? 'allowed' : 'blocked';

  await check('قراءة daily_entries', want, async () => {
    const { data, error } = await supabase.from('daily_entries').select('*').limit(5);
    // RLS لا ترمي خطأ — ترجع مصفوفة فارغة. وهذا هو الحجب الصحيح.
    return { blocked: Boolean(error) || (data ?? []).length === 0,
             note: error ? error.message.slice(0, 60) : `${(data ?? []).length} صف` };
  });

  await check('قراءة settings', want, async () => {
    const { data, error } = await supabase.from('settings').select('*');
    return { blocked: Boolean(error) || (data ?? []).length === 0,
             note: `${(data ?? []).length} صف` };
  });

  await check('قراءة audit_log', want, async () => {
    const { data, error } = await supabase.from('audit_log').select('*').limit(5);
    return { blocked: Boolean(error) || (data ?? []).length === 0,
             note: `${(data ?? []).length} صف` };
  });

  await check('استدعاء get_monthly', want, async () => {
    const { data, error } = await supabase.rpc('get_monthly', { p_year: new Date().getFullYear() });
    return { blocked: Boolean(error), note: error ? 'forbidden' : `${(data ?? []).length} شهر` };
  });

  await check('استدعاء get_trend', want, async () => {
    const { error } = await supabase.rpc('get_trend', { p_entry_date: '2026-01-01' });
    return { blocked: Boolean(error), note: error ? 'forbidden' : 'رجعت بيانات' };
  });

  // ★ الفحص الحاسم: هذه يجب أن تكون محجوبة عن الاثنين معاً، حتى المالك.
  // لا أحد ينادي record_extraction إلا دالة الحافة بمفتاح service_role.
  await check('★ استدعاء record_extraction مباشرة', 'blocked', async () => {
    const { error } = await supabase.rpc('record_extraction', {
      p_entry_date: '1999-01-01',   // تاريخ لا يمكن أن يوجد
      p_photo_path: 'probe.jpg',
      p_cash: 1, p_mada: 1, p_customers: 1, p_confidence: 1, p_error: null,
    });
    return { blocked: Boolean(error),
             note: error ? 'محجوبة كما يجب'
                         : '⚠️ خطر — راجع DEVIATIONS.md بند 4 فوراً' };
  });

  // [4.2] الجدول للقراءة فقط حتى للمالك — كل تعديل يمر عبر الدوال اللي تسجّل في السجل.
  await check('★ تعديل daily_entries مباشرة', 'blocked', async () => {
    const { error } = await supabase.from('daily_entries')
      .update({ notes: 'probe' }).eq('entry_date', '1999-01-01');
    return { blocked: Boolean(error), note: error ? 'محجوب' : '⚠️ الجدول قابل للكتابة مباشرة' };
  });

  // [4.2] دالة القراءة الآلية لا تقبل إلا الـ Webhook (ترويسة السر).
  await check('★ استدعاء extract-figures بدون السر', 'blocked', async () => {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/extract-figures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ record: { entry_date: '1999-01-01', photo_path: 'probe.jpg' } }),
    }).catch(() => null);
    const blocked = !res || res.status === 401 || res.status === 503;
    return { blocked, note: res ? `HTTP ${res.status}` : 'ما وصل' };
  });

  await check('إعادة القراءة retry_extraction', want, async () => {
    const { data, error } = await supabase.rpc('retry_extraction', { p_entry_date: '1999-01-01' });
    // للمالك: not_found (مسموح لكن اليوم غير موجود). للعامل: forbidden.
    const blocked = Boolean(error) || data?.code === 'forbidden';
    return { blocked, note: error ? error.message.slice(0, 50) : data?.code };
  });

  await check('طلب رابط موقّع لصورة', want, async () => {
    const { data, error } = await supabase.storage
      .from('receipts').createSignedUrl('probe.jpg', 60);
    // مسار غير موجود يعطي خطأ للجميع، فالمهم نوع الخطأ لا وجوده.
    const denied = Boolean(error) && /not.*(authoriz|allow|permitt)|denied|403/i.test(error.message);
    return { blocked: denied || Boolean(error) && !data,
             note: error ? error.message.slice(0, 50) : 'رجع رابط' };
  });

  console.table(results);

  const failed = results.filter((r) => r['النتيجة'].includes('FAIL'));
  if (failed.length === 0) {
    console.log(`%c ✅ كل الفحوصات مرّت للحساب: ${role} `,
                'background:#17845A;color:#fff;padding:4px 8px;font-weight:bold');
    console.log(role === 'owner'
      ? 'الآن كرّر نفس الاختبار بحساب العامل — يجب أن ينقلب كل شيء إلى محجوب.'
      : 'الآن كرّر نفس الاختبار بحساب المالك على /owner/ — يجب أن تُسمح القراءات كلها.');
  } else {
    console.log(`%c ❌ فشل ${failed.length} فحص — لا تسلّم المشروع قبل حلّها `,
                'background:#B3261E;color:#fff;padding:4px 8px;font-weight:bold');
  }
})();
