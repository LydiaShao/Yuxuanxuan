"use strict";

const SITE_NAME = "Yuxuanxuan";

const state = {
  jobs: [],
  admin: false,
  dirty: false,
  message: "",
  error: "",
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
  const headers = { ...(options.headers || {}) };
  if (state.admin) headers["X-Admin"] = "1";
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

function currentJob() {
  return selected(state.jobs).job;
}

function slugify(name) {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "job";
  let id = base.slice(0, 40);
  let n = 2;
  const taken = new Set(state.jobs.map((job) => job.id));
  while (taken.has(id)) {
    id = `${base}-${n}`.slice(0, 40);
    n += 1;
  }
  return id;
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

function plate(className, src, alt, onRemove) {
  if (!src) return null;
  const frame = h("figure", { class: className });
  const image = h("img", { src, alt });
  image.addEventListener("error", () => frame.remove());
  frame.append(image);
  if (onRemove) frame.append(h("button", { type: "button", class: "mini", onclick: onRemove }, "去掉"));
  return frame;
}

function fileButton(label, onFile) {
  const input = h("input", {
    type: "file",
    accept: "image/jpeg,image/png,image/webp,image/gif",
    onchange: (event) => onFile(event.target.files[0], event.target),
  });
  return h("label", { class: "file-button" }, label, input);
}

function colorField(label, value, onColor) {
  const picker = h("input", {
    type: "color",
    value: cssHex(value, "#000000"),
    "aria-label": label,
    oninput: (event) => {
      const next = event.target.value.toLowerCase();
      onColor(next);
      const text = event.target.parentElement.querySelector('input[type="text"]');
      if (text) text.value = next;
    },
  });
  const text = h("input", {
    type: "text",
    value: value || "",
    spellcheck: "false",
    "aria-label": `${label}色值`,
    oninput: (event) => {
      const next = event.target.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(next)) {
        const hex = next.toLowerCase();
        onColor(hex);
        picker.value = hex;
      }
    },
  });
  return h("label", { class: "color-field" }, label, picker, text);
}

function editable(tag, className, value, onValue, placeholder) {
  const node = h(tag, {
    class: className,
    contenteditable: "true",
    role: "textbox",
    "aria-label": placeholder || "",
    oninput: () => onValue(node.textContent),
  });
  node.textContent = value || "";
  if (placeholder) node.dataset.placeholder = placeholder;
  return node;
}

function renderJob(job) {
  const side = job.align === "right" ? "right" : "left";
  const banner = plate("banner", job.banner, `${job.name} illustration`, state.admin ? () => clearMedia(job, "banner") : null);
  const portrait = plate("portrait", job.portrait, `${job.name} portrait`, state.admin ? () => clearMedia(job, "portrait") : null);
  const copy = h(
    "div",
    { class: "identity-copy" },
    state.admin
      ? editable("h1", "", job.name, (value) => {
          job.name = value;
          state.dirty = true;
          const active = document.querySelector('.job-nav a[aria-current="page"]');
          if (active) active.textContent = value || "Untitled";
        }, "Job name")
      : h("h1", {}, job.name),
    state.admin
      ? editable("p", "tagline", job.tagline, (value) => {
          job.tagline = value;
          state.dirty = true;
        }, "A short line")
      : job.tagline
        ? h("p", { class: "tagline" }, job.tagline)
        : null
  );
  const identity = portrait || state.admin
    ? h(
        "div",
        { class: "identity" },
        portrait || (state.admin ? fileButton("加邮票", (file, input) => upload(file, input, (path) => { job.portrait = path; })) : null),
        copy
      )
    : copy;
  const blocks = (job.blocks || []).filter((block) => state.admin || (block.text || "").trim());
  const article = h(
    "article",
    { class: `job side-${side}${job.banner ? " has-cover" : ""}` },
    state.admin ? fileButton(job.banner ? "换横图" : "加横图", (file, input) => upload(file, input, (path) => { job.banner = path; })) : null,
    banner,
    h(
      "div",
      { class: "stage" },
      identity,
      h(
        "div",
        { class: "blocks" },
        ...blocks.map((block, index) => renderBlock(job, block, index))
      ),
      h(
        "div",
        { class: "gallery" },
        ...(job.images || []).map((src, index) =>
          plate("plate", src, `${job.name} picture ${index + 1}`, state.admin ? () => removeImage(job, index) : null)
        )
      )
    )
  );
  return article;
}

function renderBlock(job, block, index) {
  const body = state.admin
    ? editable("div", "panel-text", block.text, (value) => {
        block.text = value;
        state.dirty = true;
      }, "Text")
    : h("div", { class: "panel-text" }, block.text);
  const panel = h(
    "section",
    { class: "panel", style: `background:${cssHex(block.background, "#f4efe6")};color:${cssHex(block.color, "#2a2420")}` },
    body,
    state.admin
      ? h(
          "div",
          { class: "panel-tools" },
          colorField("板块底色", block.background, (next) => {
            block.background = next;
            state.dirty = true;
            paint();
          }),
          colorField("板块文字", block.color, (next) => {
            block.color = next;
            state.dirty = true;
            paint();
          }),
          h("button", { type: "button", class: "mini", onclick: () => removeBlock(job, index) }, "去掉")
        )
      : null
  );
  return panel;
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
  if (!Array.isArray(job.sprites)) job.sprites = [];
  layer.replaceChildren(
    ...job.sprites.map((sprite, index) => {
      const figure = h(
        "figure",
        {
          class: "sprite",
          style: `left:${Number(sprite.x) || 0}%;top:${Number(sprite.y) || 0}%;`,
        },
        h("img", { src: sprite.src, alt: "", style: `transform:rotate(${Number(sprite.rotate) || 0}deg)` }),
        h("button", {
          type: "button",
          class: "turn",
          "aria-label": "Rotate",
          onclick: (event) => {
            event.stopPropagation();
            sprite.rotate = ((Number(sprite.rotate) || 0) + 90) % 360;
            if (state.admin) markDirty();
            figure.querySelector("img").style.transform = `rotate(${sprite.rotate}deg)`;
          },
        }, "↻"),
        state.admin ? h("button", { type: "button", class: "mini sprite-remove", onclick: () => removeSprite(job, index) }, "去掉") : null
      );
      bindDrag(figure, sprite);
      return figure;
    })
  );
}

function bindDrag(figure, sprite) {
  let drag = null;
  figure.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
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
    const left = drag.left + event.clientX - drag.x;
    const top = drag.top + event.clientY - drag.y;
    figure.style.left = `${left}px`;
    figure.style.top = `${top}px`;
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
    if (state.admin) markDirty();
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
    state.admin ? null : h("a", { class: "text-link", href: "/admin" }, "Open admin")
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

function renderDock(job) {
  let dock = document.getElementById("edit-dock");
  if (!state.admin) {
    if (dock) dock.remove();
    return;
  }
  if (!dock) {
    dock = h("div", { id: "edit-dock", class: "edit-dock" });
    document.body.append(dock);
  }
  const colors = job ? job.colors : YxPalette.JOB_DEFAULTS;
  dock.replaceChildren(
    h("p", { class: "edit-status" }, state.error || state.message || (state.dirty ? "还没保存。" : "改动在这页上完成。")),
    job
      ? h(
          "div",
          { class: "edit-colors" },
          colorField("页面背景", colors.background, (next) => setColor(job, "background", next)),
          colorField("顶栏", colors.bar, (next) => setColor(job, "bar", next)),
          colorField("顶栏文字", colors.barText, (next) => setColor(job, "barText", next)),
          colorField("文字", colors.text, (next) => setColor(job, "text", next)),
          colorField("次要文字", colors.muted, (next) => setColor(job, "muted", next))
        )
      : null,
    h(
      "div",
      { class: "edit-actions" },
      h("button", { type: "button", class: "primary", onclick: save }, "保存"),
      job ? h("button", { type: "button", onclick: () => setAlign(job, "left") }, "靠左") : null,
      job ? h("button", { type: "button", onclick: () => setAlign(job, "right") }, "靠右") : null,
      job ? h("button", { type: "button", onclick: () => addBlock(job) }, "加文字") : null,
      job ? fileButton("加画廊图", (file, input) => upload(file, input, (path) => job.images.push(path))) : null,
      job ? fileButton("加小人", (file, input) => upload(file, input, (path) => job.sprites.push({ src: path, x: 6 + job.sprites.length * 8, y: 18, rotate: 0 }))) : null,
      h("button", { type: "button", onclick: addJob }, "新职业"),
      job ? h("button", { type: "button", class: "danger", onclick: () => removeJob(job) }, "删除此页") : null,
      h("button", { type: "button", onclick: logout }, "退出")
    )
  );
}

function markDirty() {
  state.dirty = true;
  const status = document.querySelector(".edit-status");
  if (status && !state.error) status.textContent = "还没保存。";
}

function setColor(job, key, value) {
  job.colors[key] = value;
  state.dirty = true;
  YxPalette.applyJobColors(job);
  const status = document.querySelector(".edit-status");
  if (status) status.textContent = "还没保存。";
}

function setAlign(job, side) {
  job.align = side;
  state.dirty = true;
  paint();
}

function addBlock(job) {
  job.blocks.push({ text: "", background: "#f4efe6", color: "#2a2420" });
  state.dirty = true;
  paint();
}

function removeBlock(job, index) {
  job.blocks.splice(index, 1);
  state.dirty = true;
  paint();
}

function removeImage(job, index) {
  job.images.splice(index, 1);
  state.dirty = true;
  paint();
}

function removeSprite(job, index) {
  job.sprites.splice(index, 1);
  state.dirty = true;
  paint();
}

function clearMedia(job, key) {
  job[key] = "";
  state.dirty = true;
  paint();
}

function addJob() {
  const job = {
    id: slugify("New Job"),
    name: "New Job",
    align: "left",
    tagline: "",
    colors: YxPalette.jobColors({}),
    blocks: [],
    banner: "",
    portrait: "",
    images: [],
    sprites: [],
  };
  state.jobs.push(job);
  state.dirty = true;
  location.hash = `#/job/${job.id}`;
  paint();
}

function removeJob(job) {
  if (!window.confirm(`删除 ${job.name || "这个职业"}？`)) return;
  state.jobs = state.jobs.filter((item) => item !== job);
  state.dirty = true;
  location.hash = "#/";
  paint();
}

async function upload(file, input, assign) {
  if (!file) return;
  state.error = "";
  state.message = "正在上传…";
  renderDock(currentJob());
  try {
    const body = new FormData();
    body.append("file", file);
    const data = await api("/api/upload", { method: "POST", body });
    assign(data.path);
    state.dirty = true;
    state.message = "图片已放上，记得保存。";
  } catch (error) {
    state.error = error.message;
    state.message = "";
  }
  if (input) input.value = "";
  paint();
}

function payload() {
  return {
    jobs: state.jobs.map((job) => ({
      id: job.id,
      name: (job.name || "").trim(),
      align: job.align === "right" ? "right" : "left",
      tagline: (job.tagline || "").trim(),
      colors: YxPalette.jobColors(job),
      blocks: (job.blocks || []).map((block) => ({
        text: block.text || "",
        background: cssHex(block.background, "#f4efe6"),
        color: cssHex(block.color, "#2a2420"),
      })),
      banner: job.banner || "",
      portrait: job.portrait || "",
      images: (job.images || []).filter(Boolean),
      sprites: (job.sprites || []).map((sprite) => ({
        src: sprite.src,
        x: Number(sprite.x) || 0,
        y: Number(sprite.y) || 0,
        rotate: Number(sprite.rotate) || 0,
      })),
    })),
  };
}

async function save() {
  state.error = "";
  state.message = "正在保存…";
  renderDock(currentJob());
  try {
    const saved = await api("/api/site", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    state.jobs = saved.jobs;
    state.dirty = false;
    state.message = "已保存。";
  } catch (error) {
    state.error = error.message;
    state.message = "";
  }
  paint();
}

async function logout() {
  await api("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  state.admin = false;
  state.dirty = false;
  paint();
}

function paint() {
  const scroll = window.scrollY;
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
  renderDock(job);
  window.scrollTo(0, scroll);
}

window.addEventListener("hashchange", () => paint());
window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

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
