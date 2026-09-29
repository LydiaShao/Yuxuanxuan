"use strict";

const SITE_NAME = "Yuxuanxuan";

const state = {
  jobs: [],
  admin: false,
};

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function cssHex(value, fallback) {
  return YxPalette.hex(value) || fallback;
}

async function api(path, options = {}) {
  const headers = { "X-Admin": "1", ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function selected(jobs) {
  const parts = (location.hash || "").replace(/^#/, "").split("/").filter(Boolean);
  if (parts[0] === "job" && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    return { job: jobs.find((item) => item.id === id) || null, explicit: true };
  }
  return { job: jobs[0] || null, explicit: false };
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

function closeMenu() {
  document.querySelector(".image-menu")?.remove();
}

function showMenu(x, y, items) {
  closeMenu();
  const menu = h(
    "div",
    { class: "image-menu", role: "menu" },
    ...items.filter(Boolean).map((item) => {
      if (item.href) {
        return h("a", { href: item.href, target: "_blank", rel: "noopener" }, item.label);
      }
      return h("button", { type: "button", onclick: () => { closeMenu(); item.action(); } }, item.label);
    })
  );
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${Math.max(8, x - rect.width)}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${Math.max(8, y - rect.height)}px`;
}

function chooseFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif";
    input.addEventListener("change", () => resolve(input.files[0] || null));
    input.click();
  });
}

async function uploadFile(file) {
  const body = new FormData();
  body.append("file", file);
  const data = await api("/api/upload", { method: "POST", body });
  return data.path;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
}

function ensureBody(job) {
  if (Array.isArray(job.body)) return job.body;
  const body = [];
  for (const block of job.blocks || []) {
    body.push({
      type: "text",
      text: block.text || "",
      markup: escapeHtml(block.text || "").replace(/\n/g, "<br>"),
      background: block.background || "#f4efe6",
      color: block.color || "#2a2420",
    });
  }
  for (const src of job.images || []) body.push({ type: "image", src });
  job.body = body;
  return body;
}

function syncDerived(job) {
  ensureBody(job);
  job.blocks = job.body.filter((item) => item.type === "text").map((item) => ({
    text: item.text || "",
    background: cssHex(item.background, "#f4efe6"),
    color: cssHex(item.color, "#2a2420"),
  }));
  job.images = job.body.filter((item) => item.type === "image").map((item) => item.src).filter(Boolean);
}

function markupFrom(node) {
  let html = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) html += escapeHtml(child.textContent);
    else if (child.nodeName === "BR") html += "<br>";
    else if (child.nodeName === "B" || child.nodeName === "STRONG") html += `<b>${markupFrom(child)}</b>`;
    else if (child.nodeName === "I" || child.nodeName === "EM") html += `<i>${markupFrom(child)}</i>`;
    else {
      if ((child.nodeName === "DIV" || child.nodeName === "P") && html && !html.endsWith("<br>")) html += "<br>";
      html += markupFrom(child);
    }
  }
  return html;
}

function payload() {
  return {
    jobs: state.jobs.map((job) => {
      syncDerived(job);
      return {
        id: job.id,
        name: (job.name || "").trim(),
        align: job.align === "right" ? "right" : "left",
        tagline: (job.tagline || "").trim(),
        colors: YxPalette.jobColors(job),
        body: ensureBody(job).map((item) => (
          item.type === "image"
            ? { type: "image", src: item.src }
            : {
                type: "text",
                text: item.text || "",
                markup: item.markup || "",
                background: cssHex(item.background, "#f4efe6"),
                color: cssHex(item.color, "#2a2420"),
              }
        )),
        blocks: job.blocks,
        banner: job.banner || "",
        portrait: job.portrait || "",
        images: job.images,
        sprites: (job.sprites || []).map((sprite) => ({
          src: sprite.src,
          x: Number(sprite.x) || 0,
          y: Number(sprite.y) || 0,
          rotate: Number(sprite.rotate) || 0,
        })),
      };
    }),
  };
}

async function persist() {
  if (!state.admin) return;
  const saved = await api("/api/site", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  state.jobs = saved.jobs;
}

function quantizeEdge(edge) {
  const step = 160;
  const clamped = Math.min(8192, Math.max(480, Math.round(edge)));
  return Math.ceil(clamped / step) * step;
}

function displayPath(src, edge, quality) {
  const params = new URLSearchParams({
    src,
    w: String(quantizeEdge(edge)),
    q: String(quality),
  });
  return `/api/display?${params}`;
}

function bannerDisplay(src) {
  const pixels = window.innerWidth * (window.devicePixelRatio || 1);
  return displayPath(src, pixels, 90);
}

function galleryDisplay(src) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const css = window.innerHeight;
  const softer = Math.max(css, css * dpr * 0.72);
  return displayPath(src, softer, 74);
}

function bindMenu(node, original, extra) {
  node.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const items = [{ label: "View original", href: original }];
    if (state.admin && extra.replace) items.push({ label: "Replace", action: extra.replace });
    if (state.admin && extra.remove) items.push({ label: "Remove", action: extra.remove });
    if (extra.turn) items.push({ label: "Turn 90°", action: extra.turn });
    showMenu(event.clientX, event.clientY, items);
  });
}

function plate(className, src, alt, options) {
  if (!src) return null;
  const frame = h("figure", { class: className });
  const image = h("img", { src: options.display || src, alt, "data-original": src });
  if (options.kind) image.dataset.kind = options.kind;
  image.addEventListener("load", () => {
    if (options.kind !== "gallery") return;
    const tall = image.naturalHeight > image.naturalWidth;
    frame.classList.toggle("is-tall", tall);
    frame.classList.toggle("is-wide", !tall);
  });
  image.addEventListener("error", () => {
    if (image.getAttribute("src") !== src) {
      image.dataset.fellback = "1";
      image.src = src;
      return;
    }
    frame.remove();
  });
  frame.append(image);
  bindMenu(image, src, options);
  return frame;
}

function renderJob(job) {
  const side = job.align === "right" ? "right" : "left";
  const banner = plate("banner", job.banner, `${job.name} illustration`, {
    kind: "banner",
    display: bannerDisplay(job.banner),
    replace: () => replaceSlot(job, "banner"),
  });
  const portrait = plate("portrait", job.portrait, `${job.name} portrait`, {
    replace: () => replaceSlot(job, "portrait"),
  });
  const copy = h(
    "div",
    { class: "identity-copy" },
    h(
      "h1",
      {},
      h("span", { class: "name-ornament", "aria-hidden": "true" }, h("span")),
      h("span", { class: "name-text" }, job.name)
    ),
    job.tagline ? h("p", { class: "tagline" }, job.tagline) : null
  );
  return h(
    "article",
    { class: `job side-${side}${job.banner ? " has-cover" : ""}` },
    banner,
    h(
      "div",
      { class: "stage" },
      portrait ? h("div", { class: "identity" }, portrait, copy) : copy,
      ...renderFlow(job)
    )
  );
}

function renderFlow(job) {
  ensureBody(job);
  const nodes = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    nodes.push(h("div", { class: "gallery" }, ...run));
    run = [];
  };
  job.body.forEach((item, index) => {
    if (item.type === "image") {
      const figure = plate("plate", item.src, `${job.name} picture`, {
        kind: "gallery",
        display: galleryDisplay(item.src),
        replace: () => replaceBodyImage(job, index),
        remove: () => removeBody(job, index),
      });
      if (figure) run.push(figure);
      return;
    }
    flush();
    if (!state.admin && !(item.text || "").trim()) return;
    const text = h("div", {
      class: "panel-text",
      contenteditable: state.admin ? "true" : null,
      onblur: (event) => commitBlock(job, item, event.target),
    });
    text.innerHTML = item.markup || escapeHtml(item.text || "").replace(/\n/g, "<br>");
    nodes.push(h(
      "section",
      { class: "panel", style: `background:${cssHex(item.background, "#f4efe6")};color:${cssHex(item.color, "#2a2420")}` },
      text
    ));
  });
  flush();
  return nodes;
}

function addText(job) {
  if (!state.admin) return;
  ensureBody(job);
  job.body.push({ type: "text", text: "", markup: "", background: "#f4efe6", color: "#2a2420" });
  paint();
  const fields = document.querySelectorAll(".panel-text[contenteditable='true']");
  const field = fields[fields.length - 1];
  if (field) field.focus();
}

async function commitBlock(job, item, node) {
  if (!state.admin) return;
  const text = node.innerText.replace(/\u00a0/g, " ").replace(/\n$/, "");
  const markup = markupFrom(node);
  if (!text.trim()) {
    const hadText = Boolean((item.text || "").trim());
    job.body = job.body.filter((entry) => entry !== item);
    if (!hadText) {
      paint();
      return;
    }
  } else if (text === item.text && markup === (item.markup || "")) {
    return;
  } else {
    item.text = text;
    item.markup = markup;
  }
  try {
    await persist();
  } catch (error) {
    window.alert(error.message);
    return;
  }
  paint();
}

async function removeBody(job, index) {
  ensureBody(job);
  job.body.splice(index, 1);
  try {
    await persist();
    paint();
  } catch (error) {
    window.alert(error.message);
  }
}

async function replaceBodyImage(job, index) {
  const file = await chooseFile();
  if (!file) return;
  try {
    ensureBody(job);
    job.body[index].src = await uploadFile(file);
    await persist();
    paint();
  } catch (error) {
    window.alert(error.message);
  }
}

function fitOrnament() {
  document.querySelectorAll(".identity-copy h1").forEach((heading) => {
    const name = heading.querySelector(".name-text");
    const ornament = heading.querySelector(".name-ornament");
    if (!name || !ornament) return;
    ornament.style.width = `${Math.ceil(name.getBoundingClientRect().width)}px`;
  });
}

async function replaceSlot(job, key) {
  const file = await chooseFile();
  if (!file) return;
  try {
    job[key] = await uploadFile(file);
    await persist();
    paint();
  } catch (error) {
    window.alert(error.message);
  }
}

async function replaceList(job, key, index) {
  const file = await chooseFile();
  if (!file) return;
  try {
    job[key][index] = key === "sprites" ? { ...job[key][index], src: await uploadFile(file) } : await uploadFile(file);
    await persist();
    paint();
  } catch (error) {
    window.alert(error.message);
  }
}

function renderSprites(job) {
  let layer = document.getElementById("sprites");
  if (!layer) {
    layer = h("div", { id: "sprites", class: "sprites" });
    document.body.append(layer);
  }
  if (!job) {
    layer.replaceChildren();
    return;
  }
  layer.replaceChildren(
    ...(job.sprites || []).map((sprite, index) => {
      const figure = h(
        "figure",
        { class: "sprite", style: `left:${Number(sprite.x) || 0}%;top:${Number(sprite.y) || 0}%;` },
        h("img", { src: sprite.src, alt: "", style: `transform:rotate(${Number(sprite.rotate) || 0}deg)` })
      );
      bindMenu(figure, sprite.src, {
        replace: () => replaceList(job, "sprites", index),
        turn: () => {
          sprite.rotate = ((Number(sprite.rotate) || 0) + 90) % 360;
          figure.querySelector("img").style.transform = `rotate(${sprite.rotate}deg)`;
          if (state.admin) persist().catch((error) => window.alert(error.message));
        },
      });
      bindDrag(figure, sprite);
      return figure;
    })
  );
}

function bindDrag(figure, sprite) {
  let drag = null;
  figure.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = {
      x: event.clientX,
      y: event.clientY,
      left: figure.getBoundingClientRect().left,
      top: figure.getBoundingClientRect().top,
    };
    figure.setPointerCapture(event.pointerId);
    figure.classList.add("is-dragging");
  });
  figure.addEventListener("pointermove", (event) => {
    if (!drag) return;
    figure.style.left = `${drag.left + event.clientX - drag.x}px`;
    figure.style.top = `${drag.top + event.clientY - drag.y}px`;
  });
  const finish = () => {
    if (!drag) return;
    drag = null;
    figure.classList.remove("is-dragging");
    const rect = figure.getBoundingClientRect();
    sprite.x = Math.round(Math.min(92, Math.max(0, (rect.left / window.innerWidth) * 100)) * 100) / 100;
    sprite.y = Math.round(Math.min(92, Math.max(0, (rect.top / window.innerHeight) * 100)) * 100) / 100;
    figure.style.left = `${sprite.x}%`;
    figure.style.top = `${sprite.y}%`;
    if (state.admin) persist().catch((error) => window.alert(error.message));
  };
  figure.addEventListener("pointerup", finish);
  figure.addEventListener("pointercancel", finish);
}

function renderEmpty() {
  return h(
    "section",
    { class: "empty stage" },
    h("p", { class: "kicker" }, "Archive"),
    h("h1", {}, "No jobs yet"),
    h("p", {}, "Each job keeps its own colors, pictures, and text plates."),
    h("a", { class: "text-link", href: "/admin" }, "Open admin")
  );
}

function renderMissing() {
  return h(
    "section",
    { class: "missing stage" },
    h("p", { class: "kicker" }, "Missing"),
    h("h1", {}, "This job is not on the bar"),
    h("a", { class: "text-link", href: "#/" }, "Back to the archive")
  );
}

function paint() {
  const scroll = window.scrollY;
  closeMenu();
  const { job, explicit } = selected(state.jobs);
  YxPalette.applyJobColors(job || {});
  const main = document.getElementById("content");
  if (!state.jobs.length) {
    renderNav([], "");
    main.replaceChildren(renderEmpty());
    renderSprites(null);
    document.title = SITE_NAME;
  } else if (explicit && !job) {
    renderNav(state.jobs, "");
    main.replaceChildren(renderMissing());
    renderSprites(null);
    document.title = `Missing · ${SITE_NAME}`;
  } else {
    renderNav(state.jobs, job.id);
    main.replaceChildren(renderJob(job));
    renderSprites(job);
    document.title = `${job.name} · ${SITE_NAME}`;
  }
  window.scrollTo(0, scroll);
  fitOrnament();
}

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".image-menu")) closeMenu();
});
document.addEventListener("contextmenu", (event) => {
  if (!state.admin) return;
  if (event.target.closest("img, .sprite, .image-menu, a, button, input, textarea, .panel-text")) return;
  const { job } = selected(state.jobs);
  if (!job) return;
  event.preventDefault();
  showMenu(event.clientX, event.clientY, [{ label: "Add text", action: () => addText(job) }]);
});
window.addEventListener("hashchange", () => paint());
let displayTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(displayTimer);
  displayTimer = window.setTimeout(() => {
    document.querySelectorAll("img[data-kind]").forEach((image) => {
      if (image.dataset.fellback) return;
      const src = image.dataset.original;
      const next = image.dataset.kind === "banner" ? bannerDisplay(src) : galleryDisplay(src);
      if (image.getAttribute("src") !== next) image.src = next;
    });
    fitOrnament();
  }, 180);
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitOrnament());

async function boot() {
  const main = document.getElementById("content");
  try {
    const [site, session] = await Promise.all([
      fetch("/api/site", { cache: "no-store", credentials: "same-origin" }).then((response) => {
        if (!response.ok) throw new Error("status");
        return response.json();
      }),
      fetch("/api/session", { cache: "no-store", credentials: "same-origin", headers: { "X-Admin": "1" } }).then((response) => response.json()).catch(() => ({})),
    ]);
    state.jobs = Array.isArray(site.jobs) ? site.jobs : [];
    state.admin = Boolean(session && session.authenticated);
    paint();
  } catch (_error) {
    main.replaceChildren(h("section", { class: "missing stage" }, h("h1", {}, "The archive did not load"), h("p", {}, "The site server is not responding.")));
  }
}

boot();
