"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { sendNotification } from "./actions";

const input = "w-full rounded-xl glass-input px-4 py-3 text-sm text-foreground focus:border-gold focus:outline-none";

export function NotificationForm() {
  const [sent, setSent] = useState<{ count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const result = await sendNotification(formData);
    if (result.error) setError(result.error);
    else if (result.count) { setSent({ count: result.count }); e.currentTarget.reset(); }
    setLoading(false);
  }

  return (
    <div className="glass-card rounded-xl p-6">
      <h2 className="mb-4 text-lg font-bold">إرسال إشعار جديد</h2>

      {sent && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
          تم إرسال الإشعار إلى {sent.count} مستخدم بنجاح
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">المستهدفون</label>
          <select name="target" required className={input}>
            <option value="all">جميع المستخدمين</option>
            <option value="student">الطلاب فقط</option>
            <option value="teacher">المعلمون فقط</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">العنوان *</label>
          <input name="title" required className={input} placeholder="عنوان الإشعار" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">المحتوى</label>
          <textarea name="body" rows={3} className={`${input} resize-none`} placeholder="نص الإشعار..." />
        </div>
        <button type="submit" disabled={loading} className="flex items-center gap-2 glass-gold glass-pill px-6 py-2.5 font-semibold transition-colors disabled:opacity-50">
          <Send size={16} /> {loading ? "جاري الإرسال..." : "إرسال الإشعار"}
        </button>
      </form>
    </div>
  );
}
