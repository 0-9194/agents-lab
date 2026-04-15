/**
 * quota-visibility — consumer-side quota observability for pi sessions.
 * @capability-id quota-visibility-ops
 * @capability-criticality medium
 *
 * Why:
 * - Provider dashboards can be opaque for weekly quotas.
 * - Users need evidence (per-day, per-model, per-session outliers) to dispute spikes.
 * - Some providers enforce short rolling windows (ex.: 5h), so users need a
 *   peak-hours plan to decide when to start a window.
 *
 * Data source:
 * - ~/.pi/agent/sessions (arquivos .jsonl recursivos)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createReadStream, promises as fs, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";

type ProviderModel = string;
type ProviderWindowHours = Record<string, number>;

interface UsageBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costTotalUsd: number;
}

interface SessionSample {
  filePath: string;
  startedAtIso: string;
  userMessages: number;
  assistantMessages: number;
  toolResultMessages: number;
  usage: UsageBreakdown;
  byModel: Record<ProviderModel, UsageBreakdown & { assistantMessages: number }>;
}

interface ParsedSessionData {
  session: SessionSample;
  usageEvents: QuotaUsageEvent[];
}

interface DailyAggregate {
  day: string;
  sessions: number;
  assistantMessages: number;
  tokens: number;
  costUsd: number;
}

interface ModelAggregate extends UsageBreakdown {
  assistantMessages: number;
}

export interface QuotaUsageEvent {
  timestampIso: string;
  timestampMs: number;
  dayLocal: string;
  hourLocal: number;
  provider: string;
  model: string;
  tokens: number;
  costUsd: number;
  sessionFile: string;
}

interface RollingWindowSnapshot {
  startIso: string;
  endIso: string;
  tokens: number;
  costUsd: number;
}

export interface ProviderWindowInsight {
  provider: string;
  windowHours: number;
  observedMessages: number;
  observedTokens: number;
  observedCostUsd: number;
  recentWindow: RollingWindowSnapshot;
  maxWindowInRange?: RollingWindowSnapshot;
  peakHoursLocal: number[];
  highestDemandWindowStartsLocal: number[];
  lowestDemandWindowStartsLocal: number[];
  suggestedStartHoursBeforePeakLocal: number[];
  hourlyAvgTokens: number[];
  notes: string[];
}

interface QuotaStatus {
  source: {
    sessionsRoot: string;
    scannedFiles: number;
    parsedSessions: number;
    parsedEvents: number;
    windowDays: number;
    generatedAtIso: string;
  };
  totals: {
    sessions: number;
    userMessages: number;
    assistantMessages: number;
    toolResultMessages: number;
    tokens: number;
    costUsd: number;
  };
  burn: {
    activeDays: number;
    avgTokensPerActiveDay: number;
    avgTokensPerCalendarDay: number;
    projectedTokensNext7d: number;
    avgCostPerCalendarDay: number;
    projectedCostNext7dUsd: number;
  };
  quota: {
    weeklyTokens?: number;
    weeklyCostUsd?: number;
    usedPctTokens?: number;
    projectedPctTokens?: number;
    usedPctCost?: number;
    projectedPctCost?: number;
  };
  daily: DailyAggregate[];
  models: Array<{ model: string } & ModelAggregate>;
  providerWindows: ProviderWindowInsight[];
  topSessionsByTokens: SessionSample[];
  topSessionsByCost: SessionSample[];
}

interface QuotaVisibilitySettings {
  defaultDays?: number;
  weeklyQuotaTokens?: number;
  weeklyQuotaCostUsd?: number;
  providerWindowHours?: ProviderWindowHours;
}

const SETTINGS_PATH = ["piStack", "quotaVisibility"];
const DEFAULT_DAYS = 7;
const MAX_TOP = 10;
const SESSION_TS_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/;
const DEFAULT_PROVIDER_WINDOW_HOURS: ProviderWindowHours = {
  anthropic: 5,
  "openai-codex": 5,
};

export function safeNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function parseSessionStartFromFilename(fileName: string): Date | undefined {
  const m = fileName.match(SESSION_TS_RE);
  if (!m) return undefined;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function normalizeProvider(input: unknown): string {
  if (typeof input !== "string") return "unknown";
  const v = input.trim().toLowerCase();
  return v || "unknown";
}

function toDayLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nowLocalMidnight(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function hourLocal(d: Date): number {
  const h = d.getHours();
  return h >= 0 && h <= 23 ? h : 0;
}

function makeUsage(): UsageBreakdown {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotalUsd: 0 };
}

export function extractUsage(usage: unknown): UsageBreakdown {
  const u = (usage ?? {}) as Record<string, unknown>;
  const costObj = (u.cost ?? {}) as Record<string, unknown>;
  const directCost = typeof u.cost === "number" || typeof u.cost === "string" ? u.cost : undefined;

  const input = safeNum(u.input ?? u.inputTokens ?? u.input_tokens ?? u.promptTokens ?? u.prompt_tokens);
  const output = safeNum(u.output ?? u.outputTokens ?? u.output_tokens ?? u.completionTokens ?? u.completion_tokens);
  const cacheRead = safeNum(u.cacheRead ?? u.cache_read);
  const cacheWrite = safeNum(u.cacheWrite ?? u.cache_write);

  const explicitTotal = safeNum(u.totalTokens ?? u.total_tokens ?? u.tokenCount ?? u.token_count);
  const totalTokens = explicitTotal > 0 ? explicitTotal : input + output + cacheRead + cacheWrite;

  const costTotalUsd = safeNum(directCost ?? costObj.total ?? costObj.cost ?? costObj.usd);

  return { input, output, cacheRead, cacheWrite, totalTokens, costTotalUsd };
}

function mergeUsage(dst: UsageBreakdown, src: UsageBreakdown): void {
  dst.input += src.input;
  dst.output += src.output;
  dst.cacheRead += src.cacheRead;
  dst.cacheWrite += src.cacheWrite;
  dst.totalTokens += src.totalTokens;
  dst.costTotalUsd += src.costTotalUsd;
}

function parseTimestamp(raw: unknown, fallback: Date): Date {
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (Number.isFinite(d.getTime())) return d;
  }
  return fallback;
}

export function parseProviderWindowHours(input: unknown): ProviderWindowHours {
  if (!input || typeof input !== "object") return {};
  const out: ProviderWindowHours = {};

  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const provider = normalizeProvider(k);
    const hours = Math.floor(safeNum(v));
    if (!provider || provider === "unknown") continue;
    if (hours <= 0 || hours > 24) continue;
    out[provider] = hours;
  }

  return out;
}

export function computeWindowStartScores(hourlyAvgTokens: number[], windowHours: number): number[] {
  const hours = Math.max(1, Math.min(24, Math.floor(windowHours)));
  const out = Array.from({ length: 24 }, () => 0);

  for (let start = 0; start < 24; start++) {
    let sum = 0;
    for (let i = 0; i < hours; i++) {
      const idx = (start + i) % 24;
      sum += safeNum(hourlyAvgTokens[idx]);
    }
    out[start] = sum;
  }

  return out;
}

function rankHours(values: number[], count: number, mode: "desc" | "asc", requirePositive: boolean): number[] {
  const scored = values
    .map((value, hour) => ({ hour, value: safeNum(value) }))
    .filter((x) => (requirePositive ? x.value > 0 : true))
    .sort((a, b) => (mode === "desc" ? b.value - a.value : a.value - b.value) || a.hour - b.hour)
    .slice(0, count)
    .map((x) => x.hour);

  return scored;
}

function uniqueNumbers(xs: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const x of xs) {
    const n = ((x % 24) + 24) % 24;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function sumTokens(events: QuotaUsageEvent[]): number {
  return events.reduce((acc, e) => acc + e.tokens, 0);
}

function sumCost(events: QuotaUsageEvent[]): number {
  return events.reduce((acc, e) => acc + e.costUsd, 0);
}

function findMaxRollingWindow(eventsSorted: QuotaUsageEvent[], windowHours: number): RollingWindowSnapshot | undefined {
  if (eventsSorted.length === 0) return undefined;

  const windowMs = Math.max(1, Math.floor(windowHours)) * 60 * 60 * 1000;
  let left = 0;
  let sumTok = 0;
  let sumCostUsd = 0;

  let bestStart = eventsSorted[0].timestampMs;
  let bestEnd = eventsSorted[0].timestampMs;
  let bestTok = 0;
  let bestCostUsd = 0;

  for (let right = 0; right < eventsSorted.length; right++) {
    const curr = eventsSorted[right];
    sumTok += curr.tokens;
    sumCostUsd += curr.costUsd;

    while (left <= right && curr.timestampMs - eventsSorted[left].timestampMs > windowMs) {
      sumTok -= eventsSorted[left].tokens;
      sumCostUsd -= eventsSorted[left].costUsd;
      left += 1;
    }

    if (sumTok > bestTok || (sumTok === bestTok && sumCostUsd > bestCostUsd)) {
      bestTok = sumTok;
      bestCostUsd = sumCostUsd;
      bestStart = eventsSorted[left].timestampMs;
      bestEnd = curr.timestampMs;
    }
  }

  return {
    startIso: new Date(bestStart).toISOString(),
    endIso: new Date(bestEnd).toISOString(),
    tokens: bestTok,
    costUsd: bestCostUsd,
  };
}

export function buildProviderWindowInsight(
  provider: string,
  windowHours: number,
  events: QuotaUsageEvent[],
  calendarDays: number
): ProviderWindowInsight {
  const normalized = normalizeProvider(provider);
  const hours = Math.max(1, Math.min(24, Math.floor(windowHours)));
  const providerEvents = events
    .filter((e) => normalizeProvider(e.provider) === normalized)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const notes: string[] = [];
  const observedTokens = sumTokens(providerEvents);
  const observedCostUsd = sumCost(providerEvents);

  const windowMs = hours * 60 * 60 * 1000;
  const nowMs = Date.now();
  const cutoffMs = nowMs - windowMs;
  const recentEvents = providerEvents.filter((e) => e.timestampMs >= cutoffMs);

  const recentWindow: RollingWindowSnapshot = {
    startIso: new Date(cutoffMs).toISOString(),
    endIso: new Date(nowMs).toISOString(),
    tokens: sumTokens(recentEvents),
    costUsd: sumCost(recentEvents),
  };

  const hourlyTotals = Array.from({ length: 24 }, () => 0);
  for (const e of providerEvents) hourlyTotals[e.hourLocal] += e.tokens;
  const denomDays = Math.max(1, Math.floor(calendarDays));
  const hourlyAvgTokens = hourlyTotals.map((v) => v / denomDays);

  const peakHoursLocal = rankHours(hourlyAvgTokens, 3, "desc", true);
  const startScores = computeWindowStartScores(hourlyAvgTokens, hours);
  const highestDemandWindowStartsLocal = rankHours(startScores, 3, "desc", true);
  const lowestDemandWindowStartsLocal = rankHours(startScores, 3, "asc", false);
  const suggestedStartHoursBeforePeakLocal = uniqueNumbers(
    peakHoursLocal.map((h) => h - hours)
  );

  const maxWindowInRange = findMaxRollingWindow(providerEvents, hours);

  if (providerEvents.length === 0) {
    notes.push("No usage events found in range for this provider.");
    notes.push("Keep monitoring until enough history exists to estimate peak hours.");
  } else {
    if (observedTokens === 0) {
      notes.push("Provider events exist but token usage fields were empty/zero.");
    }
    if (peakHoursLocal.length > 0) {
      notes.push("Peak hours are historical tendencies, not provider-guaranteed limits.");
      notes.push("For strict 5h windows, starting before predicted peaks can protect productive time.");
    }
  }

  return {
    provider: normalized,
    windowHours: hours,
    observedMessages: providerEvents.length,
    observedTokens,
    observedCostUsd,
    recentWindow,
    maxWindowInRange,
    peakHoursLocal,
    highestDemandWindowStartsLocal,
    lowestDemandWindowStartsLocal,
    suggestedStartHoursBeforePeakLocal,
    hourlyAvgTokens,
    notes,
  };
}

async function walkJsonlFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Awaited<ReturnType<typeof fs.readdir>> = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(p);
    }
  }

  return out;
}

function readSettings(cwd: string): QuotaVisibilitySettings {
  try {
    const p = path.join(cwd, ".pi", "settings.json");
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const nested = SETTINGS_PATH.reduce<unknown>((acc, key) => {
      if (!acc || typeof acc !== "object") return undefined;
      return (acc as Record<string, unknown>)[key];
    }, raw);

    if (!nested || typeof nested !== "object") return {};
    const cfg = nested as Record<string, unknown>;

    return {
      defaultDays: safeNum(cfg.defaultDays) || undefined,
      weeklyQuotaTokens: safeNum(cfg.weeklyQuotaTokens) || undefined,
      weeklyQuotaCostUsd: safeNum(cfg.weeklyQuotaCostUsd) || undefined,
      providerWindowHours: parseProviderWindowHours(cfg.providerWindowHours),
    };
  } catch {
    return {};
  }
}

async function parseSessionFile(filePath: string): Promise<ParsedSessionData | undefined> {
  const fileName = path.basename(filePath);
  let startedAt = parseSessionStartFromFilename(fileName);

  const usageTotal = makeUsage();
  const byModel = new Map<string, ModelAggregate>();
  const usageEvents: QuotaUsageEvent[] = [];

  let userMessages = 0;
  let assistantMessages = 0;
  let toolResultMessages = 0;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }

      if (obj?.type === "session") {
        if (!startedAt && typeof obj.timestamp === "string") {
          const d = new Date(obj.timestamp);
          if (Number.isFinite(d.getTime())) startedAt = d;
        }
        continue;
      }

      if (obj?.type !== "message") continue;
      const msg = obj.message ?? {};
      const role = typeof msg.role === "string" ? msg.role : undefined;
      if (role === "user") {
        userMessages += 1;
        continue;
      }
      if (role === "toolResult") {
        toolResultMessages += 1;
        continue;
      }
      if (role !== "assistant") continue;

      assistantMessages += 1;

      const provider = normalizeProvider(
        typeof obj.provider === "string" ? obj.provider : msg.provider
      );
      const model = typeof obj.model === "string"
        ? obj.model
        : typeof msg.model === "string"
          ? msg.model
          : typeof obj.modelId === "string"
            ? obj.modelId
            : typeof msg.modelId === "string"
              ? msg.modelId
              : "unknown";
      const modelKey = `${provider}/${model}`;

      const usage = extractUsage(obj.usage ?? msg.usage);
      mergeUsage(usageTotal, usage);

      const curr = byModel.get(modelKey) ?? { ...makeUsage(), assistantMessages: 0 };
      mergeUsage(curr, usage);
      curr.assistantMessages += 1;
      byModel.set(modelKey, curr);

      const baseTime = startedAt ?? new Date();
      const ts = parseTimestamp(obj.timestamp ?? msg.timestamp, baseTime);

      usageEvents.push({
        timestampIso: ts.toISOString(),
        timestampMs: ts.getTime(),
        dayLocal: toDayLocal(ts),
        hourLocal: hourLocal(ts),
        provider,
        model,
        tokens: usage.totalTokens,
        costUsd: usage.costTotalUsd,
        sessionFile: filePath,
      });
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  if (!startedAt) return undefined;

  const byModelObj: Record<string, ModelAggregate> = {};
  for (const [k, v] of byModel.entries()) byModelObj[k] = v;

  return {
    session: {
      filePath,
      startedAtIso: startedAt.toISOString(),
      userMessages,
      assistantMessages,
      toolResultMessages,
      usage: usageTotal,
      byModel: byModelObj,
    },
    usageEvents,
  };
}

export function buildQuotaStatus(
  sessions: SessionSample[],
  usageEvents: QuotaUsageEvent[],
  params: {
    days: number;
    sessionsRoot: string;
    scannedFiles: number;
    weeklyQuotaTokens?: number;
    weeklyQuotaCostUsd?: number;
    providerWindowHours: ProviderWindowHours;
  }
): QuotaStatus {
  const totals = {
    sessions: sessions.length,
    userMessages: 0,
    assistantMessages: 0,
    toolResultMessages: 0,
    tokens: 0,
    costUsd: 0,
  };

  const byDay = new Map<string, DailyAggregate>();
  const byModel = new Map<string, ModelAggregate>();

  for (const s of sessions) {
    totals.userMessages += s.userMessages;
    totals.assistantMessages += s.assistantMessages;
    totals.toolResultMessages += s.toolResultMessages;
    totals.tokens += s.usage.totalTokens;
    totals.costUsd += s.usage.costTotalUsd;

    const day = toDayLocal(new Date(s.startedAtIso));
    const dayAgg = byDay.get(day) ?? { day, sessions: 0, assistantMessages: 0, tokens: 0, costUsd: 0 };
    dayAgg.sessions += 1;
    dayAgg.assistantMessages += s.assistantMessages;
    dayAgg.tokens += s.usage.totalTokens;
    dayAgg.costUsd += s.usage.costTotalUsd;
    byDay.set(day, dayAgg);

    for (const [mk, v] of Object.entries(s.byModel)) {
      const acc = byModel.get(mk) ?? { ...makeUsage(), assistantMessages: 0 };
      mergeUsage(acc, v);
      acc.assistantMessages += v.assistantMessages;
      byModel.set(mk, acc);
    }
  }

  const activeDays = Math.max(1, byDay.size);
  const avgTokensPerActiveDay = totals.tokens / activeDays;
  const avgTokensPerCalendarDay = totals.tokens / Math.max(1, params.days);
  const projectedTokensNext7d = avgTokensPerCalendarDay * 7;
  const avgCostPerCalendarDay = totals.costUsd / Math.max(1, params.days);
  const projectedCostNext7dUsd = avgCostPerCalendarDay * 7;

  const usedPctTokens = params.weeklyQuotaTokens ? (totals.tokens / params.weeklyQuotaTokens) * 100 : undefined;
  const projectedPctTokens = params.weeklyQuotaTokens ? (projectedTokensNext7d / params.weeklyQuotaTokens) * 100 : undefined;
  const usedPctCost = params.weeklyQuotaCostUsd ? (totals.costUsd / params.weeklyQuotaCostUsd) * 100 : undefined;
  const projectedPctCost = params.weeklyQuotaCostUsd ? (projectedCostNext7dUsd / params.weeklyQuotaCostUsd) * 100 : undefined;

  const topSessionsByTokens = [...sessions]
    .sort((a, b) => b.usage.totalTokens - a.usage.totalTokens)
    .slice(0, MAX_TOP);

  const topSessionsByCost = [...sessions]
    .sort((a, b) => b.usage.costTotalUsd - a.usage.costTotalUsd)
    .slice(0, MAX_TOP);

  const providerWindows = Object.entries(params.providerWindowHours)
    .map(([provider, hours]) => buildProviderWindowInsight(provider, hours, usageEvents, params.days))
    .sort((a, b) => b.observedTokens - a.observedTokens);

  return {
    source: {
      sessionsRoot: params.sessionsRoot,
      scannedFiles: params.scannedFiles,
      parsedSessions: sessions.length,
      parsedEvents: usageEvents.length,
      windowDays: params.days,
      generatedAtIso: new Date().toISOString(),
    },
    totals,
    burn: {
      activeDays,
      avgTokensPerActiveDay,
      avgTokensPerCalendarDay,
      projectedTokensNext7d,
      avgCostPerCalendarDay,
      projectedCostNext7dUsd,
    },
    quota: {
      weeklyTokens: params.weeklyQuotaTokens,
      weeklyCostUsd: params.weeklyQuotaCostUsd,
      usedPctTokens,
      projectedPctTokens,
      usedPctCost,
      projectedPctCost,
    },
    daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    models: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    providerWindows,
    topSessionsByTokens,
    topSessionsByCost,
  };
}

async function analyzeQuota(
  params: {
    days: number;
    weeklyQuotaTokens?: number;
    weeklyQuotaCostUsd?: number;
    providerWindowHours: ProviderWindowHours;
  }
): Promise<QuotaStatus> {
  const sessionsRoot = path.join(homedir(), ".pi", "agent", "sessions");
  const files = await walkJsonlFiles(sessionsRoot);

  const now = nowLocalMidnight();
  const start = addDays(now, -(params.days - 1));

  const filtered = files.filter((f) => {
    const d = parseSessionStartFromFilename(path.basename(f));
    if (!d) return true;
    return d >= start;
  });

  const sessions: SessionSample[] = [];
  const usageEvents: QuotaUsageEvent[] = [];

  for (const filePath of filtered) {
    const parsed = await parseSessionFile(filePath);
    if (!parsed) continue;

    if (new Date(parsed.session.startedAtIso) < start) continue;
    sessions.push(parsed.session);
    usageEvents.push(...parsed.usageEvents);
  }

  return buildQuotaStatus(sessions, usageEvents, {
    days: params.days,
    sessionsRoot,
    scannedFiles: filtered.length,
    weeklyQuotaTokens: params.weeklyQuotaTokens,
    weeklyQuotaCostUsd: params.weeklyQuotaCostUsd,
    providerWindowHours: params.providerWindowHours,
  });
}

function pct(v?: number): string {
  if (v === undefined || !Number.isFinite(v)) return "n/a";
  return `${v.toFixed(1)}%`;
}

function money(v: number): string {
  if (!Number.isFinite(v)) return "$0.0000";
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

function hh(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  return `${String(h).padStart(2, "0")}:00`;
}

function hourList(hours: number[]): string {
  if (!hours || hours.length === 0) return "n/a";
  return hours.map(hh).join(", ");
}

function formatWindowInsightLine(w: ProviderWindowInsight): string {
  if (w.observedMessages === 0) {
    return `  - ${w.provider} (${w.windowHours}h): sem eventos no período (monitoramento ativo)`;
  }

  const maxTok = w.maxWindowInRange?.tokens ?? 0;
  return [
    `  - ${w.provider} (${w.windowHours}h): recent=${fmt(w.recentWindow.tokens)} tok, max=${fmt(maxTok)} tok`,
    `    peak horas: ${hourList(w.peakHoursLocal)} | iniciar antes do pico: ${hourList(w.suggestedStartHoursBeforePeakLocal)}`,
    `    início mais carregado: ${hourList(w.highestDemandWindowStartsLocal)} | início menos carregado: ${hourList(w.lowestDemandWindowStartsLocal)}`,
  ].join("\n");
}

function formatStatusReport(s: QuotaStatus): string {
  const lines: string[] = [];
  lines.push("quota-visibility");
  lines.push(`window: ${s.source.windowDays}d | sessions: ${s.totals.sessions} | files: ${s.source.scannedFiles} | events: ${s.source.parsedEvents}`);
  lines.push(`tokens: ${fmt(s.totals.tokens)} | cost: ${money(s.totals.costUsd)} | assistant msgs: ${fmt(s.totals.assistantMessages)}`);
  lines.push(`burn/day (calendar): ${fmt(s.burn.avgTokensPerCalendarDay)} tokens | proj 7d: ${fmt(s.burn.projectedTokensNext7d)} tokens`);
  lines.push(`burn/day (cost): ${money(s.burn.avgCostPerCalendarDay)} | proj 7d cost: ${money(s.burn.projectedCostNext7dUsd)}`);

  if (s.quota.weeklyTokens || s.quota.weeklyCostUsd) {
    lines.push("quota target:");
    if (s.quota.weeklyTokens) {
      lines.push(`  weekly tokens: ${fmt(s.quota.weeklyTokens)} | used: ${pct(s.quota.usedPctTokens)} | projected: ${pct(s.quota.projectedPctTokens)}`);
    }
    if (s.quota.weeklyCostUsd) {
      lines.push(`  weekly usd: ${money(s.quota.weeklyCostUsd)} | used: ${pct(s.quota.usedPctCost)} | projected: ${pct(s.quota.projectedPctCost)}`);
    }
  }

  const topModel = s.models[0];
  if (topModel) lines.push(`top model: ${topModel.model} (${fmt(topModel.totalTokens)} tokens, ${money(topModel.costTotalUsd)})`);

  const topSession = s.topSessionsByTokens[0];
  if (topSession) {
    lines.push(`top session: ${path.basename(topSession.filePath)} (${fmt(topSession.usage.totalTokens)} tokens, ${money(topSession.usage.costTotalUsd)})`);
  }

  if (s.providerWindows.length > 0) {
    lines.push("provider windows / peak planning:");
    for (const w of s.providerWindows) lines.push(formatWindowInsightLine(w));
  }

  return lines.join("\n");
}

function formatWindowsReport(s: QuotaStatus, provider?: string): string {
  const normalized = provider ? normalizeProvider(provider) : undefined;
  const rows = normalized
    ? s.providerWindows.filter((w) => w.provider === normalized)
    : s.providerWindows;

  if (rows.length === 0) {
    return normalized
      ? `quota-visibility windows: provider '${normalized}' não configurado.`
      : "quota-visibility windows: sem providers configurados.";
  }

  const lines: string[] = [];
  lines.push(`quota-visibility windows (${s.source.windowDays}d)`);
  for (const w of rows) lines.push(formatWindowInsightLine(w));
  return lines.join("\n");
}

async function writeEvidenceBundle(ctx: ExtensionContext, report: QuotaStatus): Promise<string> {
  const dir = path.join(ctx.cwd, ".pi", "reports");
  await fs.mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(dir, `quota-visibility-${stamp}.json`);
  await fs.writeFile(out, JSON.stringify(report, null, 2), "utf8");
  return out;
}

function parseDays(raw?: string): number | undefined {
  if (!raw) return undefined;
  const n = Math.floor(safeNum(raw));
  if (n <= 0) return undefined;
  return n;
}

export default function quotaVisibilityExtension(pi: ExtensionAPI) {
  const cache = new Map<string, { at: number; value: QuotaStatus }>();

  async function getStatus(
    ctx: ExtensionContext,
    args: {
      days?: number;
      weeklyQuotaTokens?: number;
      weeklyQuotaCostUsd?: number;
      providerWindowHoursOverride?: ProviderWindowHours;
    }
  ) {
    const cfg = readSettings(ctx.cwd);
    const days = Math.max(1, Math.min(90, Math.floor(args.days ?? cfg.defaultDays ?? DEFAULT_DAYS)));
    const weeklyQuotaTokens = args.weeklyQuotaTokens ?? cfg.weeklyQuotaTokens;
    const weeklyQuotaCostUsd = args.weeklyQuotaCostUsd ?? cfg.weeklyQuotaCostUsd;

    const providerWindowHours: ProviderWindowHours = {
      ...DEFAULT_PROVIDER_WINDOW_HOURS,
      ...(cfg.providerWindowHours ?? {}),
      ...(args.providerWindowHoursOverride ?? {}),
    };

    const key = JSON.stringify({ days, weeklyQuotaTokens, weeklyQuotaCostUsd, providerWindowHours });
    const prev = cache.get(key);
    if (prev && Date.now() - prev.at < 30_000) return prev.value;

    const status = await analyzeQuota({
      days,
      weeklyQuotaTokens,
      weeklyQuotaCostUsd,
      providerWindowHours,
    });
    cache.set(key, { at: Date.now(), value: status });
    return status;
  }

  pi.registerTool({
    name: "quota_visibility_status",
    label: "Quota Visibility Status",
    description: "Analyze local pi session usage and estimate weekly quota burn (tokens/cost + provider windows).",
    parameters: Type.Object({
      days: Type.Optional(Type.Number({ minimum: 1, maximum: 90 })),
      weeklyQuotaTokens: Type.Optional(Type.Number({ minimum: 1 })),
      weeklyQuotaCostUsd: Type.Optional(Type.Number({ minimum: 0.01 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { days?: number; weeklyQuotaTokens?: number; weeklyQuotaCostUsd?: number };
      const status = await getStatus(ctx, p);
      return {
        content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
        details: status,
      };
    },
  });

  pi.registerTool({
    name: "quota_visibility_windows",
    label: "Quota Visibility Windows",
    description: "Show provider rolling-window/peak-hour insights (e.g., 5h Anthropic/Codex planning).", 
    parameters: Type.Object({
      days: Type.Optional(Type.Number({ minimum: 1, maximum: 90 })),
      provider: Type.Optional(Type.String()),
      windowHours: Type.Optional(Type.Number({ minimum: 1, maximum: 24 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { days?: number; provider?: string; windowHours?: number };
      const override: ProviderWindowHours = {};
      if (p.provider && p.windowHours) {
        override[normalizeProvider(p.provider)] = Math.floor(p.windowHours);
      }

      const status = await getStatus(ctx, {
        days: p.days,
        providerWindowHoursOverride: Object.keys(override).length > 0 ? override : undefined,
      });

      const normalized = p.provider ? normalizeProvider(p.provider) : undefined;
      const data = normalized
        ? status.providerWindows.filter((w) => w.provider === normalized)
        : status.providerWindows;

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { provider: normalized, data },
      };
    },
  });

  pi.registerTool({
    name: "quota_visibility_export",
    label: "Quota Visibility Export",
    description: "Export a quota evidence JSON report under .pi/reports for provider dispute/audit.",
    parameters: Type.Object({
      days: Type.Optional(Type.Number({ minimum: 1, maximum: 90 })),
      weeklyQuotaTokens: Type.Optional(Type.Number({ minimum: 1 })),
      weeklyQuotaCostUsd: Type.Optional(Type.Number({ minimum: 0.01 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { days?: number; weeklyQuotaTokens?: number; weeklyQuotaCostUsd?: number };
      const status = await getStatus(ctx, p);
      const outputPath = await writeEvidenceBundle(ctx, status);
      return {
        content: [{ type: "text", text: `Exported quota evidence: ${outputPath}` }],
        details: { outputPath, status },
      };
    },
  });

  pi.registerCommand("quota-visibility", {
    description: "Consumer quota observability from ~/.pi sessions (status/windows/export).",
    handler: async (args, ctx) => {
      const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const cmd = (tokens[0] ?? "status").toLowerCase();

      if (cmd === "status") {
        const days = parseDays(tokens[1]);
        const status = await getStatus(ctx, { days });
        ctx.ui.notify(formatStatusReport(status), "info");
        return;
      }

      if (cmd === "windows") {
        const maybeProvider = tokens[1];
        const maybeDays = tokens[2];

        let provider: string | undefined;
        let days: number | undefined;

        if (maybeProvider && parseDays(maybeProvider) === undefined) {
          provider = maybeProvider;
          days = parseDays(maybeDays);
        } else {
          days = parseDays(maybeProvider);
        }

        const status = await getStatus(ctx, { days });
        ctx.ui.notify(formatWindowsReport(status, provider), "info");
        return;
      }

      if (cmd === "export") {
        const days = parseDays(tokens[1]);
        const status = await getStatus(ctx, { days });
        const out = await writeEvidenceBundle(ctx, status);
        ctx.ui.notify(`quota-visibility export criado em:\n${out}`, "info");
        return;
      }

      ctx.ui.notify("Usage: /quota-visibility <status|windows|export> [provider] [days]", "warning");
    },
  });
}
