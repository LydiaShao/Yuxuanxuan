"use strict";

(function (global) {
  const JOB_DEFAULTS = {
    background: "#1e3a34",
    bar: "#142826",
    barText: "#f4faf7",
    text: "#f4faf7",
    muted: "#c5ddd4",
  };
  const JOB_KEYS = Object.keys(JOB_DEFAULTS);

  function hex(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value.toLowerCase() : "";
  }

  function jobColors(job) {
    const source = job && typeof job === "object" ? job : {};
    const bag = source.colors && typeof source.colors === "object" ? source.colors : source;
    const colors = { ...JOB_DEFAULTS };
    for (const key of JOB_KEYS) {
      const value = hex(bag[key]);
      if (value) colors[key] = value;
    }
    if (!hex(bag.background)) {
      const fade = hex(bag.fade || source.color);
      if (fade) colors.background = fade;
    }
    return colors;
  }

  function applyJobColors(job) {
    const colors = jobColors(job || {});
    const root = document.documentElement.style;
    root.setProperty("--background", colors.background);
    root.setProperty("--bar", colors.bar);
    root.setProperty("--bar-text", colors.barText);
    root.setProperty("--text", colors.text);
    root.setProperty("--muted", colors.muted);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", colors.bar);
    return colors;
  }

  global.YxPalette = { JOB_DEFAULTS, jobColors, applyJobColors, hex };
})(window);

(function () {
  const syncPage = () => {
    document.documentElement.style.setProperty("--page", `${document.documentElement.clientWidth}px`);
  };
  syncPage();
  window.addEventListener("resize", syncPage);
  if (window.ResizeObserver) new ResizeObserver(syncPage).observe(document.documentElement);
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  const syncHeight = () => {
    const height = Math.ceil(bar.getBoundingClientRect().height);
    if (height) document.documentElement.style.setProperty("--bar-h", `${height}px`);
  };
  const sync = () => {
    bar.classList.toggle("is-top", window.scrollY < 2);
    syncHeight();
  };
  sync();
  window.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", syncHeight);
  if (window.ResizeObserver) new ResizeObserver(syncHeight).observe(bar);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeight);
})();
