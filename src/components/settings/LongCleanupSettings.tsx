import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { isModeAllowedByPolicy } from "../../stores/policyRules";
import { usePolicyStore } from "../../stores/policyStore";
import { LONG_CLEANUP_MIN_WORDS_LIMITS } from "../../config/longCleanup";
import { Toggle } from "../ui/toggle";
import { Input } from "../ui/input";
import { SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
import InferenceConfigEditor from "./InferenceConfigEditor";

// Optional cleanup model for long dictations (`dictationCleanupLong` scope).
export default function LongCleanupSettings() {
  const { t } = useTranslation();
  const useLongCleanupModel = useSettingsStore((s) => s.useLongCleanupModel);
  const setUseLongCleanupModel = useSettingsStore((s) => s.setUseLongCleanupModel);
  const minWords = useSettingsStore((s) => s.longCleanupMinWords);
  const setMinWords = useSettingsStore((s) => s.setLongCleanupMinWords);
  const allowed = usePolicyStore((state) => isModeAllowedByPolicy(state, "llm", "providers"));

  // Typed digits stay a draft until blur, so "150" isn't clamped at its "1".
  const [draft, setDraft] = useState(String(minWords));
  useEffect(() => setDraft(String(minWords)), [minWords]);
  const commit = () => {
    const value = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(value)) setDraft(String(minWords));
    else setMinWords(value);
  };

  if (!allowed) return null;

  return (
    <>
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow label={t("settingsPage.aiModels.longCleanup.toggle")}>
            <Toggle checked={useLongCleanupModel} onChange={setUseLongCleanupModel} />
          </SettingsRow>
        </SettingsPanelRow>
        {useLongCleanupModel && (
          <SettingsPanelRow>
            <SettingsRow label={t("settingsPage.aiModels.longCleanup.minWords")}>
              <Input
                dir="ltr"
                type="number"
                inputMode="numeric"
                className="w-24"
                min={LONG_CLEANUP_MIN_WORDS_LIMITS.min}
                max={LONG_CLEANUP_MIN_WORDS_LIMITS.max}
                step={10}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                aria-label={t("settingsPage.aiModels.longCleanup.minWords")}
              />
            </SettingsRow>
          </SettingsPanelRow>
        )}
      </SettingsPanel>
      {useLongCleanupModel && (
        <InferenceConfigEditor scope="dictationCleanupLong" allowedModes={["providers"]} />
      )}
    </>
  );
}
