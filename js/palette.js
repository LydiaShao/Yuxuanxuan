"use strict";

(function (global) {
  const SITE_DEFAULTS = {
    background: "#1b3330",
    surface: "#274640",
    text: "#f4faf7",
    muted: "#b7cfc6",
    accent: "#7dceb8",
    onAccent: "#102824",
  };
  const JOB_DEFAULTS = {
    background: "#1e3a34",
    fade: "#7dceb8",
    text: "#f4faf7",
    muted: "#c5ddd4",
  };
  const SITE_KEYS = Object.keys(SITE_DEFAULTS);
  const JOB_KEYS = Object.keys(JOB_DEFAULTS);

  function hex(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value.toLowerCase() : "";
  }

  function readMap(source, keys, defaults, legacyKey, legacyValue) {
    const colors = { ...defaults };
    const bag = source && typeof source === "object" ? source : {};
    for (const key of keys) {
      const value = hex(bag[key]);
      if (value) colors[key] = value;
    }
    const legacy = hex(legacyValue);
    if (legacyKey && legacy && !hex(bag[legacyKey])) colors[legacyKey] = legacy;
    return colors;
  }

  function siteColors(theme) {
    const source = theme && typeof theme === "object" ? theme : {};
    return readMap(source, SITE_KEYS, SITE_DEFAULTS, "accent", source.color);
  }

  function jobColors(job) {
    const source = job && typeof job === "object" ? job : {};
    const bag = source.colors && typeof source.colors === "object" ? source.colors : {};
    return readMap(bag, JOB_KEYS, JOB_DEFAULTS, "fade", source.color);
  }

  function applySiteScheme(theme) {
    const colors = siteColors(theme);
    const root = document.documentElement.style;
    root.setProperty("--background", colors.background);
    root.setProperty("--surface", colors.surface);
    root.setProperty("--text", colors.text);
    root.setProperty("--muted", colors.muted);
    root.setProperty("--accent", colors.accent);
    root.setProperty("--on-accent", colors.onAccent);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", colors.background);
    return colors;
  }

  function applyJobScheme(element, job) {
    const colors = job && job.background && job.fade && job.text && job.muted && !job.colors ? job : jobColors(job);
    element.style.setProperty("--job-bg", colors.background);
    element.style.setProperty("--job-fade", colors.fade);
    element.style.setProperty("--job-text", colors.text);
    element.style.setProperty("--job-muted", colors.muted);
    return colors;
  }

  global.YxPalette = {
    SITE_DEFAULTS,
    JOB_DEFAULTS,
    siteColors,
    jobColors,
    applySiteScheme,
    applyJobScheme,
  };
})(window);
