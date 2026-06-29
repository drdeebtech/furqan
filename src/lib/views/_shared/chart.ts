// Shared chart-data helpers for dashboard analytics charts.
// Extracted from dashboard-queries.ts (#613) so both the student
// analytics chart and the admin daily-revenue chart share one source.

export interface ChartDataPoint {
  day: string;
  value: number;
  isActive: boolean;
}


export const EN_DAYS = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"];


export const AR_DAYS = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];


export function generateEmptyWeek(lang: "ar" | "en" = "en"): ChartDataPoint[] {
  const days = lang === "ar" ? AR_DAYS : EN_DAYS;
  // Start from Monday
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((i) => ({ day: days[i], value: 0, isActive: false }));
}


export function groupSessionsByDay(
  sessions: { actual_duration: number | null; started_at: string | null }[],
  lang: "ar" | "en" = "en"
): ChartDataPoint[] {
  const days = lang === "ar" ? AR_DAYS : EN_DAYS;
  const order = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun
  const buckets: Record<number, number> = {};
  for (const s of sessions) {
    if (!s.started_at) continue;
    const dayIndex = new Date(s.started_at).getDay();
    const hours = (s.actual_duration ?? 0) / 60;
    buckets[dayIndex] = (buckets[dayIndex] ?? 0) + hours;
  }

  const result = order.map((i) => ({
    day: days[i],
    value: Math.round((buckets[i] ?? 0) * 10) / 10,
    isActive: false,
  }));

  // Mark highest value day as active
  let maxVal = 0;
  let maxIdx = -1;
  for (let i = 0; i < result.length; i++) {
    if (result[i].value > maxVal) {
      maxVal = result[i].value;
      maxIdx = i;
    }
  }
  if (maxIdx >= 0) result[maxIdx].isActive = true;

  return result;
}


export function generateEmptyDay(): ChartDataPoint[] {
  // 8 buckets covering waking hours 8am–10pm in 2h steps; matches typical
  // study-session granularity better than 24 buckets and keeps bar widths
  // legible on mobile.
  const labels = ["8a", "10a", "12p", "2p", "4p", "6p", "8p", "10p"];
  return labels.map((day) => ({ day, value: 0, isActive: false }));
}


export function generateEmptyMonth(lang: "ar" | "en"): ChartDataPoint[] {
  const labels = lang === "ar"
    ? ["أ1", "أ2", "أ3", "أ4"]
    : ["W1", "W2", "W3", "W4"];
  return labels.map((day) => ({ day, value: 0, isActive: false }));
}


export function groupSessionsByHour(
  sessions: { actual_duration: number | null; started_at: string | null }[],
): ChartDataPoint[] {
  const labels = ["8a", "10a", "12p", "2p", "4p", "6p", "8p", "10p"];
  const buckets = labels.map(() => 0);

  // Only count "today" sessions
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  for (const s of sessions) {
    if (!s.started_at) continue;
    const d = new Date(s.started_at);
    if (d < today || d >= tomorrow) continue;
    const hour = d.getHours();
    // Bucket into the closest 2h slot starting at 8am
    const slot = Math.max(0, Math.min(7, Math.floor((hour - 8) / 2)));
    buckets[slot] += (s.actual_duration ?? 0) / 60;
  }

  const result = buckets.map((value, i) => ({
    day: labels[i],
    value: Math.round(value * 10) / 10,
    isActive: false,
  }));
  markPeak(result);
  return result;
}


export function groupSessionsByWeek(
  sessions: { actual_duration: number | null; started_at: string | null }[],
  lang: "ar" | "en",
): ChartDataPoint[] {
  const labels = lang === "ar"
    ? ["أ1", "أ2", "أ3", "أ4"]
    : ["W1", "W2", "W3", "W4"];
  const buckets = [0, 0, 0, 0];
  const now = Date.now();

  for (const s of sessions) {
    if (!s.started_at) continue;
    const ageDays = (now - new Date(s.started_at).getTime()) / 86400_000;
    if (ageDays < 0 || ageDays >= 28) continue;
    const week = Math.min(3, Math.floor(ageDays / 7)); // 0=this week, 3=4 weeks ago
    // Reverse so W1 is oldest, W4 is newest
    buckets[3 - week] += (s.actual_duration ?? 0) / 60;
  }

  const result = buckets.map((value, i) => ({
    day: labels[i],
    value: Math.round(value * 10) / 10,
    isActive: false,
  }));
  markPeak(result);
  return result;
}


export function markPeak(rows: ChartDataPoint[]): void {
  let maxVal = 0;
  let maxIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value > maxVal) {
      maxVal = rows[i].value;
      maxIdx = i;
    }
  }
  if (maxIdx >= 0) rows[maxIdx].isActive = true;
}

