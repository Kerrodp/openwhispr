const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAudioManager } = require("./harness/audioManager");

// Pin both cleanup routes against bridge defaults (local: 0.7, Anthropic/enterprise: 0.3).
// Only direct Gemini defers to model defaults; stale provider selections must not leak.
async function loadRouteResolver(t, provider = "test", mode = "providers") {
  const { vite } = await loadAudioManager(t, {
    cachePrefix: "openwhispr-cleanup-route-config-test-",
    settingsKey: "__cleanupRouteConfigSettings",
    mockModules: {
      "/stores/settingsStore": `
        export const getSettings = () => globalThis.__cleanupRouteConfigSettings;
        export const getEffectiveCleanupModel = () => "cleanup-model";
        export const selectResolvedLLMConfig = () => ({ model: "cleanup-model", provider: ${JSON.stringify(provider)}, mode: ${JSON.stringify(mode)} });
        export const isCloudCleanupMode = () => false;
        export const isCloudDictationAgentMode = () => false;
        export const isCloudTranslationMode = () => false;
      `,
      "/dictationAgentInference": `
        export const resolveDictationAgentInference = () => ({
          reachable: true,
          model: "agent-model",
          displayProvider: "test",
          config: { provider: "test" },
        });
        export const resolveDictationAgentVisionInference = () => ({
          active: false,
          model: "",
          config: {},
        });
      `,
      "/dictationTranslationInference": `
        export const resolveDictationTranslationInference = () => ({
          reachable: true,
          model: "translate-model",
          displayProvider: "test",
          config: { provider: "test" },
        });
      `,
      "/config/prompts": `
        export const resolvePrompt = () => "route prompt";
        export const appendScreenContextSuffix = (prompt) => prompt;
        export const wrapCleanupTranscript = (text) => text;
        export const getCleanupSystemPrompt = () => "cleanup prompt";
      `,
    },
  });
  const settings = {
    useCleanupModel: true,
    cleanupDisableThinking: true,
    cleanupReasoningEffort: "medium",
  };
  const resolveReasoningRoute = (await vite.ssrLoadModule("/helpers/audioManager.js"))
    .resolveReasoningRoute;
  return (text, { voiceAgentRequested = false, translationRequested = false } = {}) =>
    resolveReasoningRoute(text, settings, "Jarvis", voiceAgentRequested, translationRequested);
}

test("the cleanup route pins temperature 0 and requires complete output", async (t) => {
  const resolveRoute = await loadRouteResolver(t);

  const route = resolveRoute("so um clean this up");

  assert.equal(route.kind, "cleanup");
  assert.equal(route.config.inferenceScope, "dictationCleanup");
  assert.equal(route.config.temperature, 0);
  assert.equal(route.config.requireCompleteOutput, true);
  assert.equal(route.config.reasoningEffort, "medium");
});

test("the translation chain's cleanup step pins the same config", async (t) => {
  const resolveRoute = await loadRouteResolver(t);

  const route = resolveRoute("so um translate this", { translationRequested: true });

  assert.equal(route.kind, "translation");
  assert.equal(route.cleanupConfig.inferenceScope, "dictationCleanup");
  assert.equal(route.cleanupConfig.temperature, 0);
  assert.equal(route.cleanupConfig.requireCompleteOutput, true);
  assert.equal(route.config.temperature, undefined);
});

test("both Gemini cleanup paths defer temperature to the provider", async (t) => {
  const resolveRoute = await loadRouteResolver(t, "gemini");
  assert.equal(resolveRoute("clean this").config.temperature, undefined);
  assert.equal(
    resolveRoute("translate this", { translationRequested: true }).cleanupConfig.temperature,
    undefined
  );
});

test("a stale Gemini selection does not change other cleanup modes", async (t) => {
  const resolveRoute = await loadRouteResolver(t, "gemini", "local");
  assert.equal(resolveRoute("clean this").config.temperature, 0);
  assert.equal(
    resolveRoute("translate this", { translationRequested: true }).cleanupConfig.temperature,
    0
  );
});

test("the agent route keeps its provider defaults", async (t) => {
  const resolveRoute = await loadRouteResolver(t);

  const route = resolveRoute("Jarvis, what is on my calendar", { voiceAgentRequested: true });

  assert.equal(route.kind, "agent");
  assert.equal(route.config.temperature, undefined);
  assert.equal(route.config.requireCompleteOutput, undefined);
});

// A long dictation carries its own model and provider on the cleanup route;
// a short one leaves both to the cleanup scope, as before.
test("the long-dictation override sets the route's model and provider, short ones don't", async (t) => {
  const { vite } = await loadAudioManager(t, {
    cachePrefix: "openwhispr-cleanup-route-long-test-",
    settingsKey: "__cleanupRouteLongSettings",
    mockModules: {
      "/stores/settingsStore": `
        export const getSettings = () => globalThis.__cleanupRouteLongSettings;
        export const getEffectiveCleanupModel = () => "claude-haiku-5-5";
        export const selectResolvedLLMConfig = () => ({ model: "claude-haiku-5-5", provider: "anthropic", mode: "providers" });
        export const isCloudCleanupMode = () => false;
        export const isCloudDictationAgentMode = () => false;
        export const isCloudTranslationMode = () => false;
      `,
      "/longCleanupInference": `
        export const selectLongCleanupTarget = (_settings, text) =>
          text.split(" ").length >= 3
            ? { model: "claude-sonnet-5-5", config: { provider: "anthropic", reasoningEffort: "low", disableThinking: true } }
            : null;
      `,
      "/dictationAgentInference": `
        export const resolveDictationAgentInference = () => ({ reachable: false, model: "", config: {} });
        export const resolveDictationAgentVisionInference = () => ({ active: false, model: "", config: {} });
      `,
    },
  });
  const settings = {
    useCleanupModel: true,
    cleanupDisableThinking: true,
    cleanupReasoningEffort: "medium",
  };
  const { resolveReasoningRoute } = await vite.ssrLoadModule("/helpers/audioManager.js");

  const short = resolveReasoningRoute("clean this", settings, "Jarvis", false, false);
  assert.equal(short.kind, "cleanup");
  assert.equal(short.model, undefined);
  assert.equal(short.config.provider, undefined);
  assert.equal(short.config.reasoningEffort, "medium");

  const long = resolveReasoningRoute("so um clean this up", settings, "Jarvis", false, false);
  assert.equal(long.kind, "cleanup");
  assert.equal(long.model, "claude-sonnet-5-5");
  assert.equal(long.config.provider, "anthropic");
  assert.equal(long.config.reasoningEffort, "low");
  assert.equal(long.config.inferenceScope, "dictationCleanup", "policy still judges it as cleanup");
  assert.equal(long.config.requireCompleteOutput, true);
  assert.equal(long.config.temperature, 0);
});
