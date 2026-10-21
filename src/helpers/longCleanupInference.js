import { resolveModeProvider, resolveModeReachability } from "./dictationRouting.js";
import { isProviderValidForMode } from "../models/ModelRegistry";
import { selectResolvedLLMConfig } from "../stores/settingsStore";
import { inheritsFallbackEndpoint } from "./reasoningRouting.js";
import { clampLongCleanupMinWords, countTranscriptWords } from "../config/longCleanup.js";

// The optional long-dictation override: the cleanup model a dictation uses once
// it reaches `longCleanupMinWords` words. Resolved through the store selector so
// unset fields inherit dictation cleanup, and "active" only once the user has
// picked a model for this scope itself — an inherited config is plain cleanup.
// BYOK-only, like the vision override, so cloud and self-hosted never apply.
export function resolveLongCleanupInference(settings) {
  const resolved = selectResolvedLLMConfig(settings, "dictationCleanupLong");
  const mode = resolved.mode;
  const model = resolved.model?.trim() || "";
  const storedProvider = resolved.provider?.trim() || "";
  const providerForMode = isProviderValidForMode(storedProvider, mode) ? storedProvider : undefined;
  const provider = resolveModeProvider({ isCloud: false, mode, provider: providerForMode });
  const isCustom = mode === "providers" && provider === "custom";

  // The endpoint falls back to the cleanup scope, so the key that opens it must
  // too; an inherited endpoint with this scope's key (or none) would call the
  // cleanup host with the wrong credential.
  const cleanup = selectResolvedLLMConfig(settings, "dictationCleanup");
  const borrowsCleanupEndpoint = inheritsFallbackEndpoint(
    { mode, cloudBaseUrl: settings.longCleanupCloudBaseUrl },
    cleanup.mode
  );
  const customApiKey =
    resolved.customApiKey || (borrowsCleanupEndpoint ? cleanup.customApiKey || "" : "");

  return {
    active:
      !!settings.useLongCleanupModel &&
      // An org-managed cleanup scope picks the model; the override never bypasses it.
      mode === "providers" &&
      !!settings.longCleanupModel?.trim() &&
      resolveModeReachability({ mode, provider, model, isCloud: false, isSelfHosted: false }),
    minWords: clampLongCleanupMinWords(settings.longCleanupMinWords),
    model,
    config: {
      provider,
      baseUrl: isCustom ? resolved.cloudBaseUrl || undefined : undefined,
      customApiKey: isCustom ? customApiKey || undefined : undefined,
      disableThinking: resolved.disableThinking,
      reasoningEffort: resolved.reasoningEffort,
    },
  };
}

/**
 * The override for this transcript, or null when cleanup keeps its own model.
 * @param {import("../stores/settingsStore").SettingsState} settings
 * @param {string} text
 */
export function selectLongCleanupTarget(settings, text) {
  const long = resolveLongCleanupInference(settings);
  if (!long.active) return null;
  if (countTranscriptWords(text) < long.minWords) return null;
  return { model: long.model, config: long.config };
}
