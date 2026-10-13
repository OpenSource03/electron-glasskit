// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { createRef, type ReactElement, type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Capabilities,
  Glass,
  GlassGroup,
  GlassIsland,
  type GlassIslandHandle,
  type RegionBindingOptions,
  ui,
  useGlassCapabilities,
  useGlassIsland,
  useGlassRegion,
} from "../../../src/react/index.js";
import type { BoundItem, CommitMessage } from "../../../src/shared/protocol.js";
import {
  type FakeBridge,
  installBridge,
  installPage,
  MAC,
  type Page,
  place,
  removeBridge,
  settle,
  UNSUPPORTED,
} from "../renderer/harness.js";

let bridge: FakeBridge;
let page: Page;

const BOX = { x: 10, y: 20, width: 300, height: 40 };

/** Lays out every element React rendered, then runs a frame. */
function frame(): void {
  for (const element of document.body.querySelectorAll("[data-glass]")) place(element, BOX);
  page.frame();
}

function lastCommit(): CommitMessage {
  const message = bridge.commit.mock.lastCall?.[0];
  if (!message) throw new Error("nothing was committed");
  return message;
}

function lastItem(): BoundItem {
  const item = lastCommit().items[0];
  if (!item) throw new Error("no item was committed");
  return item;
}

beforeEach(() => {
  bridge = installBridge();
  page = installPage();
});

afterEach(() => {
  cleanup();
  page.frame();
  removeBridge();
  vi.unstubAllGlobals();
});

describe("<Glass>", () => {
  it("binds its element with the region props and forwards DOM props and the ref", () => {
    const ref = createRef<HTMLElement>();
    render(
      <Glass
        as="nav"
        ref={ref}
        data-glass
        className="bar"
        style={{ top: 0 }}
        glassStyle="clear"
        tint="#ff0000"
        cornerRadius={12}
        zIndex={2}
      >
        content
      </Glass>,
    );
    frame();

    expect(ref.current?.tagName).toBe("NAV");
    expect(ref.current?.className).toBe("bar");
    expect(ref.current?.style.top).toBe("0px");
    expect(ref.current?.textContent).toBe("content");
    expect(ref.current?.hasAttribute("tint")).toBe(false);
    expect(lastCommit().items).toEqual([
      {
        kind: "region",
        key: expect.any(String),
        rect: BOX,
        options: { style: "clear", tint: "#ff0000", cornerRadius: 12, zIndex: 2, hidden: false },
      },
    ]);
  });

  it("supports callback refs", () => {
    const ref = vi.fn();
    const { unmount } = render(<Glass ref={ref} />);
    expect(ref).toHaveBeenLastCalledWith(expect.any(HTMLDivElement));
    unmount();
    expect(ref).toHaveBeenLastCalledWith(null);
  });

  it("survives a callback ref that returns its assignment", () => {
    const holder: { current: HTMLDivElement | null } = { current: null };
    // @ts-expect-error returning the assignment is the common shorthand this test is about
    const { unmount } = render(<Glass ref={(element) => (holder.current = element)} />);
    expect(holder.current).toBeInstanceOf(HTMLDivElement);

    expect(() => unmount()).not.toThrow();
    expect(holder.current).toBeNull();
  });

  it("runs the cleanup a React 19 callback ref returns, instead of calling it with null", () => {
    const cleanup = vi.fn();
    const ref = vi.fn(() => cleanup);
    const { unmount } = render(<Glass ref={ref} />);
    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(ref).toHaveBeenCalledExactlyOnceWith(expect.any(HTMLDivElement));
  });

  it("hands the element to a new ref without rebinding", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Glass data-glass ref={first} />);
    frame();

    rerender(<Glass data-glass ref={second} />);

    expect(first).toHaveBeenLastCalledWith(null);
    expect(second).toHaveBeenLastCalledWith(expect.any(HTMLDivElement));
    expect(page.pendingFrames()).toBe(0);
  });

  it("sends prop changes as one update and resets props that were removed", () => {
    const { rerender } = render(<Glass data-glass tint="#ff0000" cornerRadius={12} />);
    frame();

    rerender(<Glass data-glass cornerRadius={16} />);
    frame();

    expect(bridge.commit).toHaveBeenCalledTimes(2);
    expect(lastItem()).toMatchObject({ options: { cornerRadius: 16, tint: undefined, hidden: false } });
  });

  it("does nothing on re-renders that change no option by value", () => {
    const { rerender } = render(<Glass data-glass fallback={{ opacity: "0.5" }} cornerRadius={12} />);
    frame();
    expect(page.pendingFrames()).toBe(0);

    rerender(<Glass data-glass fallback={{ opacity: "0.5" }} cornerRadius={12} className="changed" />);

    expect(page.pendingFrames()).toBe(0);
    expect(bridge.commit).toHaveBeenCalledTimes(1);
  });

  it("binds once under StrictMode and unbinds on unmount", () => {
    const { unmount } = render(
      <StrictMode>
        <Glass data-glass cornerRadius={12} />
      </StrictMode>,
    );
    frame();
    expect(bridge.commit).toHaveBeenCalledTimes(1);
    expect(lastCommit().items).toHaveLength(1);
    expect(page.observed()).toHaveLength(1);

    unmount();
    page.frame();

    expect(lastCommit()).toEqual({ items: [], groups: {} });
    expect(page.observed()).toEqual([]);
    expect(bridge.listenerCount()).toBe(0);
    expect(page.pendingFrames()).toBe(0);
  });

  it("follows the element when `as` changes", () => {
    const { rerender, container } = render(<Glass data-glass as="div" />);
    frame();
    const first = lastItem().key;

    rerender(<Glass data-glass as="section" />);
    frame();

    expect(container.firstElementChild?.tagName).toBe("SECTION");
    expect(lastCommit().items).toHaveLength(1);
    expect(lastItem().key).not.toBe(first);
    expect(lastItem()).toMatchObject({ options: { hidden: false } });
  });

  it("applies and removes the CSS fallback where glass is unavailable", async () => {
    installBridge(UNSUPPORTED);
    const { container, unmount } = render(<Glass fallback={{ opacity: "0.5" }} />);
    const element = container.firstElementChild;
    await act(settle);
    expect(element?.getAttribute("style")).toContain("opacity: 0.5");

    unmount();
    expect(element?.getAttribute("style") ?? "").toBe("");
  });
});

describe("<GlassGroup>", () => {
  it("merges the Glass below it and leaves the Glass outside alone", () => {
    render(
      <StrictMode>
        <GlassGroup spacing={12} zIndex={1}>
          <Glass data-glass />
          <section>
            <Glass data-glass />
          </section>
        </GlassGroup>
        <Glass data-glass />
      </StrictMode>,
    );
    frame();

    const { items, groups } = lastCommit();
    const [key] = Object.keys(groups);
    expect(groups).toEqual({ [key ?? ""]: { spacing: 12, zIndex: 1 } });
    expect(items.map((item) => (item.kind === "region" ? item.group : null))).toEqual([key, key, undefined]);
  });

  it("sends changed group options", () => {
    const { rerender } = render(
      <GlassGroup spacing={12}>
        <Glass data-glass />
      </GlassGroup>,
    );
    frame();

    rerender(
      <GlassGroup spacing={20}>
        <Glass data-glass />
      </GlassGroup>,
    );
    frame();

    expect(bridge.commit).toHaveBeenCalledTimes(2);
    expect(Object.values(lastCommit().groups)).toEqual([{ spacing: 20 }]);
  });
});

describe("<GlassIsland>", () => {
  const content = ui.hstack({}, [ui.textField({ id: "message" }), ui.button({ id: "send", label: "Send" })]);

  it("binds an island and forwards DOM props, but not its own", () => {
    const { container } = render(<GlassIsland data-glass className="composer" content={content} fit="height" />);
    frame();

    const element = container.firstElementChild;
    expect(element?.className).toBe("composer");
    expect(element?.getAttributeNames().sort()).toEqual(["class", "data-glass"]);
    expect(lastItem()).toEqual({
      kind: "island",
      key: expect.any(String),
      rect: BOX,
      content,
      fit: "height",
      hidden: false,
    });
  });

  it("sends new content as an update with its animation, and nothing for equal content", () => {
    const { rerender } = render(<GlassIsland data-glass content={content} />);
    frame();

    rerender(<GlassIsland data-glass content={structuredClone(content)} />);
    expect(page.pendingFrames()).toBe(0);

    const next = ui.text("Sent");
    rerender(<GlassIsland data-glass content={next} animation="bouncy" />);
    frame();

    expect(bridge.commit).toHaveBeenCalledTimes(2);
    expect(lastItem()).toMatchObject({ content: next, animation: "bouncy" });
  });

  it("calls the latest handler for each event", () => {
    const handlers = {
      onPress: vi.fn(),
      onChange: vi.fn(),
      onSubmit: vi.fn(),
      onFocus: vi.fn(),
      onBlur: vi.fn(),
      onResize: vi.fn(),
    };
    const stale = vi.fn();
    const { rerender } = render(<GlassIsland data-glass content={content} onPress={stale} />);
    rerender(<GlassIsland data-glass content={content} {...handlers} />);
    frame();
    const key = lastItem().key;

    act(() => {
      bridge.emit({ key, event: { type: "press", node: "send" } });
      bridge.emit({ key, event: { type: "change", node: "message", value: "hi" } });
      bridge.emit({ key, event: { type: "submit", node: "message", value: "hi" } });
      bridge.emit({ key, event: { type: "focus", node: "message" } });
      bridge.emit({ key, event: { type: "blur", node: "message" } });
      bridge.emit({ key, event: { type: "resize", size: { width: 200, height: 44 } } });
    });

    expect(stale).not.toHaveBeenCalled();
    expect(handlers.onPress).toHaveBeenCalledExactlyOnceWith({ type: "press", node: "send" });
    expect(handlers.onChange).toHaveBeenCalledExactlyOnceWith({ type: "change", node: "message", value: "hi" });
    expect(handlers.onSubmit).toHaveBeenCalledExactlyOnceWith({ type: "submit", node: "message", value: "hi" });
    expect(handlers.onFocus).toHaveBeenCalledExactlyOnceWith({ type: "focus", node: "message" });
    expect(handlers.onBlur).toHaveBeenCalledExactlyOnceWith({ type: "blur", node: "message" });
    expect(handlers.onResize).toHaveBeenCalledExactlyOnceWith({ type: "resize", size: { width: 200, height: 44 } });
  });

  it("applies the reported size on the fitted axis", () => {
    const { container } = render(<GlassIsland data-glass content={content} fit="height" />);
    frame();
    act(() => bridge.emit({ key: lastItem().key, event: { type: "resize", size: { width: 200, height: 44 } } }));
    expect(container.firstElementChild?.getAttribute("style")).toBe("height: 44px;");
  });

  it("hides the island with the element's hidden attribute", () => {
    const { container } = render(<GlassIsland data-glass content={content} hidden />);
    const element = container.firstElementChild;
    expect(element?.hasAttribute("hidden")).toBe(true);

    // The attribute is not an island option: the island is hidden because the element has no box.
    frame();
    expect(lastItem()).toMatchObject({ hidden: false });
    if (element) place(element, { x: 0, y: 0, width: 0, height: 0 }, 0);
    page.resize();
    page.frame();
    expect(lastItem()).toMatchObject({ hidden: true });
  });

  it("exposes setValue, focus and the element through its ref", () => {
    const ref = createRef<GlassIslandHandle>();
    render(
      <StrictMode>
        <GlassIsland ref={ref} data-glass content={content} />
      </StrictMode>,
    );
    frame();
    const key = lastItem().key;
    expect(ref.current?.element).toBe(document.body.querySelector("[data-glass]"));

    ref.current?.setValue("message", "hello");
    ref.current?.focus("message");

    expect(bridge.command.mock.calls).toEqual([
      [{ type: "setValue", key, node: "message", value: "hello" }],
      [{ type: "focus", key, node: "message" }],
    ]);
  });

  it("delivers events once under StrictMode and removes the island on unmount", () => {
    const onPress = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <GlassIsland data-glass content={content} onPress={onPress} />
      </StrictMode>,
    );
    frame();
    act(() => bridge.emit({ key: lastItem().key, event: { type: "press", node: "send" } }));
    expect(onPress).toHaveBeenCalledTimes(1);

    unmount();
    page.frame();
    expect(lastCommit()).toEqual({ items: [], groups: {} });
    expect(bridge.listenerCount()).toBe(0);
  });

  it("renders its children only where islands are unavailable", async () => {
    const supported = render(<GlassIsland content={content}>stand-in</GlassIsland>);
    await act(settle);
    expect(supported.container.textContent).toBe("");
    supported.unmount();

    installBridge({ ...MAC, islands: false });
    const unsupported = render(<GlassIsland content={content}>stand-in</GlassIsland>);
    expect(unsupported.container.textContent).toBe("");
    await act(settle);
    expect(unsupported.container.textContent).toBe("stand-in");
  });
});

describe("hooks", () => {
  it("useGlassCapabilities is null until the answer arrives", async () => {
    const seen: Array<Capabilities | null> = [];
    function Probe(): ReactNode {
      seen.push(useGlassCapabilities());
      return null;
    }
    render(<Probe />);
    await act(settle);
    expect(seen[0]).toBeNull();
    expect(seen.at(-1)).toEqual(MAC);
  });

  function Bar({ options, open = true }: { options?: RegionBindingOptions; open?: boolean }): ReactElement {
    const ref = useGlassRegion(options);
    return <main>{open && <header ref={ref} data-glass />}</main>;
  }

  it("useGlassRegion binds the element its ref is attached to and follows its options", () => {
    const { rerender, unmount } = render(<Bar options={{ tint: "#ff0000", zIndex: 1 }} />);
    frame();
    expect(lastItem()).toMatchObject({ options: { tint: "#ff0000", zIndex: 1 } });

    rerender(<Bar options={{ zIndex: 1 }} />);
    frame();
    expect(lastItem()).toMatchObject({ options: { tint: undefined, zIndex: 1 } });

    rerender(<Bar />);
    frame();
    expect(lastItem()).toMatchObject({ options: { tint: undefined, zIndex: undefined, hidden: false } });

    unmount();
    page.frame();
    expect(lastCommit().items).toEqual([]);
  });

  it.each([
    ["", (node: ReactElement) => node],
    [" under StrictMode", (node: ReactElement) => <StrictMode>{node}</StrictMode>],
  ])("useGlassRegion binds an element that appears later and unbinds it when it goes%s", (_name, wrap) => {
    const { rerender } = render(wrap(<Bar open={false} options={{ zIndex: 1 }} />));
    page.frame();
    expect(bridge.commit).not.toHaveBeenCalled();

    // The options changed in the render that attached the element.
    rerender(wrap(<Bar open options={{ zIndex: 2 }} />));
    frame();
    expect(lastCommit().items).toHaveLength(1);
    expect(lastItem()).toMatchObject({ options: { zIndex: 2, hidden: false } });

    rerender(wrap(<Bar open={false} options={{ zIndex: 2 }} />));
    page.frame();
    expect(lastCommit().items).toEqual([]);
    expect(bridge.listenerCount()).toBe(0);
  });

  it("useGlassIsland returns a ref and a handle for the element it is attached to", () => {
    const onPress = vi.fn();
    const seen: Array<ReturnType<typeof useGlassIsland>[1]> = [];
    function Strip({ open }: { open: boolean }): ReactElement {
      const [ref, island] = useGlassIsland({ content: ui.button({ id: "add", label: "Add" }), onPress });
      seen.push(island);
      return <main>{open && <section ref={ref} data-glass />}</main>;
    }
    const { rerender } = render(<Strip open={false} />);
    expect(seen[0]?.element).toBeNull();

    rerender(<Strip open />);
    frame();
    const key = lastItem().key;
    expect(seen.at(-1)).toBe(seen[0]);
    expect(seen[0]?.element?.tagName).toBe("SECTION");

    seen[0]?.focus("add");
    act(() => bridge.emit({ key, event: { type: "press", node: "add" } }));
    expect(bridge.command.mock.calls).toEqual([[{ type: "focus", key, node: "add" }]]);
    expect(onPress).toHaveBeenCalledExactlyOnceWith({ type: "press", node: "add" });

    rerender(<Strip open={false} />);
    page.frame();
    expect(lastCommit().items).toEqual([]);
    expect(seen[0]?.element).toBeNull();
  });
});
