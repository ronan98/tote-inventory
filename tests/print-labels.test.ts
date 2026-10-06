import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { ComponentProps } from "react";
import type { PrintLabels as PrintLabelsComponent } from "../src/components/PrintLabels";

type Props = ComponentProps<typeof PrintLabelsComponent>;

const options: Props["options"] = [
  { tote: { id: "first", code: "T001", name: "Christmas decorations" }, qr: "data:image/png;base64,first" },
  { tote: { id: "second", code: "T002", name: "Camping gear" }, qr: "data:image/png;base64,second" },
  { tote: { id: "third", code: "T003", name: "Spare cables" }, qr: "data:image/png;base64,third" },
];

test("bulk label controls keep the preview, URL, and PDF selection together", async context => {
  // This is a synthetic DOM component test, without a browser or network requests.
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://inventory.example.test/labels" });
  const replacements: Record<string, unknown> = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

  let root: Root | undefined;
  const opened: unknown[][] = [];
  let printed = 0;
  dom.window.open = (...args) => { opened.push(args); return null; };
  dom.window.print = () => { printed++; };
  const container = dom.window.document.getElementById("root")!;

  try {
    const { createRoot } = await import("react-dom/client");
    const { PrintLabels } = await import("../src/components/PrintLabels");
    // The installed Next.js 16.3.8 hook reads this context. Keep the framework
    // harness in tests; application code uses only next/navigation.
    const { SearchParamsContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
    let props: Props;

    async function render() {
      await act(async () => {
        root!.render(createElement(SearchParamsContext.Provider, { value: new URLSearchParams(dom.window.location.search) }, createElement(PrintLabels, props)));
      });
    }

    async function mount(url: string, overrides: Partial<Props> = {}) {
      if (root) await act(async () => root!.unmount());
      dom.window.history.replaceState(null, "", url);
      opened.length = 0;
      printed = 0;
      props = { options, selectedIds: options.map(option => option.tote.id), address: "inventory.example.test", ...overrides };
      root = createRoot(container);
      await render();
    }

    function button(name: string): HTMLButtonElement {
      const match = Array.from(container.querySelectorAll("button")).find(element => element.textContent === name);
      assert.ok(match, `Button ${name} exists`);
      return match;
    }

    function checkbox(name: string): HTMLInputElement {
      const label = Array.from(container.querySelectorAll("label")).find(element => element.querySelector("strong")?.textContent === name);
      const input = label?.querySelector("input");
      assert.ok(input, `Checkbox for ${name} exists`);
      return input;
    }

    function previewNames() {
      return Array.from(container.querySelectorAll("article.tote-label h1"), element => element.textContent);
    }

    function status() { return container.querySelector('[role="status"]')?.textContent; }

    async function click(element: HTMLElement) {
      await act(async () => element.click());
      // Next.js updates the search-params context after its patched history API.
      // Retain the same cached props while delivering the actual resulting URL.
      await render();
    }

    async function select(id: string, value: string) {
      const element = container.querySelector<HTMLSelectElement>(`#${id}`);
      assert.ok(element, `Select ${id} exists`);
      await act(async () => {
        element.value = value;
        element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      });
      await render();
    }

    await context.test("checkboxes update preview and selected count; none cannot print all", async () => {
      await mount("/labels");
      assert.equal(status(), "3 of 3 totes selected.");
      assert.deepEqual(previewNames(), options.map(option => option.tote.name));
      assert.equal(button("Select all").disabled, true);

      await click(checkbox("Camping gear"));
      assert.equal(checkbox("Camping gear").checked, false);
      assert.equal(status(), "2 of 3 totes selected.");
      assert.deepEqual(previewNames(), ["Christmas decorations", "Spare cables"]);
      assert.equal(new URLSearchParams(dom.window.location.search).get("ids"), "first,third");

      await click(button("Clear selection"));
      assert.equal(status(), "0 of 3 totes selected.");
      assert.deepEqual(previewNames(), []);
      assert.equal(new URLSearchParams(dom.window.location.search).get("ids"), "");
      assert.equal(container.querySelectorAll('input[type="checkbox"]:checked').length, 0);
      assert.equal(button("Open print PDF").disabled, true);
      assert.equal(button("Print web page").disabled, true);
      await click(button("Open print PDF"));
      await click(button("Print web page"));
      assert.deepEqual(opened, []);
      assert.equal(printed, 0);
      assert.match(container.querySelector(".label-empty")!.textContent!, /Select at least one tote/);

      await click(checkbox("Camping gear"));
      assert.deepEqual(previewNames(), ["Camping gear"]);
      assert.equal(button("Open print PDF").disabled, false);
      await click(button("Select all"));
      assert.equal(status(), "3 of 3 totes selected.");
      assert.deepEqual(previewNames(), options.map(option => option.tote.name));
      assert.equal(container.querySelectorAll('input[type="checkbox"]:checked').length, 3);
    });

    await context.test("PDF contains exactly the preview subset and preserves layout and skipped slots", async () => {
      await mount("/labels?ids=third,first&format=avery15264&start=5", { selectedIds: ["third", "first"], start: 5 });
      // Picker and preview retain inventory order, including after checking a tote.
      assert.deepEqual(previewNames(), ["Christmas decorations", "Spare cables"]);
      assert.deepEqual(Array.from(container.querySelectorAll("article.tote-label"), element => element.getAttribute("data-label-slot")), ["5", "6"]);
      await click(button("Open print PDF"));
      assert.deepEqual(opened, [["/api/labels/pdf?ids=first%2Cthird&format=avery15264&start=5", "_blank", "noopener,noreferrer"]]);

      await select("label-start", "6");
      assert.equal(container.querySelectorAll(".label-sheet-group").length, 2);
      assert.deepEqual(previewNames(), ["Christmas decorations", "Spare cables"]);
      await click(button("Open print PDF"));
      assert.deepEqual(opened.at(-1), ["/api/labels/pdf?ids=first%2Cthird&format=avery15264&start=6", "_blank", "noopener,noreferrer"]);

      await select("label-format", "plain");
      assert.equal(container.querySelector("main")!.getAttribute("data-label-format"), "plain");
      assert.equal(container.querySelector("#label-start"), null);
      assert.deepEqual(previewNames(), ["Christmas decorations", "Spare cables"]);
      await click(button("Open print PDF"));
      assert.deepEqual(opened.at(-1), ["/api/labels/pdf?ids=first%2Cthird&format=plain&start=1", "_blank", "noopener,noreferrer"]);
      assert.equal(new URLSearchParams(dom.window.location.search).get("ids"), "first,third");
      await select("label-format", "avery15264");
      assert.equal(container.querySelector<HTMLSelectElement>("#label-start")!.value, "1");
      assert.deepEqual(previewNames(), ["Christmas decorations", "Spare cables"]);
    });

    await context.test("actual URL restores a subset or explicit none despite cached all-tote props", async () => {
      await mount("/labels?ids=second&format=plain&start=6#preview");
      assert.equal(status(), "1 of 3 totes selected.");
      assert.deepEqual(previewNames(), ["Camping gear"]);
      assert.equal(container.querySelector("main")!.getAttribute("data-label-format"), "plain");

      // Simulate Back/Forward: a new URL/context arrives with the original cached
      // server props (which still say all totes, Avery layout, and start slot 1).
      dom.window.history.replaceState(null, "", "/labels?ids=&format=avery15264&start=4#preview");
      await render();
      assert.equal(status(), "0 of 3 totes selected.");
      assert.deepEqual(previewNames(), []);
      assert.equal(button("Open print PDF").disabled, true);
      assert.equal(container.querySelector<HTMLSelectElement>("#label-start")!.value, "4");

      // A full page remount must also respect ids= instead of falling back to all.
      await mount("/labels?ids=&format=plain&start=6");
      assert.equal(status(), "0 of 3 totes selected.");
      assert.equal(button("Open print PDF").disabled, true);
      assert.deepEqual(previewNames(), []);

      dom.window.history.replaceState(null, "", "/labels?ids=third&format=avery15264&start=2#preview");
      await render();
      assert.deepEqual(previewNames(), ["Spare cables"]);
      assert.equal(checkbox("Spare cables").checked, true);
      assert.equal(container.querySelector<HTMLSelectElement>("#label-start")!.value, "2");
      await click(checkbox("Christmas decorations"));
      assert.equal(dom.window.location.hash, "#preview");
      assert.deepEqual(previewNames(), ["Christmas decorations", "Spare cables"]);
    });
  } finally {
    if (root) await act(async () => root!.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
