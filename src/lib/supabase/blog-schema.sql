-- Blog posts table
CREATE TABLE blog_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  excerpt_ar TEXT NOT NULL,
  excerpt_en TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  body_en TEXT NOT NULL,
  category_ar TEXT NOT NULL,
  category_en TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  read_time_ar TEXT NOT NULL DEFAULT '٥ دقائق',
  read_time_en TEXT NOT NULL DEFAULT '5 min',
  published_at TIMESTAMPTZ DEFAULT NOW(),
  is_published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read published posts" ON blog_posts
  FOR SELECT USING (is_published = true);

CREATE POLICY "Admins full access" ON blog_posts
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Seed data
INSERT INTO blog_posts (slug, title_ar, title_en, excerpt_ar, excerpt_en, body_ar, body_en, category_ar, category_en, color, read_time_ar, read_time_en, is_published) VALUES
('how-to-start-quran-memorization', 'كيف تبدأ رحلة حفظ القرآن الكريم؟', 'How to Start Your Quran Memorization Journey', 'يبدأ كثير من المسلمين رحلتهم مع الحفظ بدون خطة واضحة. في هذا المقال نشاركك خطوات عملية لبدء رحلة الحفظ بالطريقة الصحيحة.', 'Many Muslims start their memorization journey without a clear plan. Here are practical steps to begin your Hifz journey the right way.', 'المحتوى الكامل للمقال سيُضاف قريباً...', 'Full article content coming soon...', 'حفظ القرآن', 'Hifz', 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', '٥ دقائق', '5 min', true),
('noon-saakin-rules', 'أحكام النون الساكنة والتنوين بطريقة مبسطة', 'Noon Saakin & Tanween Rules Made Simple', 'شرح مبسط لأحكام الإظهار والإدغام والإقلاب والإخفاء مع أمثلة عملية.', 'A simplified explanation of Idh-haar, Idghaam, Iqlaab and Ikhfaa with practical examples.', 'المحتوى الكامل للمقال سيُضاف قريباً...', 'Full article content coming soon...', 'تجويد', 'Tajweed', 'text-sky-400 border-sky-500/30 bg-sky-500/10', '٧ دقائق', '7 min', true),
('7-tips-memorization', '٧ نصائح لتثبيت الحفظ وعدم النسيان', '7 Tips to Maintain Your Quran Memorization', 'نصائح مجربة من معلمين ذوي خبرة لتثبيت ما حفظته من القرآن.', 'Proven tips from experienced teachers to retain your memorization.', 'المحتوى الكامل للمقال سيُضاف قريباً...', 'Full article content coming soon...', 'نصائح', 'Tips', 'text-amber-400 border-amber-500/30 bg-amber-500/10', '٤ دقائق', '4 min', true),
('help-child-memorize-quran', 'كيف تساعد طفلك على حفظ القرآن؟', 'How to Help Your Child Memorize Quran', 'نصائح لأولياء الأمور لتشجيع أطفالهم على الحفظ بأسلوب ممتع.', 'Tips for parents to encourage children to memorize in a fun way.', 'المحتوى الكامل للمقال سيُضاف قريباً...', 'Full article content coming soon...', 'للأطفال', 'Children', 'text-pink-400 border-pink-500/30 bg-pink-500/10', '٦ دقائق', '6 min', true),
('hafs-vs-warsh', 'ما الفرق بين رواية حفص ورواية ورش؟', 'Hafs vs Warsh: Understanding the Difference', 'دليل شامل للفرق بين أشهر الروايات القرآنية وأين تُقرأ.', 'A guide to the differences between the most well-known Quran readings.', 'المحتوى الكامل للمقال سيُضاف قريباً...', 'Full article content coming soon...', 'القراءات', 'Qiraat', 'text-purple-400 border-purple-500/30 bg-purple-500/10', '٨ دقائق', '8 min', true),
('arabic-letter-articulation', 'مخارج الحروف: دليل شامل للمبتدئين', 'Arabic Letter Articulation: A Beginner Guide', 'تعرف على مخارج الحروف العربية بالتفصيل لتحسين تلاوتك.', 'Learn about Arabic letter articulation to improve your recitation.', 'المحتوى الكامل للمقال سيُضاف قريباً...', 'Full article content coming soon...', 'تجويد', 'Tajweed', 'text-sky-400 border-sky-500/30 bg-sky-500/10', '١٠ دقائق', '10 min', true);
