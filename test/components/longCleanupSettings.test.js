const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const { installInteractiveDom, findElement } = require("../lib/interactiveDom");

function dispatch(element, type) {
  element.dispatchEvent({
    type,
    bubbles: true,
    button: 0,
    defaultPrevented: false,
    cancelBubble: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.cancelBubble = true;
    },
  });
}

function type(element, value) {
  element.value = value;
  dispatch(element, "input");
}

// The store is a plain object the setters write to, so a test reads what the
// component committed and re-renders through a subscription.
const MOCKS = {
  "react-i18next": `
    const t = (key) => key;
    export const useTranslation = () => ({ t, i18n: { language: "en" } });
  `,
  "/stores/settingsStore": `
    import { useSyncExternalStore } from "react";
    const store = globalThis.__longCleanupStore;
    export const useSettingsStore = (selector) =>
      useSyncExternalStore(store.subscribe, () => selector(store.state));
  `,
  "/stores/policyStore": `
    export const usePolicyStore = (selector) => selector({});
  `,
  "/stores/policyRules": `
    export const isModeAllowedByPolicy = () => globalThis.__longCleanupAllowed;
  `,
  "/InferenceConfigEditor": `
    import React from "react";
    export default ({ scope, allowedModes }) =>
      React.createElement("div", { "data-editor": scope }, "EDITOR " + scope + " " + allowedModes.join(","));
  `,
};

function createStore(initial) {
  const listeners = new Set();
  const store = {
    writes: [],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(patch) {
      store.state = { ...store.state, ...patch };
      listeners.forEach((listener) => listener());
    },
  };
  store.state = {
    useLongCleanupModel: false,
    longCleanupMinWords: 150,
    setUseLongCleanupModel: (value) => store.set({ useLongCleanupModel: value }),
    setLongCleanupMinWords: (value) => {
      store.writes.push(value);
      store.set({ longCleanupMinWords: Math.max(10, value) });
    },
    ...initial,
  };
  return store;
}

async function render(t, { allowed = true, ...initial } = {}) {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
    delete globalThis.__longCleanupStore;
    delete globalThis.__longCleanupAllowed;
  });
  installBrowserGlobals(t, { window: { electronAPI: {} } });
  const store = createStore(initial);
  globalThis.__longCleanupStore = store;
  globalThis.__longCleanupAllowed = allowed;
  const container = installInteractiveDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-long-cleanup-settings-test-",
    noExternal: ["react-i18next"],
    mockModules: MOCKS,
  });
  const { default: LongCleanupSettings } = await vite.ssrLoadModule(
    "/components/settings/LongCleanupSettings.tsx"
  );
  // Loaded after the fake DOM so React detects input-event support against it.
  const { createRoot } = require("react-dom/client");
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(LongCleanupSettings)));
  return { container, store };
}

const numberInput = (root) =>
  findElement(root, (element) => element.tagName === "INPUT" && element.type === "number");
const toggle = (root) =>
  findElement(root, (element) => element.getAttribute?.("role") === "switch");

test("switched off, only the switch shows", async (t) => {
  const { container } = await render(t);

  assert.ok(container.textContent.includes("settingsPage.aiModels.longCleanup.toggle"));
  assert.equal(numberInput(container), null);
  assert.ok(!container.textContent.includes("EDITOR"));
});

test("switching on shows the threshold and a BYOK-only model picker for the long scope", async (t) => {
  const { container } = await render(t);

  await React.act(async () => dispatch(toggle(container), "click"));

  assert.equal(numberInput(container).value, "150");
  assert.ok(container.textContent.includes("EDITOR dictationCleanupLong providers"));
});

test("typed digits commit once, on blur, and an empty field reverts", async (t) => {
  const { container, store } = await render(t, { useLongCleanupModel: true });
  const input = numberInput(container);

  await React.act(async () => type(input, "2"));
  await React.act(async () => type(input, "250"));
  assert.deepEqual(store.writes, [], "no write while typing");

  await React.act(async () => dispatch(input, "focusout"));
  assert.deepEqual(store.writes, [250]);
  assert.equal(numberInput(container).value, "250");

  await React.act(async () => type(numberInput(container), ""));
  await React.act(async () => dispatch(numberInput(container), "focusout"));
  assert.deepEqual(store.writes, [250], "an empty field writes nothing");
  assert.equal(numberInput(container).value, "250");
});

test("an org that disallows BYOK hides the whole block", async (t) => {
  const { container } = await render(t, { allowed: false, useLongCleanupModel: true });

  assert.equal(container.textContent, "");
});
