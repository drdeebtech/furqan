"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { createLesson } from "@/lib/actions/course-lessons";

interface Props {
  courseId: string;
  ctaLabel: { ar: string; en: string };
  fileLabel: { ar: string; en: string };
  titleArLabel: string;
  titleEnLabel: string;
  previewLabel: string;
  uploadingLabel: string;
  doneLabel: string;
  errorLabel: string;
  dir: "rtl" | "ltr";
  lang: "ar" | "en";
}

export function LessonUploader({
  courseId,
  ctaLabel,
  fileLabel,
  titleArLabel,
  titleEnLabel,
  previewLabel,
  uploadingLabel,
  doneLabel,
  errorLabel,
  dir,
  lang,
}: Props) {
  const router = useRouter();
  const [_isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const onSubmit = async (formData: FormData) => {
    setError(null);
    setStatus("idle");
    if (!file) {
      setError(lang === "ar" ? "اختر ملف فيديو" : "Choose a video file");
      return;
    }

    const result = await createLesson(courseId, formData);
    if (!result.ok || !result.lesson || !result.upload) {
      setStatus("error");
      setError(result.error ?? errorLabel);
      return;
    }

    setStatus("uploading");
    const cred = result.upload;
    const upload = new tus.Upload(file, {
      endpoint: cred.endpoint,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        AuthorizationSignature: cred.signature,
        AuthorizationExpire: String(cred.expirationTime),
        VideoId: cred.videoId,
        LibraryId: cred.libraryId,
      },
      metadata: {
        filetype: file.type,
        title: file.name,
      },
      onError(err) {
        setStatus("error");
        setError(err.message);
      },
      onProgress(uploaded, total) {
        setProgress(Math.round((uploaded / total) * 100));
      },
      onSuccess() {
        setStatus("done");
        setProgress(100);
        startTransition(() => {
          router.refresh();
        });
      },
    });
    upload.start();
  };

  return (
    <form action={onSubmit} dir={dir} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium">{titleArLabel} *</label>
        <input
          name="title_ar"
          required
          className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">{titleEnLabel}</label>
        <input
          name="title_en"
          className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">
          {fileLabel[lang]} *
        </label>
        <input
          type="file"
          accept="video/*"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" name="is_preview" />
        {previewLabel}
      </label>

      {status === "uploading" && progress !== null && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 size={14} className="animate-spin" />
          <span>
            {uploadingLabel} {progress}%
          </span>
        </div>
      )}
      {status === "done" && (
        <div className="flex items-center gap-2 text-xs text-emerald-600">
          <CheckCircle2 size={14} />
          {doneLabel}
        </div>
      )}
      {status === "error" && error && (
        <div className="flex items-center gap-2 text-xs text-red-600">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={status === "uploading"}
        className="flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        <Upload size={14} />
        {ctaLabel[lang]}
      </button>
    </form>
  );
}
