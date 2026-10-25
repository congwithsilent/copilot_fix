#!/usr/bin/env node
/**
 * Summarize prompt-cache hit rates from the Copilot log file.
 *
 * The plugin logs one line per request when Debug logging is enabled:
 *   ... INFO [PromptCache] request snapshot {"model":"...","prefixHash":"..."}
 *   ... INFO [PromptCache] token usage {"inputTokens":...,"cachedInputTokens":...}
 *
 * Usage:
 *   node scripts/cache-hit-report.mjs "C:\path\to\vault\copilot\copilot-log.md"
 *
 * Notes:
 * - Open "Copilot log file" in Advanced settings first; the in-memory buffer is
 *   flushed to disk only when the file is opened.
 * - Hit rate = cachedInputTokens / inputTokens. Cache writes are reported
 *   separately because they are billed at a premium.
 */

import fs from "node:fs";

const logPath = process.argv[2];
if (!logPath) {
  console.error("Usage: node scripts/cache-hit-report.mjs <path-to-copilot-log.md>");
  process.exit(1);
}

const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
const requests = [];

let currentModel = "unknown";
for (const line of lines) {
  const snapshot = line.match(/\[PromptCache\] request snapshot (\{.*\})\s*$/);
  if (snapshot) {
    try {
      const data = JSON.parse(snapshot[1]);
      currentModel = data.model || "unknown";
    } catch {
      // Ignore malformed snapshot lines.
    }
    continue;
  }

  const usageMatch = line.match(/\[PromptCache\] token usage (\{.*\})\s*$/);
  if (!usageMatch) continue;

  try {
    const usage = JSON.parse(usageMatch[1]);
    requests.push({ model: currentModel, ...usage });
  } catch {
    // Ignore malformed usage lines.
  }
}

if (requests.length === 0) {
  console.log("No [PromptCache] token usage entries found.");
  console.log("Enable Debug logging, run a few turns, then open the Copilot log file.");
  process.exit(0);
}

const fmt = (value) => (typeof value === "number" ? value.toLocaleString() : "0");
const pct = (cached, input) =>
  input > 0 && typeof cached === "number" ? `${Math.round((cached / input) * 100)}%` : "n/a";

console.log("\nPer-request prompt-cache usage\n");
console.log(
  ["#", "model", "input", "cached", "hit", "cacheWrite", "output"].join("\t")
);
requests.forEach((request, index) => {
  console.log(
    [
      index + 1,
      request.model,
      fmt(request.inputTokens),
      fmt(request.cachedInputTokens),
      pct(request.cachedInputTokens, request.inputTokens),
      fmt(request.cacheWriteTokens),
      fmt(request.outputTokens),
    ].join("\t")
  );
});

const byModel = new Map();
for (const request of requests) {
  const entry = byModel.get(request.model) ?? {
    requests: 0,
    input: 0,
    cached: 0,
    write: 0,
    output: 0,
  };
  entry.requests += 1;
  entry.input += request.inputTokens ?? 0;
  entry.cached += request.cachedInputTokens ?? 0;
  entry.write += request.cacheWriteTokens ?? 0;
  entry.output += request.outputTokens ?? 0;
  byModel.set(request.model, entry);
}

console.log("\nSummary by model\n");
console.log(["model", "requests", "input", "cached", "hit", "cacheWrite"].join("\t"));
for (const [model, entry] of byModel) {
  console.log(
    [
      model,
      entry.requests,
      fmt(entry.input),
      fmt(entry.cached),
      pct(entry.cached, entry.input),
      fmt(entry.write),
    ].join("\t")
  );
}
