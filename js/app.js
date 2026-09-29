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
      return {
        id: job.id,
        name: (job.name || "").trim(),
        align: job.align === "right" ? "right" : "left",
        tagline: (job.tagline || "").trim(),
        colors: YxPalette.jobColors(job),
        body: ensureBody(job).map((item) => (item.type === "image" ? imagePayload(item) : textPayload(item))),
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

function adoptSaved(freshJobs) {
  const prev = state.jobs;
  state.jobs = (freshJobs || []).map((fresh) => {
    const cur = prev.find((item) => item.id === fresh.id) || prev.find((item) => item.name === fresh.name);
    if (!cur) return fresh;
    const sprites = keepSprites(cur.sprites, fresh.sprites);
    Object.assign(cur, fresh);
    cur.sprites = sprites;
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
  const width = flowWidth(item);
  if (width != null) image.w = width;
  if (item.side === "left" || item.side === "right") image.side = item.side;
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
  const width = flowWidth(item);
  if (width != null) {
    record.w = width;
    if (item.side === "left" || item.side === "right") record.side = item.side;
  }
  return record;
}

function flowWidth(item) {
  const width = Number(item.w);
  if (!Number.isFinite(width) || width <= 0) return null;
  const clamped = Math.round(Math.min(100, Math.max(8, width)) * 100) / 100;
  if (clamped >= 100) return null;
  return clamped;
}

function applyFlowSize(node, item) {
  const width = flowWidth(item);
  if (item.type === "image") {
    const side = item.side === "right" ? "right" : "left";
    node.classList.toggle("is-left", side === "left");
    node.classList.toggle("is-right", side === "right");
    node.style.width = width != null ? `${width}%` : "";
    return;
  }
  const side = item.side === "right" ? "right" : "left";
  node.classList.toggle("is-sized", width != null);
  node.classList.toggle("is-left", width != null && side === "left");
  node.classList.toggle("is-right", width != null && side === "right");
  node.style.width = width != null ? `${width}%` : "";
}

function bindMenu(node, original, extra) {
  node.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const items = [];
    if (original) items.push({ label: "View original", href: original });
    if (state.admin && extra.replace) items.push({ label: "Replace", action: extra.replace });
    if (state.admin && extra.remove) items.push({ label: "Remove", action: extra.remove });
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
  ensureBody(job);
  const flow = h("div", { class: "story-text" });
  job.body.forEach((item) => {
    if (item.type === "image") {
      const figure = wrapPic(job, item);
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
    applyFlowSize(section, item);
    if (state.admin) {
      const grab = h("span", { class: "drag", "aria-hidden": "true" });
      const handle = h("span", { class: "resize", "aria-hidden": "true" });
      section.prepend(grab);
      section.append(handle);
      bindStoryDrag(section, job, item, "drag");
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

function wrapPic(job, item) {
  const side = item.side === "right" ? "right" : "left";
  const width = Number(item.w);
  const stage = Math.min(1120, window.innerWidth * 0.92);
  const figure = plate(`wrap-pic is-${side}`, item.src, `${job.name} picture`, {
    kind: "gallery",
    display: galleryDisplay(item.src, stage * ((Number.isFinite(width) && width > 0 ? width : 50) / 100)),
    replace: () => replaceBodyImage(job, item),
    remove: () => removeBody(job, item),
  });
  if (!figure) return null;
  figure._item = item;
  figure.contentEditable = "false";
  if (Number.isFinite(width) && width > 0) figure.style.width = `${width}%`;
  if (state.admin) {
    const handle = h("span", { class: "resize", "aria-hidden": "true" });
    figure.append(handle);
    bindStoryDrag(figure, job, item, "img");
    bindWrapResize(handle, figure, job, item);
  }
  return figure;
}

function tintBlock(item, key, value) {
  const hex = cssHex(value, key === "color" ? "#2a2420" : "#f4efe6");
  item[key] = hex;
  document.querySelectorAll(".story-text .panel").forEach((node) => {
    if (node._item !== item) return;
    node.style[key] = hex;
  });
}

function bindStoryDrag(node, job, item, grab) {
  let drag = null;
  node.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (grab === "img" && !event.target.closest("img")) return;
    if (grab === "drag" && !event.target.closest(".drag")) return;
    const rect = node.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, moved: false };
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
      node.style.width = `${drag.width}px`;
    }
    node.style.left = `${drag.left + dx}px`;
    node.style.top = `${drag.top + dy}px`;
  });
  const stop = () => {
    drag = null;
    node.classList.remove("is-dragging");
    node.style.left = "";
    node.style.top = "";
    node.style.width = flowWidth(item) != null ? `${flowWidth(item)}%` : "";
  };
  node.addEventListener("pointerup", (event) => {
    if (!drag) return;
    const moved = drag.moved;
    const x = event.clientX;
    const y = event.clientY;
    stop();
    if (!moved) return;
    const flow = node.parentElement;
    if (!flow) return;
    const rect = flow.getBoundingClientRect();
    if (item.type === "image" || item.type === "text") {
      item.side = x < rect.left + rect.width / 2 ? "left" : "right";
      applyFlowSize(node, item);
    }
    const kids = [...flow.children].filter((child) => child !== node);
    let at = kids.length;
    node.style.visibility = "hidden";
    const probe = document.elementFromPoint(x, y);
    node.style.visibility = "";
    const hit = probe && probe.closest ? probe.closest(".story-text > *") : null;
    if (hit && hit.parentElement === flow) {
      const hitRect = hit.getBoundingClientRect();
      const index = kids.indexOf(hit);
      at = index < 0 ? kids.length : y < hitRect.top + hitRect.height / 2 ? index : index + 1;
    } else if (y < rect.top) at = 0;
    kids.splice(at, 0, node);
    for (const child of kids) flow.append(child);
    job.body = kids.map((child) => child._item).filter(Boolean);
    persist().then(() => paint()).catch((error) => window.alert(error.message));
  });
  node.addEventListener("pointercancel", () => {
    if (drag) stop();
  });
}

function bindWrapResize(handle, figure, job, item) {
  let resizing = null;

  const move = (event) => {
    if (!resizing) return;
    const px = item.side === "right" ? resizing.anchor - event.clientX : event.clientX - resizing.anchor;
    const percent = Math.min(100, Math.max(8, (px / Math.max(resizing.flow, 1)) * 100));
    resizing.percent = Math.round(percent * 100) / 100;
    figure.style.width = `${resizing.percent}%`;
    if (item.type === "text" && resizing.percent < 100) {
      const side = item.side === "right" ? "right" : "left";
      figure.classList.add("is-sized");
      figure.classList.toggle("is-left", side === "left");
      figure.classList.toggle("is-right", side === "right");
    }
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
    if (percent >= 99.5) delete item.w;
    else {
      item.w = percent;
      if (item.type === "text" && item.side !== "left" && item.side !== "right") item.side = "left";
    }
    applyFlowSize(figure, item);
    if (item.type === "image") refreshPictures();
    persist().catch((error) => window.alert(error.message));
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = figure.getBoundingClientRect();
    const flow = figure.parentElement;
    resizing = {
      anchor: item.side === "right" ? rect.right : rect.left,
      flow: flow ? flow.getBoundingClientRect().width : rect.width,
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    try { handle.setPointerCapture(event.pointerId); } catch (_error) { /* pointer already gone */ }
  });
}

function addText(job, clientY) {
  if (!state.admin) return;
  ensureBody(job);
  const item = { type: "text", text: "", markup: "", background: "#f4efe6", color: "#2a2420", _fresh: true };
  job.body.splice(textInsertAt(clientY), 0, item);
  paint();
  const field = document.querySelector(".panel-text[data-fresh]");
  if (!field) return;
  delete item._fresh;
  field.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  field.focus();
}

function textInsertAt(clientY) {
  const flow = document.querySelector(".story-text");
  if (!flow || clientY == null) return flow ? flow.children.length : 0;
  const kids = [...flow.children];
  for (let index = 0; index < kids.length; index += 1) {
    const rect = kids[index].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return index;
  }
  return kids.length;
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
    for (const file of batch) job.body.push({ type: "image", src: await uploadFile(file) });
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
  requestAnimationFrame(refreshPictures);
}

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".image-menu")) closeMenu();
});
document.addEventListener("contextmenu", (event) => {
  if (!state.admin) return;
  if (event.target.closest("img, .sprite, .image-menu, .resize, .panel, a, button, input, textarea")) return;
  const { job } = selected(state.jobs);
  if (!job) return;
  event.preventDefault();
  showMenu(event.clientX, event.clientY, [
    { label: "Add text", action: () => addText(job, event.clientY) },
    { label: "Add picture", action: () => addPictures(job) },
  ]);
});
window.addEventListener("hashchange", () => paint());
let displayTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(displayTimer);
  displayTimer = window.setTimeout(() => {
    refreshPictures();
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
