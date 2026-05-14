"use client";

import { useState, useTransition } from "react";
import { Star, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { writeReview } from "@/lib/actions/course-reviews";

interface Props {
  courseId: string;
  existingStars?: number | null;
  existingComment?: string | null;
  labels: {
    title: string;
    placeholder: string;
    submit: string;
    update: string;
    saved: string;
  };
}

export function ReviewForm({
  courseId,
  existingStars,
  existingComment,
  labels,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [hover, setHover] = useState(0);
  const [stars, setStars] = useState(existingStars ?? 0);
  const [comment, setComment] = useState(existingComment ?? "");
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const handle = (formData: FormData) => {
    formData.set("course_id", courseId);
    formData.set("stars", String(stars));
    setStatus("idle");
    setError(null);
    startTransition(async () => {
      const res = await writeReview(formData);
      if (res.ok) {
        setStatus("ok");
      } else {
        setStatus("error");
        setError(res.error);
      }
    });
  };

  return (
    <form action={handle} className="space-y-3">
      <h3 className="text-sm font-semibold">{labels.title}</h3>

      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= (hover || stars);
          return (
            <button
              key={n}
              type="button"
              onClick={() => setStars(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              aria-label={`${n} stars`}
              className="rounded p-0.5 transition"
            >
              <Star
                size={22}
                className={
                  filled ? "text-warning" : "text-muted/40"
                }
                fill={filled ? "currentColor" : "none"}
              />
            </button>
          );
        })}
      </div>

      <textarea
        name="comment"
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={labels.placeholder}
        className="w-full rounded-lg border bg-white/40 px-3 py-2 text-sm dark:bg-white/5"
      />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending || stars < 1}
          className="flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending && <Loader2 size={14} className="animate-spin" />}
          {existingStars ? labels.update : labels.submit}
        </button>
        {status === "ok" && (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 size={12} />
            {labels.saved}
          </span>
        )}
        {status === "error" && error && (
          <span className="flex items-center gap-1 text-xs text-error">
            <AlertCircle size={12} />
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
