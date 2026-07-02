-- 20260707000000_soften_seeded_marketing_claims.sql
-- Wave 1 (trust roadmap decisions 44/B9): soften two seeded homepage claims
-- that overpromise — "Ijazah from senior scholars" (unverifiable flourish) and
-- "book any time, 7 days" (4 teachers cannot honestly cover it).
--
-- DATA-ONLY, expand-safe: no DDL. Each UPDATE is guarded on the ORIGINAL
-- seeded text (v16_001_site_content.sql) so any content the admin has since
-- edited through /admin/content is never stomped. Idempotent: re-running
-- matches zero rows.

update public.site_features
set
  description_ar = 'جميع معلمينا حاصلون على إجازة مُدقَّقة',
  description_en = 'All our teachers hold a credential-checked Ijazah'
where slot = 'home_why_us'
  and description_ar = 'جميع معلمينا حاصلون على إجازة من كبار العلماء'
  and description_en = 'All teachers hold Ijazah from senior scholars';

update public.site_features
set
  description_ar = 'مواعيد مرنة صباحاً ومساءً عبر المناطق الزمنية',
  description_en = 'Flexible times, morning or evening, across time zones'
where slot = 'home_why_us'
  and description_ar = 'احجز في أي وقت — صباحاً أو مساءً، ٧ أيام'
  and description_en = 'Book any time — morning or evening, 7 days a week';

