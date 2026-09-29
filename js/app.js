"use strict";

const SITE_NAME = "Yuxuanxuan";
const FALLBACK_JOB = "#7dceb8";

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function cssColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : fallback;
}

function applyTheme(theme) {
  const color = cssColor(theme && (theme.color || theme.accent), "");
  if (color) YxPalette.applySiteScheme(color);
}

function plate(className, src, alt) {
  if (!src) return null;
  const frame = h("figure", { class: className });
  const image = h("img", { src, alt });
  image.addEventListener("error", () => frame.remove());
  frame.append(image);
  return frame;
}

function renderNav(jobs, activeId) {
  const nav = document.getElementById("job-nav");
  nav.replaceChildren(
    ...jobs.map((job) =>
      h(
        "a",
        {
          href: `#/job/${encodeURIComponent(job.id)}`,
          "aria-current": job.id === activeId ? "page" : null,
          style: `--job:${cssColor(job.color, FALLBACK_JOB)}`,
        },
        job.name
      )
    )
  );
}

function renderJob(job) {
  const paragraphs = Array.isArray(job.paragraphs) ? job.paragraphs.filter(Boolean) : [];
  const extras = Array.isArray(job.images) ? job.images.filter(Boolean) : [];
  const banner = plate("banner", job.banner, `${job.name} illustration`);
  const portrait = plate("portrait", job.portrait, `${job.name} portrait`);
  const article = h(
    "article",
    { class: "job" },
    banner,
    h(
      "div",
      { class: banner && portrait ? "feed has-cover" : "feed" },
      portrait,
      h("h1", {}, job.name),
      job.tagline ? h("p", { class: "tagline" }, job.tagline) : null,
      paragraphs.length ? h("div", { class: "prose" }, paragraphs.map((paragraph) => h("p", {}, paragraph))) : null
    ),
    extras.length
      ? h(
          "div",
          { class: "gallery" },
          extras.map((src, index) => plate("plate", src, `${job.name} picture ${index + 1}`))
        )
      : null
  );
  YxPalette.applyJobScheme(article, cssColor(job.color, FALLBACK_JOB));
  return article;
}

function renderEmpty() {
  return h(
    "section",
    { class: "empty wrap" },
    h("p", { class: "kicker" }, "Archive"),
    h("h1", {}, "No jobs yet"),
    h("p", {}, "A job page can hold a landscape plate, a stamp portrait, and any other pictures that belong with it."),
    h("a", { class: "text-link", href: "/admin" }, "Open admin")
  );
}

function renderMissing() {
  return h(
    "section",
    { class: "missing wrap" },
    h("p", { class: "kicker" }, "Missing"),
    h("h1", {}, "This job is not on the bar"),
    h("a", { class: "text-link", href: "#/" }, "Back to the archive")
  );
}

function selectedJob(jobs) {
  const parts = (location.hash || "").replace(/^#/, "").split("/").filter(Boolean);
  if (parts[0] === "job" && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    return { job: jobs.find((item) => item.id === id) || null, explicit: true };
  }
  return { job: jobs[0] || null, explicit: false };
}

function render(site) {
  const jobs = Array.isArray(site.jobs) ? site.jobs : [];
  const { job, explicit } = selectedJob(jobs);
  const main = document.getElementById("content");
  if (!jobs.length) {
    renderNav([], "");
    main.replaceChildren(renderEmpty());
    document.title = SITE_NAME;
    return;
  }
  if (explicit && !job) {
    renderNav(jobs, "");
    main.replaceChildren(renderMissing());
    document.title = `Missing · ${SITE_NAME}`;
    return;
  }
  renderNav(jobs, job.id);
  main.replaceChildren(renderJob(job));
  document.title = `${job.name} · ${SITE_NAME}`;
}

async function boot() {
  const main = document.getElementById("content");
  try {
    const response = await fetch("/api/site", { cache: "no-store" });
    if (!response.ok) throw new Error("status");
    const site = await response.json();
    applyTheme(site.theme || {});
    render(site);
    window.__site = site;
  } catch (_error) {
    main.replaceChildren(
      h("section", { class: "missing" }, h("h1", {}, "The archive did not load"), h("p", {}, "The site server is not responding."))
    );
  }
}

window.addEventListener("hashchange", () => {
  if (window.__site) render(window.__site);
});
boot();
