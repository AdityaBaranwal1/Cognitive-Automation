/**
 * Quick validation tests for the provider system redesign.
 * Run with: npx tsx src/lib/__tests__/provider-system.test.ts
 */

import { detectProviderFromKey } from "../functions/key-detection.service";
import { PROVIDER_PRESETS, KEY_PREFIX_MAP } from "../../config/provider-presets.constants";
import { presetToCurl, presetToProvider } from "../functions/preset-to-curl.function";
import { maskApiKey } from "../keychain/keychain.service";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

// ─── Key Detection Tests ───
console.log("\n=== Key Detection ===");

const antResult = detectProviderFromKey("sk-ant-abc123");
assert(antResult?.providerId === "claude", "sk-ant-* → Anthropic");
assert(antResult?.confidence === 100, "sk-ant-* confidence = 100");
assert(antResult?.needsProbe === false, "sk-ant-* no probe needed");

const orResult = detectProviderFromKey("sk-or-abc123");
assert(orResult?.providerId === "openrouter", "sk-or-* → OpenRouter");
assert(orResult?.confidence === 100, "sk-or-* confidence = 100");

const groqResult = detectProviderFromKey("gsk_abc123");
assert(groqResult?.providerId === "groq", "gsk_* → Groq");
assert(groqResult?.confidence === 100, "gsk_* confidence = 100");

const geminiResult = detectProviderFromKey("AIzaSyABC123");
assert(geminiResult?.providerId === "gemini", "AIza* → Gemini");
assert(geminiResult?.confidence === 95, "AIza* confidence = 95");

const pplxResult = detectProviderFromKey("pplx-abc123");
assert(pplxResult?.providerId === "perplexity", "pplx-* → Perplexity");

const xaiResult = detectProviderFromKey("xai-abc123");
assert(xaiResult?.providerId === "grok", "xai-* → Grok");

const projResult = detectProviderFromKey("sk-proj-abc123");
assert(projResult?.providerId === "openai", "sk-proj-* → OpenAI");
assert(projResult?.confidence === 100, "sk-proj-* confidence = 100");

// Ambiguous key
const ambigResult = detectProviderFromKey("sk-abc123");
assert(ambigResult?.providerId === "openai", "sk-* (generic) → OpenAI guess");
assert(ambigResult?.confidence === 30, "sk-* confidence = 30 (ambiguous)");
assert(ambigResult?.needsProbe === true, "sk-* needs probe");

// Unknown key
const unknownResult = detectProviderFromKey("totally-unknown-key");
assert(unknownResult === null, "Unknown prefix → null");

// Empty key
const emptyResult = detectProviderFromKey("");
assert(emptyResult === null, "Empty string → null");

// ─── Prefix Map Tests ───
console.log("\n=== Prefix Map ===");
assert(KEY_PREFIX_MAP.length > 0, "KEY_PREFIX_MAP is not empty");
// Should be sorted by prefix length (longest first)
for (let i = 1; i < KEY_PREFIX_MAP.length; i++) {
  assert(
    KEY_PREFIX_MAP[i].prefix.length <= KEY_PREFIX_MAP[i - 1].prefix.length,
    `Sorted: "${KEY_PREFIX_MAP[i - 1].prefix}" >= "${KEY_PREFIX_MAP[i].prefix}"`
  );
}

// ─── Provider Presets Tests ───
console.log("\n=== Provider Presets ===");
const presetIds = Object.keys(PROVIDER_PRESETS);
assert(presetIds.length >= 14, `${presetIds.length} presets defined (>= 14)`);

for (const id of presetIds) {
  const p = PROVIDER_PRESETS[id];
  assert(!!p.name, `${id}: has name "${p.name}"`);
  assert(!!p.baseUrl, `${id}: has baseUrl`);
  assert(!!p.chatEndpoint, `${id}: has chatEndpoint`);
  assert(!!p.responseContentPath, `${id}: has responseContentPath`);
}

// ─── Preset to Curl Tests ───
console.log("\n=== Preset → cURL ===");
const openaiCurl = presetToCurl(PROVIDER_PRESETS["openai"]);
assert(openaiCurl.includes("api.openai.com"), "OpenAI curl has correct URL");
assert(openaiCurl.includes("{{API_KEY}}"), "OpenAI curl has API_KEY placeholder");
assert(openaiCurl.includes("{{MODEL}}"), "OpenAI curl has MODEL placeholder");
assert(openaiCurl.includes("{{SYSTEM_PROMPT}}"), "OpenAI curl has SYSTEM_PROMPT");
assert(openaiCurl.includes("{{TEXT}}"), "OpenAI curl has TEXT placeholder");
assert(openaiCurl.includes("Bearer"), "OpenAI curl uses Bearer auth");

const claudeCurl = presetToCurl(PROVIDER_PRESETS["claude"]);
assert(claudeCurl.includes("api.anthropic.com"), "Anthropic curl has correct URL");
assert(claudeCurl.includes("x-api-key"), "Anthropic curl uses x-api-key auth");
assert(claudeCurl.includes("anthropic-version"), "Anthropic curl has version header");

const ollamaCurl = presetToCurl(PROVIDER_PRESETS["ollama"]);
assert(ollamaCurl.includes("localhost:11434"), "Ollama curl has localhost URL");

// ─── Preset to Provider Tests ───
console.log("\n=== Preset → Provider ===");
const openaiProvider = presetToProvider(PROVIDER_PRESETS["openai"], { API_KEY: "test", model: "gpt-4o" });
assert(openaiProvider.id === "openai", "Provider id = openai");
assert(openaiProvider.streaming === true, "Provider streaming = true");
assert(openaiProvider.responseContentPath === "choices[0].message.content", "Provider content path correct");
assert(openaiProvider.variables?.API_KEY === "test", "Provider variables injected");
assert(openaiProvider.curl.includes("api.openai.com"), "Provider curl correct");

// ─── Mask Key Tests ───
console.log("\n=== Key Masking ===");
assert(maskApiKey("sk-or-v1-abcdefghij1234567890") === "sk-o••••••••••••••••••••7890", "Long key masked correctly");
assert(maskApiKey("short") === "••••••••", "Short key fully masked");
assert(maskApiKey("12345678") === "••••••••", "8-char key fully masked");
assert(maskApiKey("123456789") === "1234•6789", "9-char key: 4 prefix + 1 dot + 4 suffix");

// ─── Summary ───
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All tests passed!");
}
