// Word threshold for the optional long-dictation cleanup model
// (`dictationCleanupLong` scope). Pure, so the settings store and the
// dictation route can share it without an import cycle.

export const LONG_CLEANUP_DEFAULT_MIN_WORDS = 150;
export const LONG_CLEANUP_MIN_WORDS_LIMITS = Object.freeze({ min: 10, max: 10000 });

/** @param {unknown} value */
export function clampLongCleanupMinWords(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return LONG_CLEANUP_DEFAULT_MIN_WORDS;
  const { min, max } = LONG_CLEANUP_MIN_WORDS_LIMITS;
  return Math.min(max, Math.max(min, n));
}

let wordSegmenter;

/**
 * Words in a transcript. Segments by locale-independent word boundaries so
 * scripts without spaces (Chinese, Japanese) still count per word, not as one.
 * @param {string} text
 */
export function countTranscriptWords(text) {
  if (!text) return 0;
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: "word" });
    let count = 0;
    for (const segment of wordSegmenter.segment(text)) if (segment.isWordLike) count += 1;
    return count;
  }
  return text.split(/\s+/).filter(Boolean).length;
}
