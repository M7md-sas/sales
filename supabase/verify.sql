-- ============================================================
--  VERIFY — يفحص أن الإعداد تمّ صح. لا يغيّر أي شيء.
--
--  الصقه كاملاً في SQL Editor واضغط Run بعد تشغيل schema.sql
--  وإنشاء المستخدمَين.
--
--  كل سطر يرجع PASS أو FAIL مع سبب. أي FAIL يوقف التسليم.
-- ============================================================

with checks as (

  -- ---------- 1. الجداول الأربعة ----------
  select 1 as n, 'الجداول الأربعة موجودة' as check_name,
         case when count(*) = 4 then 'PASS' else 'FAIL' end as status,
         'موجود: ' || coalesce(string_agg(tablename, ', '), 'لا شيء') as detail
  from pg_tables
  where schemaname = 'public'
    and tablename in ('profiles', 'daily_entries', 'settings', 'audit_log')

  -- ---------- 2. RLS مفعّل على الأربعة ----------
  union all
  select 2, 'RLS مفعّل على كل الجداول',
         case when count(*) filter (where not rowsecurity) = 0 then 'PASS' else 'FAIL' end,
         case when count(*) filter (where not rowsecurity) = 0
              then 'كلها مفعّلة'
              else 'بدون RLS: ' || string_agg(tablename, ', ') filter (where not rowsecurity) end
  from pg_tables
  where schemaname = 'public'
    and tablename in ('profiles', 'daily_entries', 'settings', 'audit_log')

  -- ---------- 3. لا توجد سياسة للعامل على daily_entries ----------
  -- السياسة الوحيدة المسموحة هي e_owner_read (قراءة للمالك). أي سياسة
  -- إضافية هنا تعني احتمال فتح باب قراءة أو كتابة للعامل.
  union all
  select 3, 'daily_entries فيها سياسة قراءة المالك فقط',
         case when count(*) = 1 and bool_and(policyname = 'e_owner_read' and cmd = 'SELECT')
              then 'PASS' else 'FAIL' end,
         'السياسات: ' || coalesce(string_agg(policyname, ', '), 'لا شيء')
  from pg_policies
  where schemaname = 'public' and tablename = 'daily_entries'

  -- ---------- 4. الثغرة الأمنية — الأهم في هذا الملف ----------
  -- record_extraction يجب ألا تكون قابلة للتنفيذ من authenticated.
  -- في المخطط الأصلي كانت مكشوفة عبر منحة PUBLIC الافتراضية.
  union all
  select 4, '★ record_extraction محجوبة عن العامل',
         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'FAIL' else 'PASS' end,
         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'خطر: العامل يقدر يكتب أرقاماً مباشرة. نفّذ سطر revoke من DEVIATIONS.md بند 4'
              else 'محجوبة كما يجب' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'record_extraction'

  union all
  select 5, '★ record_extraction محجوبة عن anon',
         case when has_function_privilege('anon', p.oid, 'EXECUTE')
              then 'FAIL' else 'PASS' end,
         case when has_function_privilege('anon', p.oid, 'EXECUTE')
              then 'خطر: قابلة للتنفيذ بدون تسجيل دخول' else 'محجوبة' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'record_extraction'

  union all
  select 6, 'worker_user_id محجوبة عن authenticated',
         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'FAIL' else 'PASS' end,
         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'يجب سحبها من public' else 'محجوبة' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'worker_user_id'

  -- ---------- 7. الدوال المسموحة ممنوحة فعلاً ----------
  union all
  select 7, 'submit_photo متاحة للتطبيقين',
         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'PASS' else 'FAIL' end,
         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'متاحة' else 'العامل لن يقدر يرسل أي صورة' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'submit_photo'

  -- ---------- 8. الدوال موجودة، كل واحدة بنسخة واحدة ----------
  -- نسخة قديمة من record_extraction أو approve_day بتوقيع مختلف تعني أن
  -- المخطط القديم شُغّل فوق الجديد — والقديمة لا تتحقق من الصورة.
  union all
  select 8, 'كل الدوال المطلوبة موجودة (نسخة واحدة لكل دالة)',
         case when count(*) = 14 and count(distinct proname) = 14 then 'PASS' else 'FAIL' end,
         'عدد الدوال: ' || count(*) || ' من 14 — ' || string_agg(proname, ', ')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and proname in ('submit_photo', 'record_extraction', 'approve_day',
                    'owner_import_day', 'get_monthly', 'get_trend',
                    'is_owner', 'worker_user_id', 'is_active_member',
                    'retry_extraction', 'move_day', 'storage_usage',
                    'end_user_sessions', 'today_riyadh')

  -- ---------- 9. المستخدمان ----------
  union all
  select 9, 'حساب مالك واحد نشط',
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         case when count(*) = 0
              then 'لم تُضف صفوف profiles بعد — راجع الخطوة 3 من دليل الإعداد'
              else 'عدد المالكين: ' || count(*) end
  from public.profiles where role = 'owner' and active

  union all
  select 10, 'حساب عامل واحد نشط',
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         'عدد العمّال: ' || count(*)
  from public.profiles where role = 'worker' and active

  -- ---------- 11. التخزين ----------
  union all
  select 11, 'bucket اسمه receipts خاص، JPEG فقط، وحد 2MB',
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         case when count(*) = 1 then 'موجود وخاص ومحدود'
              else 'غير موجود، أو عام، أو بلا حد للحجم/النوع — أعد تشغيل schema.sql' end
  from storage.buckets
  where id = 'receipts' and public = false
    and file_size_limit is not null and file_size_limit <= 2097152
    and allowed_mime_types = array['image/jpeg']

  union all
  select 12, 'سياسات التخزين مضبوطة',
         case when count(*) = 2 then 'PASS' else 'FAIL' end,
         'السياسات: ' || coalesce(string_agg(policyname, ', '), 'لا شيء')
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('st_upload', 'st_owner_read')

  -- ---------- 13. الإعدادات ----------
  union all
  select 13, 'صفوف الإعدادات الأربعة',
         case when count(*) = 4 then 'PASS' else 'FAIL' end,
         'المفاتيح: ' || coalesce(string_agg(key, ', '), 'لا شيء')
  from public.settings
  where key in ('monthly_target', 'shop_name', 'currency', 'timezone')

  -- ---------- 14. اليوم التجاري ----------
  -- [4.2] يقارن بحساب مستقل (UTC + 3 ساعات، الرياض بلا توقيت صيفي) لا
  -- بنفس تعريف الدالة — المقارنة القديمة ما كان ممكن تفشل أبداً.
  union all
  select 14, 'today_riyadh ترجع تاريخ الرياض (يقفل 12 بالليل)',
         case when public.today_riyadh() = ((now() at time zone 'UTC') + interval '3 hours')::date
              then 'PASS' else 'FAIL' end,
         'اليوم التجاري: ' || public.today_riyadh()

  -- ---------- 15. الجدول للقراءة فقط ----------
  union all
  select 15, '★ daily_entries غير قابل للكتابة مباشرة',
         case when has_table_privilege('authenticated', 'public.daily_entries', 'INSERT')
                or has_table_privilege('authenticated', 'public.daily_entries', 'UPDATE')
                or has_table_privilege('authenticated', 'public.daily_entries', 'DELETE')
              then 'FAIL' else 'PASS' end,
         case when has_table_privilege('authenticated', 'public.daily_entries', 'UPDATE')
              then 'خطر: أي حساب مالك (أو جلسته المسروقة) يعدّل الأيام المعتمدة بلا سجل'
              else 'الكتابة عبر الدوال فقط' end

  -- ---------- 16. الـ Webhook ----------
  union all
  select 16, '★ الـ Webhook مربوط على Insert و Update',
         case when count(distinct event_manipulation) filter
                     (where event_manipulation in ('INSERT', 'UPDATE')) = 2
              then 'PASS' else 'FAIL' end,
         case when count(*) = 0
              then 'لا يوجد أي Webhook على daily_entries — كل صورة ستبقى «جاري القراءة». الخطوة 7'
              else 'الأحداث: ' || string_agg(distinct event_manipulation, ', ') end
  from information_schema.triggers
  where event_object_schema = 'public'
    and event_object_table = 'daily_entries'
    and action_statement ilike '%extract-figures%'

  -- ---------- 17. دوال الحافة فقط ----------
  union all
  select 17, 'end_user_sessions محجوبة عن التطبيقين',
         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
                or has_function_privilege('anon', p.oid, 'EXECUTE')
              then 'FAIL' else 'PASS' end,
         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'خطر: أي حساب يقدر يطرد الآخر' else 'محجوبة' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'end_user_sessions'

  -- ---------- 18. لا شيء لغير المسجّلين ----------
  union all
  select 18, 'لا دالة في public قابلة للتنفيذ بدون تسجيل دخول',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         case when count(*) = 0 then 'anon لا يملك شيئاً'
              else 'مفتوحة لـ anon: ' || string_agg(p.proname, ', ') end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'EXECUTE')
)

select
  case status when 'PASS' then '✅' else '❌' end as "الحالة",
  check_name as "الفحص",
  detail     as "التفصيل"
from checks
order by
  case status when 'FAIL' then 0 else 1 end,   -- الأخطاء أولاً
  n;
