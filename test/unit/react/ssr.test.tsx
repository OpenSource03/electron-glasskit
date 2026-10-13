import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Glass, GlassGroup, GlassIsland, ui } from "../../../src/react/index.js";

// Runs in Node, where neither `window` nor `document` exists.
describe("server rendering", () => {
  it("renders plain elements and binds nothing", () => {
    const html = renderToString(
      <GlassGroup spacing={8}>
        <Glass as="nav" className="bar" cornerRadius={12} />
        <GlassIsland content={ui.text("Hello")} id="island">
          stand-in
        </GlassIsland>
      </GlassGroup>,
    );
    expect(html).toBe('<nav class="bar"></nav><div id="island"></div>');
  });
});
