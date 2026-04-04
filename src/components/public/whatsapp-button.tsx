"use client";

import { MessageCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

export function WhatsAppButton() {
  const { t } = useLang();

  return (
    <a
      href="https://wa.me/447400000000?text=%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%AC%D9%84%D8%B3%D8%A9%20%D8%AA%D8%AC%D8%B1%D9%8A%D8%A8%D9%8A%D8%A9%20%D9%85%D8%AC%D8%A7%D9%86%D9%8A%D8%A9"
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 left-6 z-50 flex items-center gap-2 rounded-full bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-green-700"
      aria-label="WhatsApp"
    >
      <MessageCircle size={20} />
      <span className="hidden sm:inline">{t("تحدث معنا", "Chat with us")}</span>
    </a>
  );
}
