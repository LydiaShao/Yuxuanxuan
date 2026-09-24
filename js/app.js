"use strict";

const SPANS = [7, 5, 5, 7, 12];
const RATIOS = ["portrait", "landscape", "portrait", "square", "wide"];

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function getStories() {
  const source = Array.isArray(window.STORIES) ? window.STORIES : [];
  const seen = new Set();
  return source.map((story, index) => {
    const title = text(story.title) || "未命名";
    let id = text(story.id) || `story-${index + 1}`;
    if (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    const paragraphs = Array.isArray(story.paragraphs)
      ? story.paragraphs.map(text).filter(Boolean)
      : text(story.paragraphs)
        ? [text(story.paragraphs)]
        : [];
    return {
      id,
      title,
      category: text(story.category) || "札记",
      date: text(story.date),
      location: text(story.location),
      image: text(story.image),
      alt: text(story.alt) || title,
      ratio: text(story.ratio),
      excerpt: text(story.excerpt) || paragraphs[0] || "",
      paragraphs,
    };
  });
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function parseRoute() {
  const raw = (location.hash || "#/").replace(/^#/, "");
  const [pathPart, queryPart] = raw.split("?");
  const params = new URLSearchParams(queryPart || "");
  const parts = pathPart.split("/").filter(Boolean);
  const route = {
    name: "home",
    id: "",
    tag: params.get("tag") || "全部",
    q: params.get("q") || "",
  };
  if (parts[0] === "about") route.name = "about";
  else if (parts[0] === "story" && parts[1]) {
    route.name = "story";
    route.id = decodeURIComponent(parts[1]);
  }
  return route;
}

function buildHomeHash(tag, q) {
  const params = new URLSearchParams();
  if (tag && tag !== "全部") params.set("tag", tag);
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `#/?${qs}` : "#/";
}

function buildStoryHash(id, tag, q) {
  const params = new URLSearchParams();
  if (tag && tag !== "全部") params.set("tag", tag);
  if (q) params.set("q", q);
  const qs = params.toString();
  return `#/story/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`;
}

function filterStories(stories, route, skipFeatured) {
  const query = route.q.trim().toLowerCase();
  return stories.filter((story, index) => {
    if (skipFeatured && index === 0) return false;
    if (route.tag !== "全部" && story.category !== route.tag) return false;
    if (!query) return true;
    const haystack = [story.title, story.excerpt, story.category, story.location, story.date, ...story.paragraphs]
      .join("\n")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function figure(story, className, eager) {
  const fig = h("figure", { class: className || "" });
  if (!story.image) {
    fig.classList.add("is-missing");
    fig.append(h("span", {}, "还没有图片"));
    return fig;
  }
  const img = h("img", {
    src: story.image,
    alt: story.alt,
    loading: eager ? "eager" : "lazy",
  });
  img.addEventListener("error", () => {
    img.remove();
    fig.classList.add("is-missing");
    fig.append(h("span", {}, "图片还没放进来"));
  });
  fig.append(img);
  return fig;
}

function metaLine(story) {
  const bits = [story.location, story.date].filter(Boolean);
  if (!bits.length) return null;
  return h("p", { class: "meta" }, bits.join(" · "));
}

function hero(story) {
  const route = parseRoute();
  return h(
    "section",
    { class: "hero" },
    figure(story, "hero-media", true),
    h(
      "div",
      { class: "hero-copy" },
      h("p", { class: "kicker" }, [story.category, story.location].filter(Boolean).join(" · ")),
      h("h1", {}, story.title),
      story.excerpt ? h("p", { class: "excerpt" }, story.excerpt) : null,
      metaLine(story),
      h("a", { class: "text-link", href: buildStoryHash(story.id, route.tag, route.q) }, "阅读这篇")
    )
  );
}

function card(story, index, route) {
  const ratio = story.ratio || RATIOS[index % RATIOS.length];
  const span = SPANS[index % SPANS.length];
  return h(
    "article",
    { class: "card", "data-span": String(span), "data-ratio": ratio },
    h(
      "a",
      { href: buildStoryHash(story.id, route.tag, route.q) },
      figure(story),
      h(
        "div",
        { class: "card-body" },
        h("p", { class: "kicker" }, h("span", { class: "index" }, String(index + 1).padStart(2, "0")), ` ${story.category}`),
        h("h3", {}, story.title),
        story.excerpt ? h("p", { class: "excerpt" }, story.excerpt) : null,
        metaLine(story)
      )
    )
  );
}

function grid(list, route) {
  const all = getStories();
  return h(
    "div",
    { class: "grid" },
    list.map((story) => card(story, Math.max(all.findIndex((item) => item.id === story.id), 0), route))
  );
}

function filters(route, stories) {
  const tags = ["全部", ...new Set(stories.map((story) => story.category))];
  return h(
    "nav",
    { class: "filters", "aria-label": "分类" },
    tags.map((tag) =>
      h(
        "a",
        {
          href: buildHomeHash(tag, route.q),
          class: tag === route.tag ? "is-active" : "",
          "aria-current": tag === route.tag ? "page" : null,
        },
        tag
      )
    )
  );
}

function emptyResults() {
  return h(
    "div",
    { class: "empty-results" },
    h("h3", {}, "没有找到相关札记"),
    h("p", { class: "quiet" }, "换一个词，或者回到全部分类。"),
    h("a", { class: "text-link", href: "#/" }, "回到全部")
  );
}

function gallerySection(route, stories, showHero) {
  const list = filterStories(stories, route, showHero);
  return h(
    "section",
    { class: "gallery", "aria-labelledby": "gallery-title" },
    h(
      "div",
      { class: "gallery-head" },
      h(
        "div",
        {},
        h("h2", { id: "gallery-title" }, showHero || route.tag === "全部" ? "札记" : route.tag),
        h("p", { id: "count", class: "count", "aria-live": "polite" }, `共 ${list.length} 篇`)
      ),
      h("input", {
        id: "search",
        class: "search",
        type: "search",
        placeholder: "搜索标题或正文",
        value: route.q,
        "aria-label": "搜索札记",
      })
    ),
    filters(route, stories),
    h("div", { id: "results" }, list.length ? grid(list, route) : emptyResults())
  );
}

function homeView(route) {
  const stories = getStories();
  if (!stories.length) {
    return h(
      "section",
      { class: "empty-home" },
      h("p", { class: "eyebrow" }, "Yuxuanxuan"),
      h("h1", {}, "予萱"),
      h("p", { class: "lede" }, "图文札记。一张图片，一段文字。"),
      h("p", { class: "quiet" }, "册子还是空的。"),
      h("p", { class: "hint" }, "把图片放到 images 目录，再在 content/stories.js 里写上对应的标题和文字。")
    );
  }
  const showHero = route.tag === "全部" && !route.q.trim();
  return h("div", {}, showHero ? hero(stories[0]) : null, gallerySection(route, stories, showHero));
}

function pagerLink(label, story, route) {
  return h(
    "a",
    { href: buildStoryHash(story.id, route.tag, route.q) },
    h("span", { class: "pager-label" }, label),
    h("strong", {}, story.title)
  );
}

function storyView(route) {
  const stories = getStories();
  const story = stories.find((item) => item.id === route.id);
  if (!story) {
    return h(
      "section",
      { class: "not-found" },
      h("p", { class: "kicker" }, "未找到"),
      h("h1", {}, "这篇札记不在架上"),
      h("p", {}, "它可能还没写进 content/stories.js，或者链接写错了。"),
      h("a", { class: "text-link", href: buildHomeHash(route.tag, route.q) }, "返回札记")
    );
  }
  const index = stories.indexOf(story);
  const prev = stories[index - 1];
  const next = stories[index + 1];
  const paragraphs = story.paragraphs.length ? story.paragraphs : story.excerpt ? [story.excerpt] : [];
  return h(
    "article",
    { class: "story" },
    h("a", { class: "back", href: buildHomeHash(route.tag, route.q) }, "返回札记"),
    h("p", { class: "kicker" }, [story.category, story.location].filter(Boolean).join(" · ")),
    h("h1", {}, story.title),
    metaLine(story),
    figure(story, "story-figure", true),
    h(
      "div",
      { class: "essay" },
      paragraphs.map((paragraph) => h("p", {}, paragraph))
    ),
    h(
      "nav",
      { class: "pager", "aria-label": "相邻札记" },
      prev ? pagerLink("上一篇", prev, route) : h("span", {}),
      next ? pagerLink("下一篇", next, route) : h("span", {})
    )
  );
}

function aboutView() {
  const stories = getStories();
  return h(
    "article",
    { class: "about" },
    h("p", { class: "kicker" }, "关于"),
    h("h1", {}, "予萱"),
    h("p", {}, "这是一个图文小站。每一则札记放一张图片，旁边写一段文字，用来慢慢翻。"),
    h("p", {}, "可以从分类里挑，也可以按标题和正文搜索。点开一则，画面和文字会留在同一页。"),
    stories.length
      ? h(
          "ul",
          { class: "index-list" },
          stories.map((story) =>
            h(
              "li",
              {},
              h("a", { href: buildStoryHash(story.id, "全部", "") }, story.title),
              h("span", {}, [story.category, story.date].filter(Boolean).join(" · "))
            )
          )
        )
      : h("p", { class: "quiet" }, "目前还没有放上札记。")
  );
}

function viewFor(route) {
  if (route.name === "about") return aboutView();
  if (route.name === "story") return storyView(route);
  return homeView(route);
}

function syncChrome(route) {
  const story = route.name === "story" ? getStories().find((item) => item.id === route.id) : null;
  document.title = route.name === "about" ? "关于 · 予萱" : story ? `${story.title} · 予萱` : route.name === "story" ? "未找到 · 予萱" : "予萱";
  const active = route.name === "about" ? "about" : "home";
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

let lastViewKey = "";

function render(options = {}) {
  const route = parseRoute();
  const viewKey = `${route.name}:${route.id}`;
  const main = document.getElementById("content");
  main.dataset.view = route.name;
  main.replaceChildren(viewFor(route));
  syncChrome(route);
  bindSearch();
  if (options.focusSearch) {
    const input = document.getElementById("search");
    if (input) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  } else if (!options.keepScroll && viewKey !== lastViewKey) {
    window.scrollTo(0, 0);
  }
  lastViewKey = viewKey;
}

function refreshResults() {
  const route = parseRoute();
  const stories = getStories();
  const showHero = route.tag === "全部" && !route.q.trim();
  const list = filterStories(stories, route, showHero);
  const results = document.getElementById("results");
  const count = document.getElementById("count");
  if (!results || !count) {
    render({ keepScroll: true, focusSearch: true });
    return;
  }
  count.textContent = `共 ${list.length} 篇`;
  results.replaceChildren(list.length ? grid(list, route) : emptyResults());
  document.title = "予萱";
}

function applySearch(value) {
  const route = parseRoute();
  const query = value.trim();
  const next = buildHomeHash(route.tag, query);
  const current = location.hash || "#/";
  const heroVisibilityChanged = (route.tag === "全部" && !route.q.trim()) !== (route.tag === "全部" && !query);
  if (current !== next) {
    const push = !route.q.trim() && Boolean(query);
    if (push) history.pushState(null, "", next);
    else history.replaceState(null, "", next);
  }
  if (heroVisibilityChanged) render({ keepScroll: true, focusSearch: true });
  else refreshResults();
}

function bindSearch() {
  const input = document.getElementById("search");
  if (!input) return;
  let composing = false;
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    applySearch(input.value);
  });
  input.addEventListener("input", () => {
    if (!composing) applySearch(input.value);
  });
}

document.querySelector(".site-nav").classList.toggle("is-scrolled", window.scrollY > 4);
window.addEventListener("scroll", () => {
  document.querySelector(".site-nav").classList.toggle("is-scrolled", window.scrollY > 4);
}, { passive: true });

window.addEventListener("hashchange", () => render());
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || parseRoute().name !== "story") return;
  const route = parseRoute();
  location.hash = buildHomeHash(route.tag, route.q);
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => render());
else render();
