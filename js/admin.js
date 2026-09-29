"use strict";

const state = {
  mode: "loading",
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

function paint() {
  const root = document.getElementById("admin");
  if (state.mode === "loading") {
    root.replaceChildren(h("p", { class: "hint" }, "正在打开后台…"));
    return;
  }
  if (state.mode !== "editor") {
    root.replaceChildren(gate());
    return;
  }
  root.replaceChildren(editor());
}

function messageNode() {
  return h("p", { class: state.error ? "status is-error" : "status", role: "status" }, state.error || state.message);
}

function gate() {
  const setup = state.mode === "setup";
  const password = h("input", {
    type: "password",
    id: "password",
    autocomplete: setup ? "new-password" : "current-password",
    required: "true",
  });
  return h(
    "form",
    {
      class: "gate",
      onsubmit: (event) => {
        event.preventDefault();
        submit(setup ? "/api/setup" : "/api/login", password.value);
      },
    },
    h("p", { class: "kicker" }, "Admin"),
    h("h1", {}, setup ? "设置管理员密码" : "登录"),
    h("p", { class: "hint" }, setup ? "第一次打开时设置。密码至少 8 位。" : "配色、文字和上传都在这里。网页上右键图片可以看原图，登录后也可以替换。"),
    h("label", { for: "password" }, "密码"),
    password,
    h("div", { class: "toolbar" }, h("button", { class: "primary", type: "submit" }, setup ? "设置并进入" : "登录")),
    messageNode()
  );
}

function editor() {
  return h(
    "div",
    { class: "editor" },
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "职业"),
      h("p", { class: "hint" }, "配色和文字在这里改，网页本身不加编辑条。页面背景就是横图渐变落到的颜色。顶栏用另一色。"),
      h("p", { class: "hint" }, "头图按屏幕清晰度显示，画廊会略糊一些。右键打开原图；登录后可以替换，画廊还能移除。空白处右键可以加文字。"),
      ...state.jobs.map((job, index) => jobCard(job, index)),
      h("button", { type: "button", onclick: addJob }, "添加职业")
    ),
    h("div", { class: "toolbar" }, h("button", { class: "primary", type: "button", onclick: save }, "保存"), h("a", { class: "text-link", href: "/" }, "看网页"), h("button", { type: "button", onclick: logout }, "退出"), messageNode())
  );
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

function colorGrid(fields, bag) {
  return h(
    "div",
    { class: "color-grid" },
    ...fields.map(([key, label]) =>
      colorField(label, bag[key], (next) => {
        bag[key] = next;
        state.dirty = true;
      })
    )
  );
}

function field(label, value, onInput) {
  return h(
    "div",
    {},
    h("label", {}, label),
    h("input", {
      type: "text",
      value: value || "",
      oninput: (event) => {
        onInput(event.target.value);
        state.dirty = true;
      },
    })
  );
}

function jobCard(job, index) {
  job.colors = YxPalette.jobColors(job);
  if (!Array.isArray(job.blocks)) job.blocks = [];
  if (!Array.isArray(job.images)) job.images = [];
  if (!Array.isArray(job.sprites)) job.sprites = [];
  return h(
    "article",
    { class: "job-card" },
    h("h3", {}, job.name || "未命名职业"),
    h("p", { class: "hint" }, `#/job/${job.id}`),
    field("导航名称（英文）", job.name, (value) => {
      job.name = value;
      const taken = state.jobs.filter((item) => item !== job).map((item) => item.id);
      job.id = YxPalette.slug(value, taken);
    }),
    field("一句短文", job.tagline, (value) => {
      job.tagline = value;
    }),
    h(
      "div",
      { class: "row-actions" },
      h("button", { type: "button", onclick: () => setAlign(job, "left") }, job.align === "right" ? "改为靠左" : "靠左"),
      h("button", { type: "button", onclick: () => setAlign(job, "right") }, job.align === "right" ? "靠右" : "改为靠右")
    ),
    h("p", { class: "hint" }, job.align === "right" ? "这一页靠右：邮票在右，名字在左。" : "这一页靠左：邮票在左，名字在右。"),
    colorGrid(
      [
        ["background", "页面背景"],
        ["bar", "顶栏底色"],
        ["barText", "顶栏文字"],
        ["muted", "次要文字"],
      ],
      job.colors
    ),
    h(
      "div",
      { class: "uploads" },
      uploadSlot(job, "banner", "横版插图", "banner"),
      uploadSlot(job, "sash", "竖插绶带", "sash"),
      uploadSlot(job, "portrait", "方邮票头像", "stamp"),
      bgmSlot(job)
    ),
    h("p", { class: "hint" }, "横图可空。竖插会像绶带钉在邮票那一侧，滚动时不走。正文和图片在职业页面上改。管理员打开那一页后可以直接写；右键加字、加图片、换图或去掉。图片可以拖动，角落可以放大缩小。"),
    spriteList(job),
    h(
      "div",
      { class: "row-actions" },
      h("button", { type: "button", onclick: () => moveJob(index, -1), disabled: index === 0 }, "上移"),
      h("button", { type: "button", onclick: () => moveJob(index, 1), disabled: index === state.jobs.length - 1 }, "下移"),
      h("button", { class: "danger", type: "button", onclick: () => removeJob(index) }, "删除")
    )
  );
}

function setAlign(job, side) {
  job.align = side;
  state.dirty = true;
  paint();
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

function uploadSlot(job, key, label, frameClass) {
  const input = h("input", {
    type: "file",
    accept: "image/jpeg,image/png,image/webp,image/gif",
    onchange: (event) => upload(job, key, event.target.files[0], event.target),
  });
  const preview = job[key] ? h("img", { src: job[key], alt: "" }) : h("span", {}, "未上传");
  return h("div", {}, h("label", {}, label), h("figure", { class: `${frameClass}${job[key] ? "" : " is-empty"}` }, preview), input);
}

function bgmSlot(job) {
  const input = h("input", {
    type: "file",
    accept: "audio/mpeg,audio/ogg,audio/wav,audio/flac,audio/mp4,audio/x-m4a,.mp3,.ogg,.wav,.flac,.m4a",
    onchange: (event) => upload(job, "bgm", event.target.files[0], event.target),
  });
  const preview = job.bgm
    ? h(
        "div",
        { class: "bgm-preview" },
        h("audio", { src: job.bgm, controls: "true" }),
        h("button", { type: "button", onclick: () => { job.bgm = ""; state.dirty = true; paint(); } }, "去掉")
      )
    : h("span", {}, "未上传");
  return h(
    "div",
    {},
    h("label", {}, "BGM"),
    h("p", { class: "hint" }, "每个职业一首。MP3 / OGG / WAV / FLAC / M4A，24MB 以内。自动播放，点邮票头像停止；再点继续。切职业会渐入渐出。"),
    preview,
    input
  );
}

function spriteList(job) {
  const input = h("input", {
    type: "file",
    accept: "image/jpeg,image/png,image/webp,image/gif",
    multiple: "true",
    onchange: (event) => uploadMany(job, "sprites", event.target.files, event.target),
  });
  return h(
    "div",
    {},
    h("label", {}, "小人"),
    h("p", { class: "hint" }, "上传后出现在网页上，不跟滚动。位置在网页上拖，右键转 90°。大小在这里调。悬停会跳一下；GIF 平时停住，悬停才动。可以一次选多张。"),
    h(
      "div",
      { class: "extra-list" },
      ...job.sprites.map((sprite, index) => {
        const size = Number.isFinite(Number(sprite.size)) && Number(sprite.size) > 0 ? Number(sprite.size) : 50;
        const label = h("label", {}, `大小 ${Math.round(size)}%`);
        return h(
          "div",
          { class: "extra-item" },
          h("figure", {}, h("img", { src: sprite.src, alt: "" })),
          label,
          h("input", {
            type: "range",
            min: "20",
            max: "100",
            step: "5",
            value: String(Math.round(size)),
            oninput: (event) => {
              sprite.size = Number(event.target.value);
              label.textContent = `大小 ${Math.round(sprite.size)}%`;
              state.dirty = true;
            },
          }),
          h("button", { type: "button", onclick: () => removeSprite(job, index) }, "去掉")
        );
      })
    ),
    input
  );
}

async function upload(job, key, file, input) {
  if (!file) return;
  state.error = "";
  state.message = "正在上传…";
  paint();
  try {
    job[key] = await sendFile(file);
    state.dirty = true;
    state.message = key === "bgm" ? "音频已保存，记得点保存。" : "图片已按原文件保存，记得点保存。";
  } catch (error) {
    state.error = error.message;
  }
  input.value = "";
  paint();
}

async function uploadMany(job, key, fileList, input) {
  const files = [...fileList];
  if (!files.length) return;
  const limit = key === "sprites" ? 12 : 40;
  const room = limit - job[key].length;
  if (room <= 0) {
    state.error = key === "sprites" ? "小人已经到 12 个" : "这一页的图片已经到 40 张";
    input.value = "";
    paint();
    return;
  }
  const batch = files.slice(0, room);
  const skipped = files.length - batch.length;
  state.error = "";
  state.message = `正在上传 1/${batch.length}…`;
  paint();
  try {
    for (let index = 0; index < batch.length; index += 1) {
      state.message = `正在上传 ${index + 1}/${batch.length}…`;
      const path = await sendFile(batch[index]);
      if (key === "sprites") {
        const count = job.sprites.length;
        job.sprites.push({ src: path, x: 8 + (count % 6) * 8, y: 18 + Math.floor(count / 6) * 12, rotate: 0, size: 50 });
      } else {
        job.images.push(path);
      }
      state.dirty = true;
    }
    const noun = key === "sprites" ? "个小人" : "张图片";
    state.message = skipped
      ? `已上传 ${batch.length} ${noun}，剩下 ${skipped} 个超出上限，没有加入。记得点保存。`
      : `已上传 ${batch.length} ${noun}，记得点保存。`;
  } catch (error) {
    state.error = error.message;
    state.message = "";
  }
  input.value = "";
  paint();
}

async function sendFile(file) {
  const body = new FormData();
  body.append("file", file);
  const data = await api("/api/upload", { method: "POST", body });
  return data.path;
}

function removeSprite(job, index) {
  job.sprites.splice(index, 1);
  state.dirty = true;
  paint();
}

function slugify(name) {
  const taken = new Set(state.jobs.map((job) => job.id));
  return YxPalette.slug(name, taken);
}

function addJob() {
  state.jobs.push({
    id: slugify("New Job"),
    name: "New Job",
    align: "left",
    tagline: "",
    colors: YxPalette.jobColors({}),
    blocks: [],
    banner: "",
    sash: "",
    portrait: "",
    bgm: "",
    images: [],
    sprites: [],
  });
  state.dirty = true;
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
  YxPalette.stampIds(state.jobs);
  return {
    jobs: state.jobs.map((job) => {
      const body = dedupeBodyImages(job).map((item) => {
        if (item.type !== "image") {
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
        const image = { type: "image", src: item.src };
        const width = Number(item.w);
        image.w = Number.isFinite(width) && width > 0 ? Math.round(Math.min(100, Math.max(8, width)) * 100) / 100 : 46;
        image.x = Math.round(Math.min(100, Math.max(0, Number(item.x) || 0)) * 100) / 100;
        image.y = Math.round(Math.min(800, Math.max(0, Number(item.y) || 0)) * 100) / 100;
        image.rotate = Math.round(((((Number(item.rotate) || 0) % 360) + 360) % 360) * 10) / 10;
        image.flipX = !!item.flipX;
        image.flipY = !!item.flipY;
        [["round", 50], ["dissolve", 48], ["shadow", 40], ["ghost", 40]].forEach(([key, hi]) => {
          const amount = Number(item[key]);
          image[key] = Number.isFinite(amount) ? Math.round(Math.min(hi, Math.max(0, amount)) * 10) / 10 : 0;
        });
        image.ghostColor = cssHex(item.ghostColor, "#1a1018");
        image.shadowColor = cssHex(item.shadowColor, "#14100e");
        return image;
      });
      return {
        id: job.id,
        name: (job.name || "").trim(),
        align: job.align === "right" ? "right" : "left",
        tagline: (job.tagline || "").trim(),
        colors: YxPalette.jobColors(job),
        body,
        blocks: body.filter((item) => item.type === "text").map((item) => ({
          text: item.text,
          background: item.background,
          color: item.color,
        })),
        banner: job.banner || "",
        sash: job.sash || "",
        portrait: job.portrait || "",
        bgm: job.bgm || "",
        images: body.filter((item) => item.type === "image").map((item) => item.src),
        sprites: (job.sprites || []).map((sprite) => {
          const size = Number(sprite.size);
          const record = {
            src: sprite.src,
            x: Number(sprite.x) || 0,
            y: Number(sprite.y) || 0,
            rotate: Number(sprite.rotate) || 0,
          };
          if (Number.isFinite(size) && size > 0 && size !== 50) {
            record.size = Math.round(Math.min(100, Math.max(20, size)) * 10) / 10;
          }
          return record;
        }),
      };
    }),
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
    state.jobs = saved.jobs;
    state.dirty = false;
    state.message = "已保存。";
  } catch (error) {
    state.error = error.message;
    state.message = "";
  }
  paint();
}

async function submit(path, password) {
  state.error = "";
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
  state.jobs = [];
  state.message = "已退出。";
  paint();
}

async function openEditor() {
  const site = await fetch("/api/site", { cache: "no-store", credentials: "same-origin" }).then((response) => response.json());
  state.jobs = site.jobs || [];
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
  paint();
}

boot();
