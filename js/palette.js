"use strict";

(function (global) {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hexToHsl(hex) {
    const number = parseInt(hex.slice(1), 16);
    const red = ((number >> 16) & 255) / 255;
    const green = ((number >> 8) & 255) / 255;
    const blue = (number & 255) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    const delta = max - min;
    if (delta === 0) return { h: 0, s: 0, l: lightness * 100 };
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue = 0;
    if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    return { h: (hue / 6) * 360, s: saturation * 100, l: lightness * 100 };
  }

  function hsl(h, s, l) {
    return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;
  }

  function schemeFrom(hex) {
    const { h, s, l } = hexToHsl(hex);
    const sat = s < 8 ? 12 : clamp(s, 32, 74);
    return {
      bg: hsl(h, sat * 0.82, 16),
      surface: hsl(h, sat * 0.7, 22),
      ink: hsl(h, clamp(sat * 0.22, 8, 18), 95),
      muted: hsl(h, clamp(sat * 0.32, 8, 20), 76),
      soft: hsl(h, clamp(s, 18, 70), clamp(l, 46, 66)),
      accent: hex,
      onAccent: l > 64 ? hsl(h, clamp(sat, 18, 48), 16) : hsl(h, 14, 97),
    };
  }

  function applySiteScheme(hex) {
    const scheme = schemeFrom(hex);
    const root = document.documentElement.style;
    root.setProperty("--theme", hex);
    root.setProperty("--background", scheme.bg);
    root.setProperty("--surface", scheme.surface);
    root.setProperty("--text", scheme.ink);
    root.setProperty("--muted", scheme.muted);
    root.setProperty("--accent", scheme.accent);
    root.setProperty("--on-accent", scheme.onAccent);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", scheme.bg);
    return scheme;
  }

  function applyJobScheme(element, hex) {
    const scheme = schemeFrom(hex);
    element.style.setProperty("--job", hex);
    element.style.setProperty("--job-bg", scheme.bg);
    element.style.setProperty("--job-surface", scheme.surface);
    element.style.setProperty("--job-ink", scheme.ink);
    element.style.setProperty("--job-muted", scheme.muted);
    element.style.setProperty("--job-soft", scheme.soft);
    return scheme;
  }

  global.YxPalette = { schemeFrom, applySiteScheme, applyJobScheme };
})(window);
