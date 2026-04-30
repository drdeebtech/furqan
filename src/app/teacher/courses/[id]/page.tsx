import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  Send,
  Trash2,
  PlayCircle,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import {
  submitForReview,
  updateCourse,
  deleteCourse,
} from "@/lib/actions/courses";
import { deleteLesson, togglePreview, syncLessonStatusFromBunny } from "@/lib/actions/course-lessons";
import { LessonUploader } from "./lesson-uploader";
import type { Course, CourseLesson } from "@/types/database";

interface PageProps {
  params: Promise<{ id: string }>;
}

const VIDEO_STATUS_BADGE: Record<string, { ar: string; en: string; cls: string; icon: typeof CheckCircle2 }> = {
  pending: { ar: "بانتظار الرفع", en: "Pending upload", cls: "bg-muted/20 text-muted", icon: Clock },
  uploading: { ar: "جاري الرفع", en: "Uploading", cls: "bg-blue-500/20 text-blue-700", icon: Clock },
  processing: { ar: "قيد المعالجة", en: "Processing", cls: "bg-warning/20 text-warning", icon: Clock },
  ready: { ar: "جاهز", en: "Ready", cls: "bg-success/20 text-success", icon: CheckCircle2 },
  failed: { ar: "فشل", en: "Failed", cls: "bg-error/20 text-error", icon: AlertCircle },
};

export default async function EditCoursePage({ params }: PageProps) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: course } = await supabase
    .from("courses")
    .select("*")
    .eq("id", id)
    .single<Course>();
  if (!course) notFound();

  // ownership check (admin can also access; RLS already permits)
  if (course.teacher_id !== user.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role: string }>();
    if (!profile || !["admin", "moderator"].includes(profile.role)) {
      redirect("/teacher/courses");
    }
  }

  const { data: lessons } = await supabase
    .from("course_lessons")
    .select("*")
    .eq("course_id", id)
    .order("order_index", { ascending: true })
    .returns<CourseLesson[]>();

  const editable = ["draft", "rejected"].includes(course.status);
  const submittable = editable && (lessons?.length ?? 0) > 0;

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted">
        <Link href="/teacher/courses" className="hover:text-gold">
          {t("الدورات المسجلة", "Recorded Courses")}
        </Link>
        <ChevronRight size={14} className={dir === "rtl" ? "rotate-180" : ""} />
        <span className="truncate">{course.title_ar}</span>
      </div>

      {course.status === "rejected" && course.rejection_reason && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-error dark:border-red-700 dark:bg-red-950 dark:text-red-100">
          <p className="font-semibold">{t("تم رفض الدورة", "Course rejected")}</p>
          <p className="mt-1">{course.rejection_reason}</p>
        </div>
      )}

      {course.status === "pending_review" && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-warning dark:border-amber-700 dark:bg-amber-950 dark:text-warning">
          {t(
            "الدورة قيد المراجعة من قبل المشرفين. لا يمكن التعديل حتى تتم الموافقة أو الرفض.",
            "Course is under review. Editing is locked until approved or rejected.",
          )}
        </div>
      )}

      {/* ── Course metadata edit ── */}
      <section className="glass-card mb-6 p-6">
        <h2 className="mb-4 text-base font-semibold">
          {t("معلومات الدورة", "Course details")}
        </h2>
        <form
          action={async (fd) => {
            "use server";
            await updateCourse(id, fd);
          }}
          className="space-y-4"
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {t("العنوان (عربي)", "Title (Arabic)")}
            </label>
            <input
              name="title_ar"
              defaultValue={course.title_ar}
              disabled={!editable}
              className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm disabled:opacity-50 dark:bg-white/5"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {t("العنوان (إنجليزي)", "Title (English)")}
            </label>
            <input
              name="title_en"
              defaultValue={course.title_en ?? ""}
              disabled={!editable}
              className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm disabled:opacity-50 dark:bg-white/5"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              {t("الوصف (عربي)", "Description (Arabic)")}
            </label>
            <textarea
              name="description_ar"
              defaultValue={course.description_ar ?? ""}
              rows={3}
              disabled={!editable}
              className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm disabled:opacity-50 dark:bg-white/5"
            />
          </div>
          <div className="rounded-lg border bg-white/20 p-4 dark:bg-white/5">
            <div className="mb-3 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="pricing_type"
                  value="free"
                  defaultChecked={course.pricing_type === "free"}
                  disabled={!editable}
                />
                {t("مجانية", "Free")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="pricing_type"
                  value="one_time"
                  defaultChecked={course.pricing_type === "one_time"}
                  disabled={!editable}
                />
                {t("مدفوعة", "Paid (one-time)")}
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                name="price_cents"
                type="number"
                min={0}
                defaultValue={course.price_cents}
                disabled={!editable}
                className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm disabled:opacity-50 dark:bg-white/5"
              />
              <select
                name="currency"
                defaultValue={course.currency}
                disabled={!editable}
                className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm disabled:opacity-50 dark:bg-white/5"
              >
                <option value="USD">USD</option>
                <option value="EGP">EGP</option>
              </select>
            </div>
          </div>
          {editable && (
            <button
              type="submit"
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              {t("حفظ التعديلات", "Save changes")}
            </button>
          )}
        </form>
      </section>

      {/* ── Lessons ── */}
      <section className="glass-card mb-6 p-6">
        <h2 className="mb-4 text-base font-semibold">
          {t("الدروس", "Lessons")} ({lessons?.length ?? 0})
        </h2>

        {lessons && lessons.length > 0 ? (
          <ul className="mb-4 space-y-2">
            {lessons.map((l) => {
              const badge =
                VIDEO_STATUS_BADGE[l.video_status] ?? VIDEO_STATUS_BADGE.pending;
              const Icon = badge.icon;
              return (
                <li
                  key={l.id}
                  className="flex items-center gap-3 rounded-lg border bg-white/30 p-3 dark:bg-white/5"
                >
                  <PlayCircle size={20} className="text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">#{l.order_index}</span>
                      <span className="truncate text-sm font-medium">
                        {l.title_ar}
                      </span>
                      {l.is_preview && (
                        <span className="rounded-full bg-success/20 px-2 py-0.5 text-xs text-success">
                          {t("معاينة", "Preview")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${badge.cls}`}>
                        <Icon size={10} />
                        {lang === "ar" ? badge.ar : badge.en}
                      </span>
                      {l.duration_seconds && (
                        <span>
                          {Math.floor(l.duration_seconds / 60)}:
                          {String(l.duration_seconds % 60).padStart(2, "0")}
                        </span>
                      )}
                    </div>
                  </div>
                  {editable && (
                    <>
                      {l.video_status !== "ready" && l.video_status !== "failed" && (
                        <form
                          action={async () => {
                            "use server";
                            await syncLessonStatusFromBunny(l.id);
                          }}
                        >
                          <button
                            type="submit"
                            className="rounded-lg border border-blue-300 px-3 py-1 text-xs text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                          >
                            {t("تحديث الحالة", "Sync status")}
                          </button>
                        </form>
                      )}
                      <form
                        action={async () => {
                          "use server";
                          await togglePreview(l.id, !l.is_preview);
                        }}
                      >
                        <button
                          type="submit"
                          className="rounded-lg border px-3 py-1 text-xs hover:bg-white/20"
                        >
                          {l.is_preview
                            ? t("إلغاء المعاينة", "Unset preview")
                            : t("اجعلها معاينة", "Set preview")}
                        </button>
                      </form>
                      <form
                        action={async () => {
                          "use server";
                          await deleteLesson(l.id);
                        }}
                      >
                        <button
                          type="submit"
                          aria-label={t("حذف الدرس", "Delete lesson")}
                          className="rounded-lg border border-red-300 p-1.5 text-error hover:bg-red-50 dark:hover:bg-red-950"
                        >
                          <Trash2 size={14} />
                        </button>
                      </form>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-muted">
            {t("لم تُضف دروس بعد. ارفع أول درس أدناه.", "No lessons yet. Upload your first below.")}
          </p>
        )}

        {editable && (
          <div className="rounded-lg border bg-white/20 p-4 dark:bg-white/5">
            <h3 className="mb-3 text-sm font-semibold">
              {t("إضافة درس جديد", "Add a new lesson")}
            </h3>
            <LessonUploader
              courseId={id}
              dir={dir}
              lang={lang}
              ctaLabel={{ ar: "ارفع", en: "Upload" }}
              fileLabel={{ ar: "ملف الفيديو", en: "Video file" }}
              titleArLabel={t("عنوان الدرس (عربي)", "Lesson title (Arabic)")}
              titleEnLabel={t("عنوان الدرس (إنجليزي)", "Lesson title (English)")}
              previewLabel={t(
                "اجعل هذا الدرس معاينة مجانية",
                "Make this lesson a free preview",
              )}
              uploadingLabel={t("يتم الرفع...", "Uploading...")}
              doneLabel={t(
                "تم الرفع. سيتم معالجة الفيديو خلال دقائق.",
                "Uploaded. Video will be processed in a few minutes.",
              )}
              errorLabel={t("فشل الرفع", "Upload failed")}
            />
          </div>
        )}
      </section>

      {/* ── Submit for review ── */}
      {editable && (
        <section className="glass-card flex items-center justify-between p-6">
          <div>
            <h3 className="text-sm font-semibold">
              {t("جاهز للنشر؟", "Ready to publish?")}
            </h3>
            <p className="mt-1 text-xs text-muted">
              {t(
                "ستراجع إدارة الموقع الدورة قبل أن تظهر للطلاب",
                "Admin will review the course before students see it",
              )}
            </p>
          </div>
          <form
            action={async () => {
              "use server";
              await submitForReview(id);
            }}
          >
            <button
              type="submit"
              disabled={!submittable}
              className="flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <Send size={14} />
              {t("إرسال للمراجعة", "Submit for review")}
            </button>
          </form>
        </section>
      )}

      {/* ── Delete (drafts only) ── */}
      {course.status === "draft" && (
        <section className="mt-6 text-center">
          <form
            action={async () => {
              "use server";
              await deleteCourse(id);
            }}
          >
            <button
              type="submit"
              className="text-xs text-error hover:underline"
            >
              {t("حذف هذه المسودة", "Delete this draft")}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
