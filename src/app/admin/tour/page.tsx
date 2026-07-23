import type { Metadata } from "next";
import { TOUR_STEPS } from "@/data/codebase-tour";

export const metadata: Metadata = { title: "جولة في قاعدة الكود | FURQAN" };

export default function AdminTourPage() {
  return (
    <div dir="rtl" className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">
          جولة في قاعدة الكود
          <span className="ms-3 text-base font-normal text-white/50">Codebase Tour</span>
        </h1>
        <p className="mt-1 text-sm text-white/60">
          15 خطوة لفهم بنية FURQAN
          <span className="ms-2 text-white/40">15 steps to understand FURQAN&apos;s architecture</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {TOUR_STEPS.map((step) => (
          <div key={step.order} className="glass-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="glass-badge glass-gold text-xs px-2 py-0.5 rounded-full">
                {step.order}
              </span>
            </div>

            <h2 className="text-lg font-bold text-white">{step.titleAr}</h2>
            <p className="text-sm text-white/60 mb-3">{step.title}</p>

            <p className="text-sm text-white/75 leading-relaxed mb-4">
              {step.description}
            </p>

            <div className="flex flex-wrap gap-1.5">
              {step.files.map((file) => {
                // A trailing slash marks a directory reference (e.g.
                // "supabase/migrations/"). Directories need GitHub's /tree/ URL
                // and a real label — file.split("/").pop() alone yields "" here.
                const isDir = file.endsWith("/");
                const path = isDir ? file.slice(0, -1) : file;
                const kind = isDir ? "tree" : "blob";
                const name = path.split("/").pop() || path;
                return (
                  <a
                    key={file}
                    href={`https://github.com/drdeebtech/furqan/${kind}/main/${path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="glass-badge text-xs font-mono px-2 py-0.5 hover:opacity-80 transition-opacity"
                    dir="ltr"
                  >
                    {isDir ? `${name}/` : name}
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
