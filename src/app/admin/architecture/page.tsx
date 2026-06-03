import type { Metadata } from "next";
import { CODEBASE_LAYERS } from "@/data/codebase-layers";

export const metadata: Metadata = { title: "بنية قاعدة الكود | FURQAN" };

const COLOR_BORDER: Record<string, string> = {
  purple: "border-purple-400",
  blue:   "border-blue-400",
  green:  "border-green-400",
  teal:   "border-teal-400",
  orange: "border-orange-400",
  yellow: "border-yellow-400",
  red:    "border-red-400",
  pink:   "border-pink-400",
  gray:   "border-gray-400",
  indigo: "border-indigo-400",
};

const MAX_NODES = Math.max(...CODEBASE_LAYERS.map((l) => l.totalNodes));

const STATS = [
  { labelAr: "رمز", labelEn: "Nodes",      value: "2,048" },
  { labelAr: "علاقة", labelEn: "Edges",    value: "3,943" },
  { labelAr: "طبقات", labelEn: "Layers",   value: "10"    },
  { labelAr: "خطوة جولة", labelEn: "Tour Steps", value: "15" },
];

export default function ArchitecturePage() {
  return (
    <div dir="rtl" className="space-y-8 p-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">بنية قاعدة الكود</h1>
        <p className="text-sm text-foreground/60 mt-0.5">Codebase Architecture</p>
        <p className="text-xs text-foreground/40 mt-1">
          ٢٬٠٤٨ رمز · ٣٬٩٤٣ علاقة · ١٠ طبقات
          <span className="mx-2 opacity-50">·</span>
          2,048 symbols · 3,943 relationships · 10 layers
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STATS.map((s) => (
          <div key={s.labelEn} className="glass-card p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{s.value}</p>
            <p className="text-sm text-foreground font-medium mt-0.5">{s.labelAr}</p>
            <p className="text-xs text-foreground/50">{s.labelEn}</p>
          </div>
        ))}
      </div>

      {/* Layer cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CODEBASE_LAYERS.map((layer) => {
          const percent = Math.round((layer.totalNodes / MAX_NODES) * 100);
          const borderClass = COLOR_BORDER[layer.color] ?? "border-white/30";
          return (
            <div
              key={layer.id}
              className={`glass-card p-5 border-l-4 ${borderClass}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground leading-tight">
                    {layer.nameAr}
                  </p>
                  <p className="text-xs text-foreground/50 mt-0.5">{layer.name}</p>
                </div>
                <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs text-foreground/70 whitespace-nowrap">
                  {layer.totalNodes} رمز
                </span>
              </div>
              <p className="text-sm text-foreground/70 mt-2 leading-relaxed">
                {layer.description}
              </p>
              <div className="w-full bg-white/10 rounded-full h-2 mt-3">
                <div
                  className="bg-amber-400/70 h-2 rounded-full"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
