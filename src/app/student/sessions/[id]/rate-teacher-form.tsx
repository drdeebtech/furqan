"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { submitReview } from "./actions";

export function RateTeacherForm({
  sessionId,
  teacherName,
}: {
  sessionId: string;
  teacherName: string;
}) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (rating === 0) {
      setError("يرجى اختيار تقييم");
      return;
    }
    setLoading(true);
    setError(null);

    const result = await submitReview(
      sessionId,
      rating,
      comment.trim() || null,
    );

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
    }
  }

  if (success) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="mb-2 flex justify-center gap-1">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              size={24}
              className={i < rating ? "text-gold" : "text-muted"}
              fill={i < rating ? "currentColor" : "none"}
            />
          ))}
        </div>
        <p className="text-lg font-semibold text-gold">شكراً لتقييمك</p>
        <p className="mt-1 text-sm text-muted">
          تقييمك يساعد في تحسين جودة التعليم
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card p-5">
      <h2 className="mb-1 font-display text-sm font-semibold text-gold">
        قيّم جلستك مع {teacherName}
      </h2>
      <p className="mb-4 text-xs text-muted">كيف كانت تجربتك؟</p>

      {/* Star rating */}
      <div className="mb-4 flex gap-1">
        {Array.from({ length: 5 }, (_, i) => {
          const starValue = i + 1;
          const active = starValue <= (hovered || rating);
          return (
            <button
              key={i}
              type="button"
              onClick={() => setRating(starValue)}
              onMouseEnter={() => setHovered(starValue)}
              onMouseLeave={() => setHovered(0)}
              className="rounded-lg p-1 transition-transform hover:scale-110 focus-ring"
              aria-label={`${starValue} نجوم`}
            >
              <Star
                size={28}
                className={active ? "text-gold" : "text-muted/40"}
                fill={active ? "currentColor" : "none"}
              />
            </button>
          );
        })}
      </div>

      {/* Comment */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="أضف تعليقاً (اختياري)..."
        rows={3}
        className="mb-4 w-full resize-none rounded-xl glass-input px-4 py-3 text-sm placeholder:text-muted/60 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
      />

      {error && (
        <p className="mb-3 text-sm text-error">{error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || rating === 0}
        className="inline-flex items-center gap-2 glass-gold glass-pill px-6 py-2.5 text-sm font-semibold text-white transition-colors focus-ring disabled:opacity-50"
      >
        {loading ? "جاري الإرسال..." : "إرسال التقييم"}
      </button>
    </div>
  );
}
