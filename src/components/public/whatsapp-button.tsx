"use client";

import { MessageCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

const WHATSAPP_NUMBER = "0096598759229"; // TODO: replace with real number

export function WhatsAppButton() {
  const { t } = useLang();

  return (
    <a
      href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("أريد جلسة تجريبية مجانية")}`}
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
