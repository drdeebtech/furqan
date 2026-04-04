const REVIEWS = [
  { name: "أم حبيبة", loc: "لندن 🇬🇧", text: "ابني عمره ٥ سنوات ويحب جلساته كثيراً. معلمته رائعة جداً، ماشاء الله! يتطلع لكل جلسة بشوق." },
  { name: "علي عمران", loc: "مانشستر 🇬🇧", text: "الحمد لله راضٍ جداً عن مستوى التعليم والمعلمين. أنصح فرقان بشدة لكل من يبحث عن تعليم قرآني متميز." },
  { name: "إسراء هاشمي", loc: "تورنتو 🇨🇦", text: "طفلاي يتعلمان القراءة بالتجويد الصحيح. المعلمون محترفون ومتفانون. أوصي بهم بشدة." },
  { name: "شغفتة كنول", loc: "دبي 🇦🇪", text: "لم أتخيل أن التعلم عبر الإنترنت سيكون بهذا المستوى. الإدارة منظمة جداً والمعلمة صبورة ودافئة." },
  { name: "أحمد يوسف", loc: "سيدني 🇦🇺", text: "معلمون ممتازون يجعلون طفلي منخرطاً في التعلم. خدمة العملاء على أعلى مستوى!" },
  { name: "آني شيخ", loc: "نيويورك 🇺🇸", text: "استطعت حجز ٤ جلسات أسبوعياً مع طفل رضيع! الجدول مرن جداً يناسب كل الظروف." },
  { name: "ماهين مسعود", loc: "هيوستن 🇺🇸", text: "مضى شهران على تعلم ابنتي وهي سعيدة جداً. المعلمة حنونة وصبورة، وابنتي باتت تتشوق لكل درس." },
  { name: "فاطمة السيد", loc: "الكويت 🇰🇼", text: "أتممت حفظ جزء عمّ في ثلاثة أشهر بفضل الله ثم بفضل معلمي المتميز في فرقان." },
];

export function Testimonials() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        <p className="text-sm font-medium tracking-widest text-gold">❖ آراء الطلاب</p>
        <h2 className="font-display mt-3 text-4xl font-bold">ماذا يقول طلابنا؟</h2>
        <p className="mt-2 text-sm text-muted">What Our Students Say About Us</p>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {REVIEWS.map((r) => (
            <div key={r.name} className="rounded-2xl border border-card-border bg-card p-6">
              <span className="text-3xl leading-none text-gold/20">❝</span>
              <p className="mt-2 text-sm leading-relaxed text-muted">{r.text}</p>
              <div className="mt-4 border-t border-card-border pt-3">
                <p className="text-sm font-bold">{r.name}</p>
                <p className="text-xs text-muted">{r.loc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
