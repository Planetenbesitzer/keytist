# Keytist

[English](README.md) | 简体中文

[![GitHub Stars](https://img.shields.io/github/stars/Planetenbesitzer/keytist?style=flat&logo=github&label=Stars&color=007aff&labelColor=1d1d1f)](https://github.com/Planetenbesitzer/keytist/stargazers)

基于 [PPTist](https://github.com/pipipi-pikachu/PPTist) 的本地演示文稿编辑器，采用 Keynote 风格的界面与编辑体验，面向科研报告和网页展示。

用可编辑的文字、图片、形状和 LaTeX 制作 slides；需要动态解释时，直接插入完整的 HTML/CSS/JavaScript 网页。完成后，一键导出紧凑的 HTML 文件，用于报告、静态网站或博客。

## 特色

- **Keynote 风格编辑。** 协调配色、格式检查器、自定义样式、图片框与阴影、可收起的侧栏、组合缩放和常用快捷键。
- **理科友好的公式。** LaTeX 可作为独立矢量公式插入，也可放在一段文字中间。公式保留源码，双击即可继续修改；MathJax 在本机运行，不依赖 CDN。
- **网页也能成为幻灯片。** 导入完整 HTML，保留 CSS 和 JavaScript，让按钮、Canvas、动画与互动演示继续工作。网页整体可移动、等比缩放，上方仍可叠加原生文字、图片与公式。
- **一键 HTML 导出。** 蓝色“导出”按钮生成带翻页、全屏和打印的紧凑网页文件，可直接发布到静态网站，或嵌入博客。
- **AI 可以全程参与，与你共同制作。** 具备本地文件和浏览器访问能力的 AI Agent，可以从内容组织、幻灯片生成、公式与排版调整、互动演示制作，一直操作到导出。你可以随时检查并继续修改同一份文稿。
- **本地保存，Agent 可访问。** JSON 文稿保留公式源码和内嵌素材。Agent 可以读写 JSON、导入生成的 HTML，或通过浏览器接口修改文稿。
- **中英文界面。** 顶部可切换 English 与简体中文；选择保存在当前浏览器，不会翻译或改写文稿正文。

## 本地运行

需要 **Node.js 20 或以上版本**，推荐使用 Chrome 或 Edge。

从源码启动：

```sh
npm ci
npm run build
npm start
```

浏览器打开 **http://127.0.0.1:4178**，保持本地服务运行。首次安装依赖需要访问软件包仓库；依赖安装、应用构建完成后，编辑器在本机运行。开发时使用 `npm run dev`。

若下载的是带 `dist/` 的发布压缩包，请完整解压后使用对应入口；只运行已构建版本，无需安装项目依赖。

| 系统 | 启动入口 |
| --- | --- |
| macOS | `启动 Keytist.command` |
| Windows | `Start Keytist.bat` |
| Linux | `sh start-keytist.sh` |

macOS 可选运行 `安装到应用程序.command`，在 Applications 中安装 **Keytist.app**。这一步需要 Apple Command Line Tools，普通启动不需要。安装后仍需保留解压目录；移动项目后，请从新位置重新安装入口。Windows、Linux 提供对应脚本；发布包的启动核验在 macOS 上完成。

## 制作与安全保存

顶部工具可插入文本框、图片、形状、表格、图表和公式。双击文字或公式继续编辑；在文字中放好光标，再点“公式”，即可插入行内公式。顶部 HTML 按钮用于导入网页，或编辑当前网页幻灯片的源码。`examples/我的第一份演示.json` 和 `examples/HTML演示示例.html` 是通用示例。

**浏览器自动保存与文稿文件保存是两回事。** 点“保存”或按 **⌘S / Ctrl+S**，写入可编辑 JSON；全新安装默认保存在 `~/Documents/Code/keytist/output`。已有安装继续使用原保存位置，包括旧的 `~/Documents/Code/SlidesStudio/output`，改名不会搬动文稿。再次保存会更新已绑定文件；不相关的新文稿重名时自动加序号。“另存为”可选择其他位置。外部修改会触发冲突提示，避免静默覆盖。

macOS 全新安装将设置与日志放在 `~/Library/Application Support/Keytist` 和 `~/Library/Logs/Keytist`。升级已有安装会继承原设置、保存凭证和路径，因此旧目录名可能保留。浏览器存储和 Agent 接口标识也保持兼容，延续已有文稿与偏好。

换电脑、清除浏览器数据或更换浏览器地址前，请保存一份 JSON。自定义样式库、常用色、界面语言与侧栏偏好保存在当前浏览器；已经应用到对象上的外观仍随文稿保存。默认输出目录仅用于 JSON；HTML、PDF、PPTX 和图片使用浏览器的下载或打印流程。

本地保存服务只监听 `127.0.0.1`，校验请求来源，并使用运行时生成的保存凭证；文稿的本地保存流程不会上传文稿。导入的网页在独立沙盒 iframe 中运行，但网页 JavaScript 仍可请求外部资源，导入前应检查其代码。

可选的远程 AI 与图片搜索服务默认关闭。开发者可在构建时配置 `VITE_STUDIO_REMOTE_API` 地址启用；启用后，相关请求内容会发送到该服务。`VITE_*` 构建变量会进入浏览器代码，不能用来保存私密 API key 或密码。

## 导出 HTML，发布到博客

点蓝色 **导出** 按钮，生成紧凑的单文件 HTML。重复素材只存一份，展示数据无损压缩，不降低图片画质；文字、矢量公式和 SVG 路径保留渲染结构，嵌入网页的源码与 JavaScript 继续保留。原生图表的 Canvas 输出转为图片；嵌入网页中的 Canvas 仍由其自身脚本运行。

默认导出播放版。若希望以后恢复原生对象编辑，请勾选 **保留重新导入编辑能力**，文件会额外携带一份完整文稿，因此体积更大。JSON 仍是日常编辑备份；可编辑 HTML 可通过 **HTML → 打开 HTML 文件 → 作为文稿打开** 恢复。

将文件（例如 `talk.html`）上传到博客的静态资源目录，即可直接链接，或通过 iframe 嵌入：

```html
<iframe
  src="/slides/talk.html"
  title="我的演示文稿"
  style="width: 100%; aspect-ratio: 16 / 9; border: 0;"
  allow="fullscreen"
  allowfullscreen
  loading="lazy"
></iframe>
```

博客平台需要允许上传 HTML 和嵌入 iframe。导出文件自带播放器，观看设备无需安装 Keytist 或 Node.js，但需要支持文件内解压流程的现代浏览器。

**能否离线播放，取决于导入网页的资源。** 原生幻灯片素材与自动收集的字体会随文件保存；网页内引用的外部脚本、媒体和其他 URL，仍需要原来的网络或文件位置，除非网页已经将这些资源内嵌。完全离线的互动报告，应使用自包含 HTML/CSS/JS 和内嵌素材。

### 字体与文件体积

HTML 默认自动携带所需的 **英文/Latin、Greek 和数学字体**，包括实际使用的常规、粗体、斜体字面；不同幻灯片复用相同字体资源。缺少字体或嵌入权限受限时会明确提示，避免静默替换。请确认字体许可允许你的使用方式。

目前**不额外自动打包中文/CJK 字库**。中文内容保留，使用播放设备字体，因此字形与换行可能不同；原文稿或嵌入网页已自带的字体仍会保留。预计新增字体数据达到 **5 MiB** 时显示体积提醒，继续导出会保留这些字体。字体准备不会把系统字库写入原 JSON，也不修改原文稿。

携带英文字体可稳定字形和换行，不同浏览器的抗锯齿仍可能略有差异。纯静态部署没有本地字体目录时，请使用预置字体或自行导入字体。SVG 图片若含可变文字，需要先将文字转为轮廓、转成普通图片，或改用原生文本框；纯路径图形与 MathJax 公式不受影响。

## 其他导出格式

| 格式 | 用途与边界 |
| --- | --- |
| JSON | 可编辑源文稿，保留 LaTeX、图片与导入字体。 |
| HTML | 展示与网页发布，保留嵌入互动网页；可选携带原生编辑数据。 |
| PPTX | 静态版本。省略嵌入网页及其交互，保留原生文字、图片、形状、公式和原有页序；只有网页的页面保留背景、页码与空白区域。导出面板会提示省略内容。 |
| PDF / 图片 | 静态输出。PDF 可在独立预览中逐帧冻结多个交互状态，直接下载高清画面 PDF；纯原生文稿仍可使用打印。 |

PPTX 是交换格式，显示可能与编辑器存在差异。标准模式下，普通文字与图片仍为独立对象；含行内公式的文字层转为高清透明图片，以保留相对位置与换行，LaTeX 源码保留在 JSON 或可编辑 HTML 中。PPTX 不会执行嵌入网页的 JavaScript。

## Agent 与开发

把提纲、素材与展示目标交给 Agent，再围绕它生成的文稿共同迭代。Agent 可以编写 JSON 或完整 HTML/CSS/JS，通过浏览器接口检查和修改当前文稿、保存阶段版本，并操作导出界面；你也可以继续编辑同一份原生对象或网页源码。这套工作流使用你自己的 Agent 及其本地工具，无需内置云端 AI 服务。

协作流程见 [AGENTS.md](AGENTS.md)，文稿格式和实际支持的操作见 [本地 Agent API](doc/LOCAL_AGENT_API.md)。修改正在编辑的文稿应使用浏览器接口；直接改磁盘文件不会自动更新已打开的编辑器。发布前应保存并检查最终展示效果。

JSON 可由本地工具直接读写。`window.keynoteLocal` 提供文稿操作、元素更新、订阅与保存接口，见 [本地 Agent API](doc/LOCAL_AGENT_API.md)。导入网页保留为整页，不会自动拆成原生文本框和形状。

```sh
npm run type-check
node --test --test-concurrency=1 scripts/tests/*.test.mjs
npm run build
```

## 支持项目

如果 Keytist 对你制作科研报告或交互演示有帮助，欢迎在 [GitHub 上点一个 Star](https://github.com/Planetenbesitzer/keytist)，帮助更多人发现这个项目，也鼓励我们持续完善它。

### Star 增长曲线

<a href="https://www.star-history.com/?repos=Planetenbesitzer%2Fkeytist&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Planetenbesitzer/keytist&amp;type=date&amp;theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Planetenbesitzer/keytist&amp;type=date" />
    <img alt="Keytist Star 增长曲线" src="https://api.star-history.com/chart?repos=Planetenbesitzer/keytist&amp;type=date" width="800" />
  </picture>
</a>

徽章和曲线会自动更新；缓存可能导致显示的数量有所滞后。

## 许可与致谢

Keytist 基于 **[pipipi-pikachu](https://github.com/pipipi-pikachu)** 的 **[PPTist](https://github.com/pipipi-pikachu/PPTist)** 修改，保留 **GNU Affero General Public License v3.0**，完整内容见 [LICENSE](LICENSE)。[上游原 README](doc/README.upstream.md) 保留了原作者的公开联系方式与项目声明。

字体及依赖仍遵循各自许可，见 [第三方声明](doc/THIRD_PARTY_NOTICES.md) 和随附许可文件。公开发行不包含上游两份尚未确认转分发来源链的转换字体，也不包含系统字体或私人文稿。本项目独立于 Apple，并非 Apple Keynote 产品。
