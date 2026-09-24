"use strict";

const SITE_NAME = "Yuxuanxuan";
const THEME_KEYS = ["background", "surface", "text", "muted", "accent", "frame"];

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

function applyTheme(theme) {
  const root = document.documentElement;
  for (const key of THEME_KEYS) {
    if (theme && typeof theme[key] === "string") root.style.setProperty(`--${key}`, theme[key]);
  }
  if (theme && theme.background) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme.background);
  }
}

function plate(className, src, alt, emptyLabel) {
  const frame = h("figure", { class: className });
  if (!src) {
    frame.classList.add("is-empty");
    frame.append(emptyLabel);
    return frame;
  }
  const image = h("img", { src, alt });
  image.addEventListener("error", () => {
    image.remove();
    frame.classList.add("is-empty");
    frame.append(emptyLabel);
  });
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
        },
        job.name
      )
    )
  );
}

function renderJob(job) {
  const paragraphs = Array.isArray(job.paragraphs) ? job.paragraphs.filter(Boolean) : [];
  return h(
    "article",
    { class: "job" },
    plate("banner", job.banner, `${job.name} illustration`, "Landscape plate"),
    h(
      "div",
      { class: "job-head" },
      plate("stamp", job.portrait, `${job.name} portrait`, "Stamp"),
      h(
        "div",
        {},
        h("p", { class: "kicker" }, "Job"),
        h("h1", {}, job.name),
        job.tagline ? h("p", { class: "tagline" }, job.tagline) : null
      )
    ),
    paragraphs.length ? h("div", { class: "prose" }, paragraphs.map((paragraph) => h("p", {}, paragraph))) : null
  );
}

function renderEmpty() {
  return h(
    "section",
    { class: "empty" },
    h("p", { class: "kicker" }, "Archive"),
    h("h1", {}, "No jobs yet"),
    h("p", {}, "Each job page holds one landscape plate and one square stamp portrait."),
    h("a", { class: "text-link", href: "/admin" }, "Open admin")
  );
}

function renderMissing() {
  return h(
    "section",
    { class: "missing" },
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
