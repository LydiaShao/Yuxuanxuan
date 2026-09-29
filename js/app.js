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

function closeFx() {
  document.querySelector(".fx-catalog")?.remove();
  state.fxItem = null;
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
      if (item.color) {
        return h("label", {}, item.label, h("input", {
          type: "color",
          value: item.value,
          onclick: (event) => event.stopPropagation(),
          oninput: (event) => item.oninput(event.target.value),
          onchange: () => item.onchange && item.onchange(),
        }));
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

function raiseBody(job, item) {
  const body = ensureBody(job);
  const at = body.indexOf(item);
  if (at < 0 || at === body.length - 1) return;
  body.splice(at, 1);
  body.push(item);
}

function dedupeBodyImages(job) {
  const body = ensureBody(job);
  const last = new Map();
  body.forEach((item, index) => {
    if (item.type === "image" && item.src) last.set(item.src, index);
  });
  let write = 0;
  body.forEach((item, index) => {
    if (item.type === "image" && last.get(item.src) !== index) return;
    body[write] = item;
    write += 1;
  });
  body.length = write;
  return body;
}

function syncDerived(job) {
  dedupeBodyImages(job);
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

function spriteFields(sprite) {
  const size = Number(sprite.size);
  const shown = Number.isFinite(size) && size > 0 ? size : 50;
  const record = {
    src: sprite.src,
    x: Number(sprite.x) || 0,
    y: Number(sprite.y) || 0,
    rotate: Number(sprite.rotate) || 0,
  };
  if (shown !== 50) record.size = Math.round(Math.min(100, Math.max(20, shown)) * 10) / 10;
  return record;
}

function payload() {
  YxPalette.stampIds(state.jobs);
  return {
    jobs: state.jobs.map((job) => {
      syncDerived(job);
      ensureFreePlace(job);
      return {
        id: job.id,
        name: (job.name || "").trim(),
        align: job.align === "right" ? "right" : "left",
        tagline: (job.tagline || "").trim(),
        colors: YxPalette.jobColors(job),
        body: dedupeBodyImages(job).map((item) => (item.type === "image" ? imagePayload(item) : textPayload(item))),
        blocks: job.blocks,
        banner: job.banner || "",
        portrait: job.portrait || "",
        images: job.images,
        sprites: (job.sprites || []).map(spriteFields),
      };
    }),
  };
}

let persistChain = Promise.resolve();

function persist() {
  if (!state.admin) return Promise.resolve();
  persistChain = persistChain.then(writeSite, writeSite);
  return persistChain;
}

function keepSprites(current, incoming) {
  const sprites = Array.isArray(current) ? current : [];
  const next = Array.isArray(incoming) ? incoming : [];
  next.forEach((item, index) => {
    if (sprites[index]) Object.assign(sprites[index], item);
    else sprites[index] = item;
  });
  sprites.length = next.length;
  return sprites;
}

function keepBody(current, incoming) {
  const prev = Array.isArray(current) ? current.slice() : [];
  const used = new Set();
  return (incoming || []).map((fresh) => {
    let hit = -1;
    for (let index = 0; index < prev.length; index += 1) {
      if (used.has(index)) continue;
      const cur = prev[index];
      if (!cur || cur.type !== fresh.type) continue;
      if (fresh.type === "image" && cur.src === fresh.src) {
        hit = index;
        break;
      }
      if (fresh.type !== "image" && (cur.text || "") === (fresh.text || "")) {
        hit = index;
        break;
      }
    }
    if (hit < 0) return fresh;
    used.add(hit);
    Object.assign(prev[hit], fresh);
    return prev[hit];
  });
}

function adoptSaved(freshJobs) {
  const prev = state.jobs;
  state.jobs = (freshJobs || []).map((fresh) => {
    const cur = prev.find((item) => item.id === fresh.id) || prev.find((item) => item.name === fresh.name);
    if (!cur) return fresh;
    const sprites = keepSprites(cur.sprites, fresh.sprites);
    const body = keepBody(cur.body, fresh.body);
    Object.assign(cur, fresh);
    cur.sprites = sprites;
    cur.body = body;
    return cur;
  });
}

async function writeSite() {
  const { job, explicit } = selected(state.jobs);
  const watching = explicit && job;
  const saved = await api("/api/site", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload()),
  });
  adoptSaved(saved.jobs);
  if (watching) {
    const next = saved.jobs.find((item) => item.id === job.id) || saved.jobs.find((item) => item.name === job.name);
    if (next && location.hash !== `#/job/${encodeURIComponent(next.id)}`) {
      history.replaceState(null, "", `#/job/${encodeURIComponent(next.id)}`);
    }
  }
}

function quantizeEdge(edge) {
  const step = 160;
  const clamped = Math.min(8192, Math.max(480, Math.round(edge)));
  return Math.ceil(clamped / step) * step;
}

function quantizeSprite(edge) {
  const step = 80;
  const clamped = Math.min(1280, Math.max(240, Math.round(edge)));
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

function galleryDisplay(src, cssWidth) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const css = Math.max(1, cssWidth || window.innerWidth * 0.5);
  const softer = Math.max(css, css * dpr * 0.72);
  return displayPath(src, softer, 74);
}

function spriteEdge(scale) {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const css = Math.min(16 * rem, window.innerWidth * 0.34) * Math.max(0.2, scale || 0.5);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  return css * dpr;
}

function spriteDisplay(src, scale) {
  const params = new URLSearchParams({
    src,
    w: String(quantizeSprite(spriteEdge(scale))),
    q: "86",
  });
  return `/api/display?${params}`;
}

function spriteStill(src) {
  const params = new URLSearchParams({ src });
  return `/api/still?${params}`;
}

function imagePayload(item) {
  const image = { type: "image", src: item.src };
  const width = Number(item.w);
  image.w = Number.isFinite(width) && width > 0 ? Math.round(Math.min(100, Math.max(8, width)) * 100) / 100 : 46;
  image.x = Math.round(Math.min(100, Math.max(0, Number(item.x) || 0)) * 100) / 100;
  image.y = Math.round(Math.min(800, Math.max(0, Number(item.y) || 0)) * 100) / 100;
  const rotate = ((Number(item.rotate) || 0) % 360 + 360) % 360;
  if (rotate) image.rotate = Math.round(rotate * 10) / 10;
  if (item.flipX) image.flipX = true;
  if (item.flipY) image.flipY = true;
  [["round", 50], ["dissolve", 48], ["shadow", 40], ["ghost", 40]].forEach(([key, hi]) => {
    const amount = Number(item[key]);
    if (Number.isFinite(amount) && amount > 0) image[key] = Math.round(Math.min(hi, amount) * 10) / 10;
  });
  if (image.ghost && cssHex(item.ghostColor, "")) image.ghostColor = cssHex(item.ghostColor, "");
  if (image.shadow && cssHex(item.shadowColor, "")) image.shadowColor = cssHex(item.shadowColor, "");
  return image;
}

function textPayload(item) {
  const record = {
    type: "text",
    text: item.text || "",
    markup: item.markup || "",
    background: cssHex(item.background, "#f4efe6"),
    color: cssHex(item.color, "#2a2420"),
  };
  const width = Number(item.w);
  record.w = Number.isFinite(width) && width > 0 ? Math.round(Math.min(100, Math.max(8, width)) * 100) / 100 : 56;
  record.x = Math.round(Math.min(100, Math.max(0, Number(item.x) || 0)) * 100) / 100;
  record.y = Math.round(Math.min(800, Math.max(0, Number(item.y) || 0)) * 100) / 100;
  return record;
}

function bindMenu(node, original, extra) {
  node.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const items = [];
    if (original) items.push({ label: "View original", href: original });
    if (state.admin && extra.replace) items.push({ label: "Replace", action: extra.replace });
    if (state.admin && extra.remove) items.push({ label: "Remove", action: extra.remove });
    if (state.admin && extra.effects) items.push({ label: "特效", action: extra.effects });
    if (extra.turn) items.push({ label: "Turn 90°", action: extra.turn });
    if (state.admin && extra.colors) {
      items.push({
        label: "Background",
        color: true,
        value: cssHex(extra.colors.background, "#f4efe6"),
        oninput: (value) => tintBlock(extra.colors, "background", value, false),
        onchange: () => persist().catch((error) => window.alert(error.message)),
      });
      items.push({
        label: "Text color",
        color: true,
        value: cssHex(extra.colors.color, "#2a2420"),
        oninput: (value) => tintBlock(extra.colors, "color", value, false),
        onchange: () => persist().catch((error) => window.alert(error.message)),
      });
    }
    showMenu(event.clientX, event.clientY, items);
  });
}

function plate(className, src, alt, options) {
  if (!src) return null;
  const frame = h("figure", { class: className });
  const image = h("img", { src: options.display || src, alt, "data-original": src, draggable: "false" });
  if (options.kind) image.dataset.kind = options.kind;
  image.addEventListener("error", () => {
    if (image.getAttribute("src") !== src) {
      image.dataset.fellback = "1";
      image.src = src;
      return;
    }
    frame.remove();
  });
  frame.append(image);
  bindMenu(frame, src, options);
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
      ...renderStory(job)
    )
  );
}

function renderStory(job) {
  dedupeBodyImages(job);
  ensureFreePlace(job);
  const flow = h("div", { class: "story-text" });
  job.body.forEach((item, index) => {
    if (item.type === "image") {
      const figure = wrapPic(job, item, index);
      if (figure) flow.append(figure);
      return;
    }
    if (!state.admin && !(item.text || "").trim()) return;
    const text = h("div", {
      class: `panel-text${state.admin && !(item.text || "").trim() ? " is-empty" : ""}`,
      contenteditable: state.admin ? "true" : null,
      oninput: (event) => event.currentTarget.classList.toggle("is-empty", !event.currentTarget.innerText.trim()),
      onblur: (event) => commitBlock(job, item, event.target),
    });
    if (item._fresh) text.dataset.fresh = "1";
    text.innerHTML = item.markup || escapeHtml(item.text || "").replace(/\n/g, "<br>");
    const section = h(
      "section",
      {
        class: "panel",
        style: `background:${cssHex(item.background, "#f4efe6")};color:${cssHex(item.color, "#2a2420")}`,
      },
      text
    );
    section._item = item;
    section.style.zIndex = String(2 + index);
    if (state.admin) {
      const grab = h("span", { class: "drag", "aria-hidden": "true" });
      const handle = h("span", { class: "resize", "aria-hidden": "true" });
      section.prepend(grab);
      section.append(handle);
      bindFreeDrag(section, job, item, ".drag");
      bindWrapResize(handle, section, job, item);
      bindMenu(section, "", {
        colors: item,
        remove: () => removeBody(job, item),
      });
    }
    flow.append(section);
  });
  if (!flow.childNodes.length) return [];
  return [h("div", { class: "story" }, flow)];
}

function ensureFreePlace(job) {
  const texts = [];
  const pics = [];
  ensureBody(job).forEach((item) => {
    if (item.type === "image") pics.push(item);
    else texts.push(item);
  });
  texts.forEach((item, index) => {
    const width = Number(item.w);
    if (!Number.isFinite(width) || width <= 0) item.w = 100;
    if (!Number.isFinite(Number(item.x))) item.x = item.side === "right" ? 40 : 0;
    if (!Number.isFinite(Number(item.y))) item.y = index * 14;
  });
  pics.forEach((item, index) => {
    const width = Number(item.w);
    if (!Number.isFinite(width) || width <= 0) item.w = 46;
    if (!Number.isFinite(Number(item.x))) item.x = item.side === "right" ? 52 : 0;
    if (!Number.isFinite(Number(item.y))) item.y = index * 22;
    if (!Number.isFinite(Number(item.rotate))) item.rotate = 0;
  });
}

function applyFreePlace(node, item, flow) {
  const width = Number(item.w);
  const fallback = item.type === "image" ? 46 : 56;
  node.style.width = `${Number.isFinite(width) && width > 0 ? Math.min(100, Math.max(8, width)) : fallback}%`;
  node.style.left = `${Math.min(100, Math.max(0, Number(item.x) || 0))}%`;
  const column = flow.clientWidth || 1;
  node.style.top = `${(Math.min(800, Math.max(0, Number(item.y) || 0)) / 100) * column}px`;
  if (item.type === "image") applyPicFx(node, item);
}

function pinStory() {
  const flow = document.querySelector(".story-text");
  if (!flow) return;
  let bottom = 0;
  flow.querySelectorAll(":scope > .panel, :scope > .wrap-pic").forEach((node) => {
    bottom = Math.max(bottom, node.offsetTop + node.offsetHeight);
  });
  flow.style.minHeight = `${Math.max(bottom + 24, 48)}px`;
}

function layoutFreePics() {
  const flow = document.querySelector(".story-text");
  if (!flow) return;
  flow.querySelectorAll(":scope > .wrap-pic, :scope > .panel").forEach((node) => {
    if (node._item) applyFreePlace(node, node._item, flow);
  });
  pinStory();
}

function fxAmount(value, hi) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.min(hi, amount);
}

function hexAlpha(hex, alpha, fallback) {
  const clean = cssHex(hex, fallback || "#14100e").slice(1);
  const n = parseInt(clean, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function picTransform(item) {
  const rotate = Number(item.rotate) || 0;
  const sx = item.flipX ? -1 : 1;
  const sy = item.flipY ? -1 : 1;
  return `rotate(${rotate}deg) scale(${sx}, ${sy})`;
}

function applyPicFx(node, item) {
  const stage = node.querySelector(".wrap-pic-stage");
  const clip = node.querySelector(".wrap-pic-clip");
  if (!stage || !clip) return;
  const round = fxAmount(item.round, 50);
  const dissolve = fxAmount(item.dissolve, 48);
  clip.style.borderRadius = round ? `${round}%` : "";
  if (dissolve) {
    const edge = `${dissolve}%`;
    const across = `linear-gradient(to right, transparent 0, #000 ${edge}, #000 calc(100% - ${edge}), transparent 100%)`;
    const down = `linear-gradient(to bottom, transparent 0, #000 ${edge}, #000 calc(100% - ${edge}), transparent 100%)`;
    clip.style.webkitMaskImage = `${across}, ${down}`;
    clip.style.maskImage = `${across}, ${down}`;
    clip.style.webkitMaskComposite = "source-in";
    clip.style.maskComposite = "intersect";
    clip.style.webkitMaskRepeat = "no-repeat";
    clip.style.maskRepeat = "no-repeat";
  } else {
    clip.style.webkitMaskImage = "";
    clip.style.maskImage = "";
    clip.style.webkitMaskComposite = "";
    clip.style.maskComposite = "";
  }
  const filters = [];
  const ghost = fxAmount(item.ghost, 40);
  if (ghost) {
    const px = Math.max(2, Math.round(ghost * 0.4));
    filters.push(`drop-shadow(${px}px ${px}px 0 ${cssHex(item.ghostColor, "#1a1018")})`);
  }
  const shadow = fxAmount(item.shadow, 40);
  if (shadow) {
    const y = Math.max(2, Math.round(shadow * 0.28));
    const blur = Math.max(4, Math.round(shadow * 0.55));
    filters.push(`drop-shadow(0 ${y}px ${blur}px ${hexAlpha(item.shadowColor, 0.42, "#14100e")})`);
  }
  stage.style.filter = filters.join(" ");
  stage.style.transform = picTransform(item);
}

function livePicFx(item) {
  document.querySelectorAll(".wrap-pic").forEach((node) => {
    if (node._item === item) applyPicFx(node, item);
  });
  pinStory();
}

const FX_PRESETS = [
  { label: "无", round: 0, dissolve: 0, shadow: 0, ghost: 0 },
  { label: "圆角", round: 20, dissolve: 0, shadow: 0, ghost: 0 },
  { label: "边缘溶解", round: 0, dissolve: 24, shadow: 0, ghost: 0 },
  { label: "阴影", round: 0, dissolve: 0, shadow: 24, ghost: 0 },
  { label: "实色阴影", round: 0, dissolve: 0, shadow: 0, ghost: 20 },
  { label: "贴纸", round: 16, dissolve: 0, shadow: 18, ghost: 0 },
];

function fxRow(label, control) {
  return h("label", { class: "fx-row" }, h("span", {}, label), control);
}

function fxRange(item, key, hi, extra) {
  const input = h("input", {
    type: "range",
    min: "0",
    max: String(hi),
    step: "1",
    value: String(Math.round(fxAmount(item[key], hi))),
    oninput: (event) => {
      item[key] = Number(event.currentTarget.value);
      if (extra) extra();
      livePicFx(item);
    },
    onchange: () => persist().catch((error) => window.alert(error.message)),
  });
  input.dataset.fx = key;
  return input;
}

function showFxCatalog(anchor, item) {
  closeMenu();
  closeFx();
  state.fxItem = item;
  let catalog = null;
  const rotate = h("input", {
    type: "range",
    min: "0",
    max: "359",
    step: "1",
    value: String(Math.round(((Number(item.rotate) || 0) % 360 + 360) % 360)),
    oninput: (event) => {
      item.rotate = Number(event.currentTarget.value);
      if (catalog) catalog.querySelector("[data-fx-deg]").textContent = `${Math.round(item.rotate)}°`;
      livePicFx(item);
    },
    onchange: () => persist().catch((error) => window.alert(error.message)),
  });
  const deg = h("span", { "data-fx-deg": "1" }, `${Math.round(((Number(item.rotate) || 0) % 360 + 360) % 360)}°`);
  const ghostColor = h("input", {
    type: "color",
    value: cssHex(item.ghostColor, "#1a1018"),
    oninput: (event) => {
      item.ghostColor = event.currentTarget.value;
      livePicFx(item);
    },
    onchange: () => persist().catch((error) => window.alert(error.message)),
  });
  const shadowColor = h("input", {
    type: "color",
    value: cssHex(item.shadowColor, "#14100e"),
    oninput: (event) => {
      item.shadowColor = event.currentTarget.value;
      livePicFx(item);
    },
    onchange: () => persist().catch((error) => window.alert(error.message)),
  });
  catalog = h(
    "div",
    { class: "fx-catalog", role: "dialog", "aria-label": "图片特效" },
    h("p", { class: "fx-title" }, "图片特效"),
    h(
      "div",
      { class: "fx-presets" },
      ...FX_PRESETS.map((preset) =>
        h("button", {
          type: "button",
          onclick: () => {
            item.round = preset.round;
            item.dissolve = preset.dissolve;
            item.shadow = preset.shadow;
            item.ghost = preset.ghost;
            catalog.querySelectorAll("input[data-fx]").forEach((input) => {
              input.value = String(Math.round(fxAmount(item[input.dataset.fx], Number(input.max))));
            });
            livePicFx(item);
            persist().catch((error) => window.alert(error.message));
          },
        }, preset.label)
      )
    ),
    fxRow("旋转", h("div", { class: "fx-pair" }, rotate, deg)),
    h(
      "div",
      { class: "fx-row" },
      h("span", {}, "镜像"),
      h(
        "div",
        { class: "fx-pair" },
        h("button", {
          type: "button",
          class: item.flipX ? "is-on" : "",
          onclick: (event) => {
            item.flipX = !item.flipX;
            event.currentTarget.classList.toggle("is-on", item.flipX);
            livePicFx(item);
            persist().catch((error) => window.alert(error.message));
          },
        }, "左右"),
        h("button", {
          type: "button",
          class: item.flipY ? "is-on" : "",
          onclick: (event) => {
            item.flipY = !item.flipY;
            event.currentTarget.classList.toggle("is-on", item.flipY);
            livePicFx(item);
            persist().catch((error) => window.alert(error.message));
          },
        }, "上下")
      )
    ),
    fxRow("圆角", fxRange(item, "round", 50)),
    fxRow("边缘溶解", fxRange(item, "dissolve", 48)),
    fxRow("阴影", h("div", { class: "fx-pair" }, fxRange(item, "shadow", 40), shadowColor)),
    fxRow("实色阴影", h("div", { class: "fx-pair" }, fxRange(item, "ghost", 40), ghostColor))
  );
  document.body.append(catalog);
  const box = anchor.getBoundingClientRect();
  const width = catalog.offsetWidth || 240;
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, box.right + 8));
  const top = Math.min(window.innerHeight - catalog.offsetHeight - 8, Math.max(8, box.top));
  catalog.style.left = `${left}px`;
  catalog.style.top = `${top}px`;
}

function bindSpin(figure, item) {
  const handle = figure.querySelector(".spin");
  if (!handle) return;
  let spin = null;
  const move = (event) => {
    if (!spin) return;
    const box = figure.getBoundingClientRect();
    const angle = (Math.atan2(event.clientY - spin.cy, event.clientX - spin.cx) * 180) / Math.PI;
    item.rotate = Math.round((((spin.base + angle - spin.start) % 360) + 360) % 360);
    applyPicFx(figure, item);
    const deg = document.querySelector("[data-fx-deg]");
    const slider = document.querySelector(".fx-catalog input[type='range'][min='0'][max='359']");
    if (deg) deg.textContent = `${Math.round(item.rotate)}°`;
    if (slider) slider.value = String(Math.round(item.rotate));
  };
  const finish = () => {
    if (!spin) return;
    spin = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    persist().catch((error) => window.alert(error.message));
  };
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const box = figure.getBoundingClientRect();
    spin = {
      cx: box.left + box.width / 2,
      cy: box.top + box.height / 2,
      start: (Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2)) * 180) / Math.PI,
      base: Number(item.rotate) || 0,
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  });
}

function wrapPic(job, item, index) {
  const width = Number(item.w);
  const stageWidth = Math.min(1120, window.innerWidth * 0.92);
  const options = {
    kind: "gallery",
    display: galleryDisplay(item.src, stageWidth * ((Number.isFinite(width) && width > 0 ? width : 46) / 100)),
    replace: () => replaceBodyImage(job, item),
    remove: () => removeBody(job, item),
  };
  if (state.admin) {
    options.effects = () => {
      const node = document.querySelectorAll(".wrap-pic");
      let hit = null;
      node.forEach((entry) => {
        if (entry._item === item) hit = entry;
      });
      if (hit) showFxCatalog(hit, item);
    };
  }
  const figure = plate("wrap-pic", item.src, `${job.name} picture`, options);
  if (!figure) return null;
  const image = figure.querySelector("img");
  const clip = h("div", { class: "wrap-pic-clip" });
  const stage = h("div", { class: "wrap-pic-stage" }, clip);
  clip.append(image);
  figure.append(stage);
  figure._item = item;
  figure.contentEditable = "false";
  figure.style.zIndex = String(2 + (Number(index) || 0));
  if (image) image.addEventListener("load", pinStory);
  applyPicFx(figure, item);
  if (state.admin) {
    const handle = h("span", { class: "resize", "aria-hidden": "true" });
    const spin = h("span", { class: "spin", "aria-hidden": "true", title: "旋转" });
    figure.append(handle, spin);
    bindFreeDrag(figure, job, item);
    bindWrapResize(handle, figure, job, item);
    bindSpin(figure, item);
  }
  return figure;
}

function bindFreeDrag(node, job, item, grab) {
  let drag = null;
  let saveTimer = 0;

  function remember() {
    const flow = node.parentElement;
    if (!flow) return;
    const box = flow.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const column = box.width || 1;
    item.x = Math.round(Math.min(100, Math.max(0, ((rect.left - box.left) / column) * 100)) * 100) / 100;
    item.y = Math.round(Math.min(800, Math.max(0, ((rect.top - box.top) / column) * 100)) * 100) / 100;
  }

  function saveNow() {
    if (!state.admin) return;
    window.clearTimeout(saveTimer);
    persist().catch((error) => window.alert(error.message));
  }

  node.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".resize, .spin, .fx-catalog")) return;
    if (grab && !event.target.closest(grab)) return;
    const rect = node.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    node.style.zIndex = "40";
    event.preventDefault();
    try { node.setPointerCapture(event.pointerId); } catch (_error) { /* pointer already gone */ }
  });
  node.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      node.classList.add("is-dragging");
      const flow = node.parentElement.getBoundingClientRect();
      node.style.left = `${drag.left - flow.left}px`;
      node.style.top = `${drag.top - flow.top}px`;
      raiseBody(job, item);
    }
    const flow = node.parentElement.getBoundingClientRect();
    node.style.left = `${drag.left + dx - flow.left}px`;
    node.style.top = `${drag.top + dy - flow.top}px`;
    remember();
  });
  const finish = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    node.classList.remove("is-dragging");
    if (!moved) return;
    remember();
    const flow = node.parentElement;
    if (flow) applyFreePlace(node, item, flow);
    pinStory();
    saveNow();
  };
  node.addEventListener("pointerup", finish);
  node.addEventListener("pointercancel", finish);
}

function tintBlock(item, key, value) {
  const hex = cssHex(value, key === "color" ? "#2a2420" : "#f4efe6");
  item[key] = hex;
  document.querySelectorAll(".story-text .panel").forEach((node) => {
    if (node._item !== item) return;
    node.style[key] = hex;
  });
}

function bindWrapResize(handle, figure, job, item) {
  let resizing = null;

  const move = (event) => {
    if (!resizing) return;
    const px = event.clientX - resizing.anchor;
    const percent = Math.min(100, Math.max(8, (px / Math.max(resizing.flow, 1)) * 100));
    resizing.percent = Math.round(percent * 100) / 100;
    figure.style.width = `${resizing.percent}%`;
  };

  const finish = () => {
    if (!resizing) return;
    const percent = resizing.percent;
    resizing = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("mousemove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("mouseup", finish);
    window.removeEventListener("pointercancel", finish);
    if (percent == null) return;
    item.w = percent;
    const flow = figure.parentElement;
    if (flow) applyFreePlace(figure, item, flow);
    if (item.type === "image") refreshPictures();
    pinStory();
    persist().catch((error) => window.alert(error.message));
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = figure.getBoundingClientRect();
    const flow = figure.parentElement;
    resizing = {
      anchor: rect.left,
      flow: flow ? flow.getBoundingClientRect().width : rect.width,
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("mousemove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("mouseup", finish);
    window.addEventListener("pointercancel", finish);
    try { handle.setPointerCapture(event.pointerId); } catch (_error) { /* pointer already gone */ }
  });
}

function addText(job, clientX, clientY) {
  if (!state.admin) return;
  ensureBody(job);
  const flow = document.querySelector(".story-text");
  let x = 4;
  let y = 8;
  if (flow && clientX != null && clientY != null) {
    const box = flow.getBoundingClientRect();
    const column = box.width || 1;
    x = Math.round(Math.min(80, Math.max(0, ((clientX - box.left) / column) * 100)) * 100) / 100;
    y = Math.round(Math.min(800, Math.max(0, ((clientY - box.top) / column) * 100)) * 100) / 100;
  }
  const item = {
    type: "text",
    text: "",
    markup: "",
    background: "#f4efe6",
    color: "#2a2420",
    w: 56,
    x,
    y,
    _fresh: true,
  };
  job.body.push(item);
  paint();
  const field = document.querySelector(".panel-text[data-fresh]");
  if (!field) return;
  delete item._fresh;
  field.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  field.focus();
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

async function removeBody(job, item) {
  job.body = ensureBody(job).filter((entry) => entry !== item);
  try {
    await persist();
    paint();
  } catch (error) {
    window.alert(error.message);
  }
}

async function replaceBodyImage(job, item) {
  const file = await chooseFile();
  if (!file) return;
  try {
    item.src = await uploadFile(file);
    await persist();
    paint();
  } catch (error) {
    window.alert(error.message);
  }
}

function choosePictures() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/jpeg,image/png,image/webp,image/gif";
    input.addEventListener("change", () => resolve([...input.files]));
    input.click();
  });
}

async function addPictures(job) {
  if (!state.admin) return;
  const files = await choosePictures();
  if (!files.length) return;
  ensureBody(job);
  const room = 40 - job.body.filter((item) => item.type === "image").length;
  if (room <= 0) {
    window.alert("This page already has 40 pictures.");
    return;
  }
  const batch = files.slice(0, room);
  try {
    for (const file of batch) {
      const count = job.body.filter((item) => item.type === "image").length;
      job.body.push({
        type: "image",
        src: await uploadFile(file),
        w: 46,
        x: 4 + (count % 2) * 48,
        y: 6 + Math.floor(count / 2) * 28,
        rotate: 0,
      });
    }
    await persist();
    paint();
  } catch (error) {
    window.alert(error.message);
  }
}

function fitOrnament() {
  document.querySelectorAll(".identity-copy h1").forEach((heading) => {
    const name = heading.querySelector(".name-text");
    if (!name) return;
    const width = Math.ceil(name.getBoundingClientRect().width);
    if (!width) return;
    heading.querySelectorAll(".name-ornament").forEach((ornament) => {
      ornament.style.width = `${width}px`;
    });
  });
}

function refreshPictures() {
  document.querySelectorAll("img[data-kind]").forEach((image) => {
    if (image.dataset.fellback) return;
    const src = image.dataset.original;
    if (!src) return;
    const frame = image.closest("figure");
    const css = image.dataset.kind === "banner" ? window.innerWidth : frame && frame.clientWidth;
    const next = image.dataset.kind === "banner" ? bannerDisplay(src) : galleryDisplay(src, css);
    if (image.getAttribute("src") !== next) image.src = next;
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

function hopVars(rotate) {
  const deg = ((Number(rotate) || 0) % 360 + 360) % 360;
  let x = 0;
  let y = -1;
  if (deg === 90) {
    x = 1;
    y = 0;
  } else if (deg === 180) {
    x = 0;
    y = 1;
  } else if (deg === 270) {
    x = -1;
    y = 0;
  }
  return {
    "--hop-x": `${x * 1.15}rem`,
    "--hop-y": `${y * 1.15}rem`,
    "--hop-x2": `${x * 0.42}rem`,
    "--hop-y2": `${y * 0.42}rem`,
  };
}

function hopStyle(rotate) {
  return Object.entries(hopVars(rotate))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
}

function applyHop(figure, rotate) {
  Object.entries(hopVars(rotate)).forEach(([name, value]) => figure.style.setProperty(name, value));
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
      const size = Number(sprite.size);
      const scale = (Number.isFinite(size) && size > 0 ? size : 50) / 100;
      const image = h("img", {
        alt: "",
        style: `transform:rotate(${Number(sprite.rotate) || 0}deg)`,
      });
      const figure = h(
        "figure",
        {
          class: "sprite",
          style: `left:${Number(sprite.x) || 0}%;top:${Number(sprite.y) || 0}%;--sprite-size:${scale};${hopStyle(sprite.rotate)}`,
        },
        image
      );
      bindGif(image, sprite.src, scale);
      bindMenu(figure, sprite.src, {
        replace: () => replaceList(job, "sprites", index),
        turn: () => {
          sprite.rotate = ((Number(sprite.rotate) || 0) + 90) % 360;
          figure.querySelector("img").style.transform = `rotate(${sprite.rotate}deg)`;
          applyHop(figure, sprite.rotate);
          if (state.admin) persist().catch((error) => window.alert(error.message));
        },
      });
      bindDrag(figure, sprite);
      return figure;
    })
  );
}

function bindGif(image, src, scale) {
  const motion = /\.gif(?:$|[?#])/i.test(src);
  const figure = image.closest("figure");
  if (motion) figure?.classList.add("is-gif");
  if (!motion) {
    image.src = spriteDisplay(src, scale);
    image.addEventListener("error", () => {
      if (image.getAttribute("src") !== src) image.src = src;
    });
    return;
  }
  const still = spriteStill(src);
  image.src = still;
  image.addEventListener("error", () => {
    if (image.getAttribute("src") !== src) image.src = src;
  });
  const host = figure || image;
  host.addEventListener("pointerenter", () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    image.src = src;
  });
  host.addEventListener("pointerleave", () => {
    if (!host.classList.contains("is-dragging")) image.src = still;
  });
}

function bindDrag(figure, sprite) {
  let drag = null;
  let saveTimer = 0;

  function remember() {
    const rect = figure.getBoundingClientRect();
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    sprite.x = Math.round(Math.min(92, Math.max(0, (rect.left / width) * 100)) * 100) / 100;
    sprite.y = Math.round(Math.min(92, Math.max(0, (rect.top / height) * 100)) * 100) / 100;
  }

  function saveNow() {
    if (!state.admin) return;
    window.clearTimeout(saveTimer);
    persist().catch((error) => window.alert(error.message));
  }

  function saveSoon() {
    if (!state.admin) return;
    remember();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveNow, 160);
  }

  figure.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = {
      x: event.clientX,
      y: event.clientY,
      left: figure.getBoundingClientRect().left,
      top: figure.getBoundingClientRect().top,
      moved: false,
    };
    figure.setPointerCapture(event.pointerId);
  });
  figure.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      figure.classList.add("is-dragging");
    }
    figure.style.left = `${drag.left + dx}px`;
    figure.style.top = `${drag.top + dy}px`;
    saveSoon();
  });
  const finish = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    figure.classList.remove("is-dragging");
    if (!moved) return;
    remember();
    figure.style.left = `${sprite.x}%`;
    figure.style.top = `${sprite.y}%`;
    saveNow();
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
  closeFx();
  document.body.classList.toggle("is-admin", state.admin);
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
  requestAnimationFrame(() => {
    refreshPictures();
    layoutFreePics();
  });
}

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".image-menu")) closeMenu();
  if (event.target.closest(".fx-catalog, .spin, .image-menu")) return;
  const pic = event.target.closest(".wrap-pic");
  if (!pic || pic._item !== state.fxItem) closeFx();
});
document.addEventListener("contextmenu", (event) => {
  if (!state.admin) return;
  if (event.target.closest("img, .sprite, .image-menu, .fx-catalog, .resize, .spin, .panel, a, button, input, textarea")) return;
  const { job } = selected(state.jobs);
  if (!job) return;
  event.preventDefault();
  showMenu(event.clientX, event.clientY, [
    { label: "Add text", action: () => addText(job, event.clientX, event.clientY) },
    { label: "Add picture", action: () => addPictures(job) },
  ]);
});
window.addEventListener("hashchange", () => paint());
let displayTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(displayTimer);
  displayTimer = window.setTimeout(() => {
    refreshPictures();
    layoutFreePics();
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
