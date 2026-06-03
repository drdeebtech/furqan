export interface HealthMetrics {
  totalFiles: number;
  srcFiles: number;
  testedFiles: number;
  testCoveragePercent: number;
  totalFunctions: number;
  complexFunctions: number;
  totalEdges: number;
  importEdges: number;
  testedByEdges: number;
  lastAnalyzedAt: string;
}

export interface CouplingEntry {
  filePath: string;
  importerCount: number;
  isTested: boolean;
}

export interface LayerHealth {
  name: string;
  description: string;
  testedFiles: number;
  totalFiles: number;
}

export const HEALTH_METRICS: HealthMetrics = {
  totalFiles: 807,
  srcFiles: 662,
  testedFiles: 27,
  testCoveragePercent: 4.1,
  totalFunctions: 774,
  complexFunctions: 205,
  totalEdges: 3943,
  importEdges: 1953,
  testedByEdges: 29,
  lastAnalyzedAt: "2026-06-03",
};

export const COUPLING_ENTRIES: CouplingEntry[] = [
  { filePath: "src/lib/supabase/server.ts",          importerCount: 209, isTested: false },
  { filePath: "src/lib/i18n/context.tsx",            importerCount: 140, isTested: true  },
  { filePath: "src/lib/i18n/server.ts",              importerCount: 128, isTested: true  },
  { filePath: "src/lib/logger.ts",                   importerCount: 121, isTested: true  },
  { filePath: "src/types/database.ts",               importerCount:  96, isTested: false },
  { filePath: "src/lib/supabase/admin.ts",           importerCount:  76, isTested: true  },
  { filePath: "src/lib/supabase/typed-helpers.ts",   importerCount:  52, isTested: false },
  { filePath: "src/lib/actions/loud.ts",             importerCount:  50, isTested: true  },
  { filePath: "src/lib/auth/require-admin.ts",       importerCount:  39, isTested: true  },
  { filePath: "src/lib/automation/emit.ts",          importerCount:  35, isTested: true  },
  { filePath: "src/lib/notifications/dispatcher.ts", importerCount:  25, isTested: true  },
];

export const LAYER_HEALTH: LayerHealth[] = [
  { name: "Admin Dashboard",    description: "src/app/admin/**",                            testedFiles:  2, totalFiles: 174 },
  { name: "Service & Domain",   description: "src/lib/actions/**, src/lib/domains/**",      testedFiles:  8, totalFiles: 197 },
  { name: "Data Layer",         description: "supabase/migrations/**, src/types/**",        testedFiles:  5, totalFiles: 220 },
  { name: "Project Support",    description: ".claude/**, specs/**, docs/**",               testedFiles:  0, totalFiles: 328 },
  { name: "Teacher Dashboard",  description: "src/app/teacher/**",                          testedFiles:  2, totalFiles:  87 },
  { name: "Student Dashboard",  description: "src/app/student/**",                          testedFiles:  1, totalFiles:  69 },
  { name: "Public & Auth UI",   description: "src/app/(public)/**, src/app/(auth)/**",      testedFiles:  0, totalFiles:  88 },
  { name: "API Routes",         description: "src/app/api/**",                              testedFiles:  3, totalFiles:  40 },
  { name: "Tests",              description: "**/*.test.ts, e2e/**",                        testedFiles: 25, totalFiles:  25 },
  { name: "Infrastructure",     description: ".github/workflows/**, scripts/**",            testedFiles:  0, totalFiles:  26 },
];
