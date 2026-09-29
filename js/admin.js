"use strict";

const state = { mode: "loading", message: "", error: "" };

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
  if (state.mode === "ready") {
    root.replaceChildren(
      h(
        "section",
        { class: "gate" },
        h("p", { class: "kicker" }, "Admin"),
        h("h1", {}, "已经登录"),
        h("p", { class: "hint" }, "回到网页上直接改。游客只能浏览，也可以拖动和旋转小人。"),
        h("div", { class: "toolbar" }, h("a", { class: "text-link", href: "/" }, "回到网页"), h("button", { type: "button", onclick: logout }, "退出")),
        messageNode()
      )
    );
    return;
  }
  const setup = state.mode === "setup";
  const password = h("input", {
    type: "password",
    id: "password",
    autocomplete: setup ? "new-password" : "current-password",
    required: "true",
  });
  root.replaceChildren(
    h(
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
      h("p", { class: "hint" }, setup ? "第一次打开时设置。密码至少 8 位。登录后在网页上编辑。" : "登录后在网页上编辑图片和文字。"),
      h("label", { for: "password" }, "密码"),
      password,
      h("div", { class: "toolbar" }, h("button", { class: "primary", type: "submit" }, setup ? "设置并进入" : "登录")),
      messageNode()
    )
  );
}

function messageNode() {
  return h("p", { class: state.error ? "status is-error" : "status", role: "status" }, state.error || state.message);
}

async function submit(path, password) {
  state.error = "";
  state.message = "";
  try {
    await api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    location.href = "/";
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

async function boot() {
  paint();
  try {
    const session = await api("/api/session", { method: "GET" });
    if (session.needsSetup) state.mode = "setup";
    else if (session.authenticated) state.mode = "ready";
    else state.mode = "login";
  } catch (error) {
    state.mode = "login";
    state.error = error.message;
  }
  paint();
}

boot();
