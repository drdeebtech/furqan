"use client";

import dynamic from "next/dynamic";

const WelcomePopup = dynamic(
  () => import("@/components/public/welcome-popup").then((m) => m.WelcomePopup),
  { ssr: false },
);

export function LazyWelcomePopup() {
  return <WelcomePopup />;
}
