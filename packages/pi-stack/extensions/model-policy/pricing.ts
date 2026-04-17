/**
 * model-policy — pricing.ts
 *
 * Parser do llm-pricing-guide.md e cálculo de custo sintético.
 * Resolve preço por modelo independente do que o provider reporta
 * (subscription providers reportam cost.total = 0).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ModelPricing, PricingTable, TokenUsage, PricingConfig } from "./types.js";

// ═══════════════════════════════════════════════════════════════
// Defaults hardcoded (fallback quando guia não está disponível)
// Atualizar mensalmente via scheduler junto com llm-pricing-guide.md
// ═══════════════════════════════════════════════════════════════

const HARDCODED_DEFAULTS: PricingTable = {
  // Anthropic
  "anthropic/claude-opus-4.6":    { inputPerMTok: 5.00,   outputPerMTok: 25.00,  cacheReadPerMTok: 0.50,  cacheWritePerMTok: 6.25  },
  "anthropic/claude-sonnet-4.6":  { inputPerMTok: 3.00,   outputPerMTok: 15.00,  cacheReadPerMTok: 0.30,  cacheWritePerMTok: 3.75  },
  "anthropic/claude-sonnet-4.5":  { inputPerMTok: 3.00,   outputPerMTok: 15.00,  cacheReadPerMTok: 0.30,  cacheWritePerMTok: 3.75  },
  "anthropic/claude-haiku-4.5":   { inputPerMTok: 1.00,   outputPerMTok: 5.00,   cacheReadPerMTok: 0.10,  cacheWritePerMTok: 1.25  },
  "anthropic/claude-haiku-3":     { inputPerMTok: 0.25,   outputPerMTok: 1.25,   cacheReadPerMTok: 0.025, cacheWritePerMTok: 0.3125 },
  // Google
  "google/gemini-3.1-pro":        { inputPerMTok: 2.00,   outputPerMTok: 12.00,  cacheReadPerMTok: 0.20,  cacheWritePerMTok: 2.50  },
  "google/gemini-3-flash":        { inputPerMTok: 0.50,   outputPerMTok: 3.00,   cacheReadPerMTok: 0.05,  cacheWritePerMTok: 0.625 },
  "google/gemini-2.5-pro":        { inputPerMTok: 1.25,   outputPerMTok: 10.00,  cacheReadPerMTok: 0.125, cacheWritePerMTok: 1.5625 },
  "google/gemini-2.5-flash":      { inputPerMTok: 0.30,   outputPerMTok: 2.50,   cacheReadPerMTok: 0.03,  cacheWritePerMTok: 0.375 },
  "google/gemini-2.5-flash-lite": { inputPerMTok: 0.10,   outputPerMTok: 0.40,   cacheReadPerMTok: 0.01,  cacheWritePerMTok: 0.125 },
  // OpenAI
  "openai/o1-pro":                { inputPerMTok: 150.00, outputPerMTok: 600.00, cacheReadPerMTok: 15.00, cacheWritePerMTok: 187.50 },
  "openai/o1":                    { inputPerMTok: 15.00,  outputPerMTok: 60.00,  cacheReadPerMTok: 1.50,  cacheWritePerMTok: 18.75 },
  "openai/gpt-5.4":               { inputPerMTok: 2.50,   outputPerMTok: 15.00,  cacheReadPerMTok: 0.25,  cacheWritePerMTok: 3.125 },
  "openai/gpt-4o":                { inputPerMTok: 2.50,   outputPerMTok: 10.00,  cacheReadPerMTok: 0.25,  cacheWritePerMTok: 3.125 },
  "openai/gpt-5.4-mini":          { inputPerMTok: 0.75,   outputPerMTok: 4.50,   cacheReadPerMTok: 0.075, cacheWritePerMTok: 0.9375 },
  "openai/o3":                    { inputPerMTok: 0.40,   outputPerMTok: 1.60,   cacheReadPerMTok: 0.04,  cacheWritePerMTok: 0.50  },
  "openai/gpt-4.1-mini":          { inputPerMTok: 0.40,   outputPerMTok: 1.60,   cacheReadPerMTok: 0.04,  cacheWritePerMTok: 0.50  },
  "openai/gpt-4.1-nano":          { inputPerMTok: 0.10,   outputPerMTok: 0.40,   cacheReadPerMTok: 0.01,  cacheWritePerMTok: 0.125 },
  "openai/gpt-4o-mini":           { inputPerMTok: 0.15,   outputPerMTok: 0.60,   cacheReadPerMTok: 0.015, cacheWritePerMTok: 0.1875 },
};

// Alias normalization: alguns providers usam IDs diferentes do formato provider/model
const MODEL_ALIASES: Record<string, string> = {
  // github-copilot usa claude-sonnet-4.6 → normalizar
  "claude-sonnet-4.6":       "anthropic/claude-sonnet-4.6",
  "claude-sonnet-4-6":       "anthropic/claude-sonnet-4.6",
  "claude-haiku-4.5":        "anthropic/claude-haiku-4.5",
  "claude-haiku-4-5":        "anthropic/claude-haiku-4.5",
  "claude-opus-4.6":         "anthropic/claude-opus-4.6",
  "gemini-2.5-flash-lite":   "google/gemini-2.5-flash-lite",
  "gemini-2.5-flash":        "google/gemini-2.5-flash",
  "gemini-2.5-pro":          "google/gemini-2.5-pro",
  "gemini-3.1-pro":          "google/gemini-3.1-pro",
  "gpt-4o-mini":             "openai/gpt-4o-mini",
  "gpt-4.1-mini":            "openai/gpt-4.1-mini",
  "gpt-4.1-nano":            "openai/gpt-4.1-nano",
};

// ═══════════════════════════════════════════════════════════════
// Parser do llm-pricing-guide.md
// ═══════════════════════════════════════════════════════════════

/**
 * Extrai tabelas de preços das seções Anthropic, Google e OpenAI
 * do guia de preços. Formato esperado:
 * | Nome do Modelo | $X.XX | $Y.YY | ... |
 */
function parsePricingGuide(content: string): PricingTable {
  const table: PricingTable = {};

  // Mapeamento de prefixo de seção para provider
  const sections: Array<{ header: RegExp; provider: string }> = [
    { header: /## Anthropic/i,                provider: "anthropic" },
    { header: /## Google/i,                   provider: "google"    },
    { header: /## OpenAI/i,                   provider: "openai"    },
  ];

  for (const { header, provider } of sections) {
    // Localizar início da seção usando indexOf (sem regex dinâmico — evita ReDoS)
    const sectionStartTag = provider === "anthropic" ? "## Anthropic"
      : provider === "google" ? "## Google"
      : "## OpenAI";
    const sectionStart = content.indexOf(sectionStartTag);
    if (sectionStart === -1) continue;

    // Encontrar o próximo "## " após o início para delimitar a seção
    const nextSection = content.indexOf("\n## ", sectionStart + 1);
    const sectionText = nextSection !== -1
      ? content.slice(sectionStart, nextSection)
      : content.slice(sectionStart);

    // Parsear linhas de tabela: | Nome | $X.XX | $Y.YY | ... |
    const rowRe = /^\|([^|]+)\|\s*\$?([\d.]+)\s*\|\s*\$?([\d.]+)\s*\|/gm;
    let m: RegExpExecArray | null;

    while ((m = rowRe.exec(sectionText)) !== null) {
      const rawName = m[1].trim().replace(/\*\*/g, "").replace(/\(.*?\)/g, "").trim();
      const inputPrice = parseFloat(m[2]);
      const outputPrice = parseFloat(m[3]);

      if (isNaN(inputPrice) || isNaN(outputPrice)) continue;
      // Pular linhas de cabeçalho
      if (rawName.toLowerCase().includes("modelo") || rawName.toLowerCase().includes("model")) continue;

      // Normalizar nome do modelo
      const modelId = normalizeModelName(rawName, provider);
      if (!modelId) continue;

      table[modelId] = {
        inputPerMTok: inputPrice,
        outputPerMTok: outputPrice,
        // Cache derivado: 90% desconto no read, 25% premium no write
        cacheReadPerMTok: inputPrice * 0.10,
        cacheWritePerMTok: inputPrice * 1.25,
      };
    }
  }

  return table;
}

function normalizeModelName(rawName: string, provider: string): string | null {
  const name = rawName.toLowerCase()
    .replace(/\s*\/\s*.+$/, "")  // remover ">200K" etc
    .replace(/[≤>]/g, "")
    .trim();

  if (!name || name.length < 3) return null;

  // Construir ID no formato "provider/model-id"
  // Simplificar nome: remover palavras como "claude", "gemini", "gpt" para lookup
  const slug = name
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.-]/g, "");

  return `${provider}/${slug}`;
}

// ═══════════════════════════════════════════════════════════════
// Tabela de preços em memória (singleton por sessão)
// ═══════════════════════════════════════════════════════════════

let _pricingTable: PricingTable | null = null;
let _pricingConfig: PricingConfig | null = null;

export function loadPricingTable(config?: PricingConfig): PricingTable {
  if (_pricingTable) return _pricingTable;

  _pricingConfig = config ?? { cacheReadDiscount: 0.90, cacheWriteMultiplier: 1.25 };

  // Começar com defaults hardcoded
  const table: PricingTable = { ...HARDCODED_DEFAULTS };

  // Tentar parsear o guia de preços
  const guidePath = path.join(os.homedir(), ".pi", "llm-pricing-guide.md");
  if (fs.existsSync(guidePath)) {
    try {
      const content = fs.readFileSync(guidePath, "utf-8");
      const parsed = parsePricingGuide(content);
      // Merge: guia sobrescreve defaults onde reconhecido
      Object.assign(table, parsed);
    } catch {
      // Silencioso: fallback para hardcoded já está em table
    }
  }

  // Aplicar overrides explícitos do model-policy.json
  if (config?.overrides) {
    for (const [modelId, override] of Object.entries(config.overrides)) {
      table[modelId] = override;
    }
  }

  _pricingTable = table;
  return table;
}

export function invalidatePricingTable(): void {
  _pricingTable = null;
  _pricingConfig = null;
}

// ═══════════════════════════════════════════════════════════════
// Resolução de preço por model ID
// ═══════════════════════════════════════════════════════════════

/**
 * Retorna o preço para um model ID.
 * Tenta: lookup direto → alias → match parcial → fallback Sonnet.
 */
export function getPricing(modelId: string): ModelPricing {
  const table = _pricingTable ?? loadPricingTable();

  // 1. Lookup direto
  if (table[modelId]) return table[modelId];

  // 2. Alias
  const aliased = MODEL_ALIASES[modelId];
  if (aliased && table[aliased]) return table[aliased];

  // 3. Match parcial — encontrar o modelo mais específico que contém o ID
  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(table)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.split("/")[1] ?? "")) {
      return pricing;
    }
  }

  // 4. Fallback: Sonnet (modelo de referência)
  return (
    table["anthropic/claude-sonnet-4.6"] ??
    HARDCODED_DEFAULTS["anthropic/claude-sonnet-4.6"]
  );
}

// ═══════════════════════════════════════════════════════════════
// Cálculo de custo sintético
// ═══════════════════════════════════════════════════════════════

/**
 * Calcula custo sintético em USD para um conjunto de tokens.
 * Usado quando o provider reporta cost.total = 0 (subscription providers).
 */
export function calculateSyntheticCost(
  tokens: TokenUsage,
  pricing: ModelPricing
): number {
  return (
    tokens.input       * pricing.inputPerMTok       +
    tokens.output      * pricing.outputPerMTok      +
    tokens.cacheRead   * pricing.cacheReadPerMTok   +
    tokens.cacheWrite  * pricing.cacheWritePerMTok
  ) / 1_000_000;
}

/**
 * Retorna o custo efetivo:
 * - Se o provider reportou custo real (> 0), usa o reportado
 * - Senão, usa o sintético calculado a partir dos tokens
 */
export function effectiveCost(
  reportedCostUsd: number,
  tokens: TokenUsage,
  modelId: string
): { reported: number; synthetic: number; effective: number } {
  const pricing = getPricing(modelId);
  const synthetic = calculateSyntheticCost(tokens, pricing);
  const effective = reportedCostUsd > 0 ? reportedCostUsd : synthetic;
  return { reported: reportedCostUsd, synthetic, effective };
}

/**
 * Formata tabela de preços para exibição no /model-policy pricing
 */
export function formatPricingTable(): string {
  const table = _pricingTable ?? loadPricingTable();
  const lines = [
    "╭─ Tabela de Preços (USD/MTok) ───────────────────────────",
    "│",
    "│  Modelo                             Input    Output   CacheR   CacheW",
  ];

  const providers = ["anthropic", "google", "openai"];
  for (const provider of providers) {
    lines.push(`│`);
    lines.push(`│  ${provider.toUpperCase()}`);
    for (const [key, pricing] of Object.entries(table)) {
      if (!key.startsWith(provider + "/")) continue;
      const name = key.replace(provider + "/", "").padEnd(36);
      lines.push(
        `│  ${name}` +
        `$${pricing.inputPerMTok.toFixed(2).padStart(6)} ` +
        `$${pricing.outputPerMTok.toFixed(2).padStart(7)} ` +
        `$${pricing.cacheReadPerMTok.toFixed(3).padStart(7)} ` +
        `$${pricing.cacheWritePerMTok.toFixed(3).padStart(7)}`
      );
    }
  }

  lines.push("│");
  lines.push("│  Fonte: ~/.pi/llm-pricing-guide.md + defaults hardcoded");
  lines.push("╰────────────────────────────────────────────────────────");
  return lines.join("\n");
}
