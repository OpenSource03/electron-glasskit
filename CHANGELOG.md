# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

electron-glasskit is a fork of [electron-liquid-glass](https://github.com/Meridius-Labs/electron-liquid-glass)
1.1.1 (MIT) and is being rewritten. The upstream history is not carried over.

## [Unreleased]

## [0.1.0] - 2026-10-16

The first release under this name. Compared with electron-liquid-glass 1.1.1:

### Added

- **Glass above the page.** `attachGlass(window).addRegion()` places Liquid Glass at any rectangle over the web
  content, with `style`, `tint`, `cornerRadius`, `appearance`, `interactive`, `zIndex` and click pass-through.
  Regions can be updated, moved (optionally animated) and removed.
- **Merging groups.** Regions added to `addGroup()` flow into each other when they come close.
- **Islands.** `addIsland()` renders a JSON-described SwiftUI tree natively: stacks, text, SF Symbols, shapes,
  buttons, toggles, sliders, pickers, menus and single or multi-line text fields, with events sent back to
  JavaScript, animated morphing between trees, and content-driven sizing.
- **Shaped glass.** Capsules, circles, rounded rectangles, SVG paths and text outlines.
- **Panels.** `createPanel()` opens a see-through child window so HTML can sit on glass.
- **Frames that follow the window.** Any frame can be a function of the window's content size.
- **DOM bindings** in `electron-glasskit/renderer` (`bindRegion`, `bindIsland`, `createGroup`), which mirror
  elements to native glass and follow them through layout, scroll and zoom, with a CSS fallback where glass
  is unavailable.
- **React bindings** in `electron-glasskit/react`: `<Glass>`, `<GlassGroup>`, `<GlassIsland>` and hooks.
- **A preload bridge** that works with context isolation and the sandbox, installed with `installPreload()`.
- `getCapabilities()`, `glassWindowOptions()` and `host.inspect()`.

### Changed

- The window background is now `attachGlass(window).setBackground()`. It can be updated and cleared, and it
  uses the public `NSGlassEffectView` API instead of looking the class up by name.
- Glass views live outside the layer Electron re-sorts, so adding web views no longer buries them.
- The package installs on every platform and does nothing off macOS, instead of failing to install.
- Nothing is compiled on install; binaries for Apple silicon and Intel are prebuilt.
- TypeScript types cover the whole API, for both ESM and CommonJS.

### Deprecated

- `liquidGlass.addView()` and its `unstable_set*` methods. They still work; use `setBackground()`.


[Unreleased]: https://github.com/OpenSource03/electron-glasskit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OpenSource03/electron-glasskit/releases/tag/v0.1.0
