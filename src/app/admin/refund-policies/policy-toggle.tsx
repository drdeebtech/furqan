"use client";
import { useState } from "react";
import { togglePolicyActive } from "./actions";

export function PolicyToggle({ policyId, isActive }: { policyId: string; isActive: boolean }) {
  const [active, setActive] = useState(isActive);
  return (
    <button
      onClick={async () => { setActive(!active); await togglePolicyActive(policyId, !active); }}
      className={`glass-badge ${active ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-red-500/10 text-red-400 border-red-500/30"}`}
    >
      {active ? "مفعّل" : "معطل"}
    </button>
  );
}
