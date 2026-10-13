import { attachGlass, type GlassHost } from "../../../../src/main/host.js";
import { setNative } from "../../../../src/main/native.js";
import { asWindow, FakeWindow } from "./electron.js";
import { FakeNative } from "./native.js";

export interface Stage {
  native: FakeNative;
  window: FakeWindow;
  host: GlassHost;
}

/** A fake addon, an 800 x 600 window and the glass host attached to it. */
export function stage(): Stage {
  const native = new FakeNative();
  setNative(native);
  const window = new FakeWindow();
  return { native, window, host: attachGlass(asWindow(window)) };
}
