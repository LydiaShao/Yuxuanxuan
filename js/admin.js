"use strict";

const THEME_FIELDS = [
  ["background", "背景"],
  ["surface", "面板"],
  ["text", "文字"],
  ["muted", "次要文字"],
  ["accent", "点缀"],
  ["frame", "画框"],
];

const state = {
  mode: "loading",
  theme: {},
  jobs: [],
  message: "",
  error: "",
  dirty: false,
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

function applyTheme(theme) {
  for (const [key] of THEME_FIELDS) {
    if (theme[key]) document.documentElement.style.setProperty(`--${key}`, theme[key]);
  }
}

async function api(path, options = {}) {
  const headers = { "X-Admin": "1", ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function slugify(name, jobs) {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "job";
  let id = base;
  let n = 2;
  const taken = new Set(jobs.map((job) => job.id));
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id.slice(0, 40);
}

function paint() {
  applyTheme(state.theme);
  const root = document.getElementById("admin");
  if (state.mode === "loading") {
    root.replaceChildren(h("p", { class: "hint" }, "正在打开后台…"));
    return;
  }
  if (state.mode === "setup") root.replaceChildren(gate("设置管理员密码", "第一次打开后台时设置。密码至少 8 位，之后用它登录。", "设置并进入", submitSetup));
  else if (state.mode === "login") root.replaceChildren(gate("登录", "输入管理员密码。", "登录", submitLogin));
  else root.replaceChildren(editor());
}

function gate(title, copy, buttonLabel, onSubmit) {
  const password = h("input", { type: "password", id: "password", autocomplete: state.mode === "setup" ? "new-password" : "current-password", required: "true" });
  const form = h(
    "form",
    {
      class: "gate",
      onsubmit: (event) => {
        event.preventDefault();
        onSubmit(password.value);
      },
    },
    h("p", { class: "kicker" }, "Admin"),
    h("h1", {}, title),
    h("p", { class: "hint" }, copy),
    h("label", { for: "password" }, "密码"),
    password,
    h("div", { class: "toolbar" }, h("button", { class: "primary", type: "submit" }, buttonLabel)),
    messageNode()
  );
  return form;
}

function messageNode() {
  return h("p", { class: state.error ? "status is-error" : "status", role: "status" }, state.error || state.message);
}

function editor() {
  return h(
    "div",
    { class: "editor" },
    h("section", { class: "panel" }, h("h2", {}, "主题色"), h("div", { class: "colors" }, THEME_FIELDS.map(colorField)), h("p", { class: "hint" }, "改色会立刻反映在这个页面上。点保存后，前台才会一起换。")),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "职业"),
      h("p", { class: "hint" }, "顶栏按这里的顺序显示英文职业名。每一页一张横版插图，一枚方邮票头像。"),
      ...state.jobs.map((job, index) => jobCard(job, index)),
      h("button", { type: "button", onclick: addJob }, "添加职业")
    ),
    h("div", { class: "toolbar" }, h("button", { class: "primary", type: "button", onclick: save }, "保存"), h("button", { type: "button", onclick: logout }, "退出"), messageNode())
  );
}

function colorField([key, label]) {
  const color = h("input", {
    type: "color",
    value: normalizeHex(state.theme[key]),
    "aria-label": label,
    oninput: (event) => {
      state.theme[key] = event.target.value;
      state.dirty = true;
      applyTheme(state.theme);
      const text = event.target.parentElement.querySelector('input[type="text"]');
      if (text) text.value = event.target.value;
    },
  });
  const text = h("input", {
    type: "text",
    value: state.theme[key] || "",
    spellcheck: "false",
    oninput: (event) => {
      const value = event.target.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        state.theme[key] = value.toLowerCase();
        state.dirty = true;
        applyTheme(state.theme);
        color.value = state.theme[key];
      }
    },
  });
  return h("div", { class: "color-field" }, h("label", {}, label), color, text);
}

function normalizeHex(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#000000";
}

function jobCard(job, index) {
  return h(
    "article",
    { class: "job-card" },
    h("h3", {}, job.name || "未命名职业"),
    h("p", { class: "hint" }, `#/job/${job.id}`),
    field("导航名称（英文）", job.name, (value) => {
      job.name = value;
    }),
    field("一句短文", job.tagline, (value) => {
      job.tagline = value;
    }),
    h("label", {}, "正文"),
    h("textarea", {
      value: (job.paragraphs || []).join("\n\n"),
      oninput: (event) => {
        job.paragraphs = event.target.value.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
        state.dirty = true;
      },
    }),
    h("p", { class: "hint" }, "空行会分成新的一段。"),
    h(
      "div",
      { class: "uploads" },
      uploadSlot(job, "banner", "横版插图", "banner"),
      uploadSlot(job, "portrait", "方邮票头像", "stamp")
    ),
    h(
      "div",
      { class: "row-actions" },
      h("button", { type: "button", onclick: () => moveJob(index, -1), disabled: index === 0 }, "上移"),
      h("button", { type: "button", onclick: () => moveJob(index, 1), disabled: index === state.jobs.length - 1 }, "下移"),
      h("button", { class: "danger", type: "button", onclick: () => removeJob(index) }, "删除")
    )
  );
}

function field(label, value, onInput) {
  const input = h("input", {
    type: "text",
    value: value || "",
    oninput: (event) => {
      onInput(event.target.value);
      state.dirty = true;
    },
  });
  return h("div", {}, h("label", {}, label), input);
}

function uploadSlot(job, key, label, frameClass) {
  const input = h("input", {
    type: "file",
    accept: "image/jpeg,image/png,image/webp,image/gif",
    onchange: (event) => upload(job, key, event.target.files[0], event.target),
  });
  const preview = job[key]
    ? h("img", { src: job[key], alt: "" })
    : h("span", {}, key === "banner" ? "Landscape" : "Stamp");
  const frame = h("figure", { class: `${frameClass}${job[key] ? "" : " is-empty"}` }, preview);
  return h("div", {}, h("label", {}, label), frame, input);
}

async function upload(job, key, file, input) {
  if (!file) return;
  state.error = "";
  state.message = "正在上传…";
  paint();
  try {
    const body = new FormData();
    body.append("file", file);
    const data = await api("/api/upload", { method: "POST", body });
    job[key] = data.path;
    state.dirty = true;
    state.message = "图片已上传，记得保存。";
  } catch (error) {
    state.error = error.message;
  }
  input.value = "";
  paint();
}

function addJob() {
  state.jobs.push({
    id: slugify("New Job", state.jobs),
    name: "New Job",
    tagline: "",
    paragraphs: [],
    banner: "",
    portrait: "",
  });
  state.dirty = true;
  state.message = "";
  paint();
}

function moveJob(index, step) {
  const next = index + step;
  if (next < 0 || next >= state.jobs.length) return;
  const [job] = state.jobs.splice(index, 1);
  state.jobs.splice(next, 0, job);
  state.dirty = true;
  paint();
}

function removeJob(index) {
  const job = state.jobs[index];
  if (!window.confirm(`删除 ${job.name || "这个职业"}？`)) return;
  state.jobs.splice(index, 1);
  state.dirty = true;
  paint();
}

function payload() {
  return {
    theme: state.theme,
    jobs: state.jobs.map((job) => ({
      id: job.id,
      name: job.name.trim(),
      tagline: job.tagline.trim(),
      paragraphs: job.paragraphs,
      banner: job.banner,
      portrait: job.portrait,
    })),
  };
}

async function save() {
  state.error = "";
  state.message = "正在保存…";
  paint();
  try {
    const saved = await api("/api/site", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    state.theme = saved.theme;
    state.jobs = saved.jobs;
    state.dirty = false;
    state.message = "已保存。";
  } catch (error) {
    state.error = error.message;
    state.message = "";
  }
  paint();
}

async function submitSetup(password) {
  await submitAuth("/api/setup", password);
}

async function submitLogin(password) {
  await submitAuth("/api/login", password);
}

async function submitAuth(path, password) {
  state.error = "";
  state.message = "";
  try {
    await api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    await openEditor();
  } catch (error) {
    state.error = error.message;
    paint();
  }
}

async function logout() {
  await api("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  state.mode = "login";
  state.message = "已退出。";
  paint();
}

async function openEditor() {
  const site = await fetch("/api/site", { cache: "no-store" }).then((response) => response.json());
  state.theme = site.theme;
  state.jobs = site.jobs;
  state.mode = "editor";
  state.dirty = false;
  state.message = "";
  state.error = "";
  paint();
}

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

async function boot() {
  paint();
  try {
    const session = await api("/api/session", { method: "GET" });
    if (session.needsSetup) state.mode = "setup";
    else if (!session.authenticated) state.mode = "login";
    else {
      await openEditor();
      return;
    }
  } catch (error) {
    state.mode = "login";
    state.error = error.message;
  }
  const site = await fetch("/api/site", { cache: "no-store" }).then((response) => response.json()).catch(() => null);
  if (site && site.theme) state.theme = { ...state.theme, ...site.theme };
  paint();
}

boot();
