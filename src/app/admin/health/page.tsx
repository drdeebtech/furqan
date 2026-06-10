import type { Metadata } from "next";
import {
  HEALTH_METRICS,
  COUPLING_ENTRIES,
  LAYER_HEALTH,
} from "@/data/graph-health-metrics";

export const metadata: Metadata = { title: "صحة الكود | FURQAN" };

const GITHUB_BASE = "https://github.com/drdeebtech/furqan/blob/main";

export default function CodeHealthPage() {
  const m = HEALTH_METRICS;
  const simpleFunctions = m.totalFunctions - m.complexFunctions;
  const coveragePct = m.testCoveragePercent.toFixed(1);

  return (
    <div dir="rtl" className="space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">صحة قاعدة الكود</h1>
        <p className="text-sm text-white/60 mt-0.5">Codebase Health</p>
        <p className="text-xs text-white/40 mt-1">
          آخر تحليل: {m.lastAnalyzedAt}
          <span className="mx-2 opacity-50">·</span>
          Last analyzed: {m.lastAnalyzedAt}
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Coverage */}
        <div className="glass-card p-5 text-center">
          <p className="text-2xl font-bold text-red-400">{coveragePct}%</p>
          <p className="text-sm text-white font-medium mt-0.5">التغطية</p>
          <p className="text-xs text-white/50">Test Coverage</p>
          <p className="text-xs text-white/40 mt-1">
            {m.testedFiles} / {m.srcFiles} ملف
          </p>
          <span className="inline-block mt-2 rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-300">
            منخفضة · Low
          </span>
        </div>

        {/* Functions */}
        <div className="glass-card p-5 text-center">
          <p className="text-2xl font-bold text-amber-400">{m.totalFunctions}</p>
          <p className="text-sm text-white font-medium mt-0.5">دالة</p>
          <p className="text-xs text-white/50">Functions</p>
          <p className="text-xs text-white/40 mt-1">
            <span className="text-orange-400">{m.complexFunctions}</span> معقدة ·{" "}
            <span className="text-green-400">{simpleFunctions}</span> بسيطة
          </p>
        </div>

        {/* Edges */}
        <div className="glass-card p-5 text-center">
          <p className="text-2xl font-bold text-blue-400">{m.totalEdges.toLocaleString()}</p>
          <p className="text-sm text-white font-medium mt-0.5">علاقة</p>
          <p className="text-xs text-white/50">Total Edges</p>
          <p className="text-xs text-white/40 mt-1">
            {m.importEdges.toLocaleString()} استيراد · imports
          </p>
        </div>

        {/* Tested-by edges */}
        <div className="glass-card p-5 text-center">
          <p className="text-2xl font-bold text-purple-400">{m.testedByEdges}</p>
          <p className="text-sm text-white font-medium mt-0.5">علاقة اختبار</p>
          <p className="text-xs text-white/50">Test Edges</p>
          <p className="text-xs text-white/40 mt-1">
            {m.testedByEdges} tested_by في الرسم البياني
          </p>
        </div>
      </div>

      {/* Highest Coupling Files table */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">أعلى ملفات الاقتران</h2>
          <p className="text-xs text-white/50 mt-0.5">Highest Coupling Files</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="glass-thead">
                <th className="px-5 py-3 text-start font-medium text-white/70">الملف · File</th>
                <th className="px-5 py-3 text-center font-medium text-white/70">المستوردون · Importers</th>
                <th className="px-5 py-3 text-center font-medium text-white/70">مُختبَر · Tested</th>
              </tr>
            </thead>
            <tbody>
              {COUPLING_ENTRIES.map((entry, idx) => (
                <tr
                  key={entry.filePath}
                  className={`border-t border-white/5 transition-colors hover:bg-white/5 ${
                    idx % 2 === 0 ? "" : "bg-white/[0.02]"
                  }`}
                >
                  <td className="px-5 py-3">
                    <a
                      href={`${GITHUB_BASE}/${entry.filePath}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 break-all"
                    >
                      {entry.filePath}
                    </a>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-white">
                      {entry.importerCount}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center text-base">
                    {entry.isTested ? "✅" : "❌"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Layer Coverage section */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-1">تغطية الطبقات</h2>
        <p className="text-xs text-white/50 mb-4">Layer Coverage</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {LAYER_HEALTH.map((layer) => {
            const pct = layer.totalFiles > 0
              ? Math.round((layer.testedFiles / layer.totalFiles) * 100)
              : 0;
            const barColor =
              pct >= 50
                ? "bg-green-400/70"
                : pct >= 20
                ? "bg-amber-400/70"
                : "bg-red-400/60";

            return (
              <div key={layer.name} className="glass-card p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white leading-tight">{layer.name}</p>
                    <p className="text-xs text-white/40 mt-0.5 truncate">{layer.description}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/70 whitespace-nowrap">
                    {layer.testedFiles} / {layer.totalFiles}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <div className="flex-1 bg-white/10 rounded-full h-2">
                    <div
                      className={`${barColor} h-2 rounded-full transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span dir="ltr" className="shrink-0 text-xs text-white/60 tabular-nums w-9 text-start">
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
