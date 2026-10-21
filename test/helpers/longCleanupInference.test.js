const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/longCleanupInference.js");
const loadConfig = () => import("../../src/config/longCleanup.js");

// Short dictations on Haiku, long ones on Sonnet.
const baseSettings = {
  useCleanupModel: true,
  cleanupMode: "providers",
  cleanupProvider: "anthropic",
  cleanupModel: "claude-haiku-5-5",
  cleanupCloudBaseUrl: "",
  cleanupCustomApiKey: "",
  cleanupDisableThinking: true,
  cleanupReasoningEffort: "",
  useLongCleanupModel: true,
  longCleanupMinWords: 10,
  longCleanupMode: "providers",
  longCleanupProvider: "anthropic",
  longCleanupModel: "claude-sonnet-5-5",
  longCleanupCloudBaseUrl: "",
  longCleanupCustomApiKey: "",
  longCleanupDisableThinking: true,
  longCleanupReasoningEffort: "low",
};

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

test("a dictation at the threshold uses the long model", async () => {
  const { selectLongCleanupTarget } = await load();

  const target = selectLongCleanupTarget(baseSettings, words(10));

  assert.equal(target.model, "claude-sonnet-5-5");
  assert.equal(target.config.provider, "anthropic");
  assert.equal(target.config.reasoningEffort, "low", "the long scope keeps its own effort");
});

test("a dictation under the threshold keeps the cleanup model", async () => {
  const { selectLongCleanupTarget } = await load();

  assert.equal(selectLongCleanupTarget(baseSettings, words(9)), null);
});

test("the override is off until switched on", async () => {
  const { selectLongCleanupTarget } = await load();

  const target = selectLongCleanupTarget(
    { ...baseSettings, useLongCleanupModel: false },
    words(50)
  );

  assert.equal(target, null);
});

test("an override with no model of its own never inherits cleanup's model", async () => {
  const { resolveLongCleanupInference } = await load();

  const result = resolveLongCleanupInference({ ...baseSettings, longCleanupModel: "" });

  assert.equal(result.active, false);
});

test("an unset provider inherits cleanup's provider", async () => {
  const { resolveLongCleanupInference } = await load();

  const result = resolveLongCleanupInference({ ...baseSettings, longCleanupProvider: "" });

  assert.equal(result.active, true);
  assert.equal(result.config.provider, "anthropic");
});

test("an inherited custom endpoint carries cleanup's key; its own endpoint never does", async () => {
  const { resolveLongCleanupInference } = await load();
  const custom = {
    ...baseSettings,
    cleanupProvider: "custom",
    cleanupCloudBaseUrl: "https://cleanup.example.com/v1",
    cleanupCustomApiKey: "cleanup-key",
    longCleanupProvider: "custom",
    longCleanupModel: "long-model",
  };

  const inherited = resolveLongCleanupInference(custom);
  assert.equal(inherited.config.baseUrl, "https://cleanup.example.com/v1");
  assert.equal(inherited.config.customApiKey, "cleanup-key");

  const own = resolveLongCleanupInference({
    ...custom,
    longCleanupCloudBaseUrl: "https://long.example.com/v1",
  });
  assert.equal(own.config.baseUrl, "https://long.example.com/v1");
  assert.equal(own.config.customApiKey, undefined);
});

test("the threshold is clamped and words are counted without spaces in CJK", async () => {
  const { clampLongCleanupMinWords, countTranscriptWords, LONG_CLEANUP_DEFAULT_MIN_WORDS } =
    await loadConfig();

  assert.equal(clampLongCleanupMinWords(0), 10);
  assert.equal(clampLongCleanupMinWords(1e9), 10000);
  assert.equal(clampLongCleanupMinWords("abc"), LONG_CLEANUP_DEFAULT_MIN_WORDS);
  assert.equal(countTranscriptWords("so, um — clean this up."), 5);
  assert.ok(countTranscriptWords("我们明天下午开会讨论预算") > 1);
  assert.equal(countTranscriptWords(""), 0);
});
