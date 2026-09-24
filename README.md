# 予萱

图文展示小站。首页是札记列表，点开一则可以看到图片和对应的文字。可以按分类筛选，也可以搜索标题和正文。

## 放入图片和文字

1. 把图片放到 `images/` 目录，例如 `images/morning.jpg`。
2. 打开 `content/stories.js`，在 `window.STORIES` 数组里追加一则：

```js
{
  id: "morning",
  title: "窗边的第一束光",
  category: "居室",
  date: "2026.03.12",
  location: "杭州",
  image: "images/morning.jpg",
  alt: "窗台上的白杯子和一片叶子",
  ratio: "wide",
  excerpt: "一句会出现在首页的摘要。",
  paragraphs: ["第一段。", "第二段。"]
}
```

`id` 用英文或拼音，不要重复。`category` 会自动出现在首页分类里。`ratio` 可以不写；需要控制首页画幅时用 `wide`、`landscape`、`portrait` 或 `square`。

## 本地预览

```bash
python3 -m http.server 4173
```

浏览器打开 http://127.0.0.1:4173
