# Keytist · Slide Studio

English | [简体中文](README_zh.md)

A local presentation editor built on [PPTist](https://github.com/pipipi-pikachu/PPTist), with a Keynote-inspired interface and a workflow for scientific talks and the web.

Create slides with editable text, images, shapes and LaTeX. Add a complete HTML/CSS/JavaScript page when a static figure is not enough, then export the presentation as a compact HTML file for a talk, a website or your blog. The application is called **Slide Studio**; this repository is **keytist**.

## What makes it useful

- **Keynote-inspired editing.** Coordinated colors, a familiar format inspector, customizable styles, image frames and shadows, collapsible sidebars, group resizing and keyboard shortcuts.
- **Equations belong in the argument.** Insert editable LaTeX as a standalone vector equation or directly between words in a text box. Reopen an equation to edit its source. MathJax runs locally, without a CDN.
- **Interactive explanations.** Import a complete HTML page, including its CSS and JavaScript. Keep buttons, Canvas, animations and demonstrations working during playback. Move or scale the webpage as one object and place native slide elements over it.
- **One-click HTML export.** The blue **Export** button produces a compact presentation file with navigation, fullscreen and printing. Upload that file to a static website or embed it in a blog.
- **AI can work with you throughout.** A local AI agent with file and browser access can develop the narrative, build slides, revise equations and layouts, create interactive demonstrations, and operate the editor through export. You can inspect and adjust the same presentation at each step.
- **Local files and agent access.** Save an editable JSON document with equation sources and embedded assets. Agents can read or update the JSON, import generated HTML, or use the documented browser API.
- **English and 简体中文.** Switch the interface language from the top bar. Your choice stays in this browser; it does not translate or rewrite slide content.

## Run locally

Requires **Node.js 20 or newer**. Chrome or Edge is recommended.

From a source checkout:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4178** and keep the server running. Dependency installation needs access to the package registry; after installation and building, the editor runs locally. For development, use `npm run dev`.

If you downloaded a release ZIP containing `dist/`, extract the complete archive and use the appropriate launcher. You do not need to install project dependencies just to run that built release.

| Platform | Launcher |
| --- | --- |
| macOS | `启动 Slide Studio.command` |
| Windows | `Start Slide Studio.bat` |
| Linux | `sh start-slides-studio.sh` |

On macOS, `安装到应用程序.command` optionally installs a Slide Studio launcher in Applications. That installation needs Apple Command Line Tools; normal startup does not. Keep the extracted project folder, and reinstall the launcher if you move it. Windows and Linux launchers are provided; release verification has been performed on macOS.

## Make and save a presentation

Use the toolbar to insert text, images, shapes, tables, charts or equations. Double-click text or an equation to edit it. To insert an inline equation, place the caret inside text and choose **Equation**. Use the HTML button to import a page or edit the source of the current webpage slide. The included `examples/我的第一份演示.json` and `examples/HTML演示示例.html` are generic examples.

Browser autosave and a saved document file are separate. **Save** or **⌘S / Ctrl+S** writes an editable JSON document; new documents default to `~/Documents/Code/SlidesStudio/output`. A bound file is updated on subsequent saves, while an unrelated new document with the same name gets a numbered filename. **Save As** lets you choose another location. External changes are reported as conflicts instead of being silently overwritten.

Save a JSON copy before changing computers, clearing browser storage or moving to another browser address. Custom styles, favorite colors, interface language and sidebar preferences belong to the current browser; their applied appearance remains part of the saved slides. The default output folder is for JSON documents; HTML, PDF, PPTX and image exports use the browser's download or print flow.

The local save service listens on `127.0.0.1`, checks request origin and uses a runtime save credential. Local document saving does not upload the document to a remote service. Imported HTML runs in a separate sandboxed iframe, but its JavaScript can still request external resources: review code before importing it.

Optional remote AI and image-search tools are disabled by default. Developers can opt in with a build-time `VITE_STUDIO_REMOTE_API` endpoint; enabling it sends the requested content to that configured service. Build-time `VITE_*` values are visible in the browser bundle, so do not put a private API key or password in them.

## Publish HTML, including on a blog

Click **Export** for a compact, single-file HTML presentation. Repeated assets are stored once and the presentation payload is compressed without reducing image quality. Text, vector equations and SVG paths keep their rendered structure; embedded webpage source and JavaScript are retained. A native chart's Canvas rendering is exported as an image; Canvas inside an embedded webpage continues to run its own script.

The default HTML is a playback file. Enable **Keep document for reimport and editing** when you also want to restore the original native objects later. This includes an additional document copy and therefore increases file size. JSON remains the regular editing backup. To reopen an editable HTML export, use **HTML → Open HTML file → Open as document**.

Upload the exported file, for example `talk.html`, to the static files directory of your blog and link to it or embed it:

```html
<iframe
  src="/slides/talk.html"
  title="My presentation"
  style="width: 100%; aspect-ratio: 16 / 9; border: 0;"
  allow="fullscreen"
  allowfullscreen
  loading="lazy"
></iframe>
```

The host must permit HTML uploads and iframe embeds. The exported file includes its viewer; the Slide Studio editor and Node.js are not needed on the viewing device. A modern browser with support for the bundled decompression workflow is required.

**Offline playback depends on the imported content.** Native slide assets and the automatically collected fonts are included. External scripts, media and other URLs inside an imported webpage still need their original network or file locations unless that webpage already embeds them. Use self-contained HTML/CSS/JS and embedded assets for a fully offline interactive talk.

### Fonts and export size

HTML export automatically packages the required **English/Latin, Greek and math fonts**, including the actual regular, bold and italic faces. It reuses identical font resources across slides and reports missing or restricted fonts rather than silently replacing them. Only embed fonts that permit your intended use.

Additional Chinese/CJK font libraries are **not** automatically included. Chinese text is retained and uses the viewing device's fonts, so its glyphs and line breaks may differ. Fonts already embedded in a document or imported webpage are preserved. The export shows a size warning when the estimated added font data reaches **5 MiB**; continuing keeps those fonts. Font preparation does not add system fonts to your source JSON or change the original slides.

Packaged English fonts stabilize glyphs and line wrapping; browsers may still differ slightly in antialiasing. On a static deployment without the local font catalog, use bundled fonts or import your own font files. SVG images containing live text need outlined text, a raster version, or native slide text boxes for portable typography; path-only drawings and MathJax equations are unaffected.

## Other exports

| Format | Intended use and boundaries |
| --- | --- |
| JSON | Editable source, including LaTeX, images and imported fonts. |
| HTML | Playback and web publishing, including embedded interactive pages. Optional native editing data. |
| PPTX | A static version. Embedded webpages and their interaction are omitted; native text, images, shapes and equations remain in slide order. A webpage-only slide keeps its background, numbering and blank space. The export dialog reports omitted content. |
| PDF / images | Static output. For a deck containing embedded webpages, export HTML and use its **Print** control for PDF. |

PPTX is an interchange format and may differ from the editor. In standard mode, ordinary text and images remain separate objects. Text containing inline math is rendered as a high-resolution transparent image to preserve formula alignment; its editable LaTeX source remains in the JSON/optional editable HTML. PPTX exports never execute embedded webpage JavaScript.

## Agents and development

Give an agent your outline, source material and presentation goals, then iterate together on the document it creates. The agent can work from JSON or full HTML/CSS/JS, use the browser API to inspect and change the open document, save a checkpoint, and operate the export interface. You can continue editing the same native objects or webpage source yourself. This workflow uses your own agent and its local tools; it does not require a built-in cloud AI service.

Start with [AGENTS.md](AGENTS.md) for the collaboration workflow and [the local agent API](doc/LOCAL_AGENT_API.md) for the actual document format and supported operations. Use the browser API for a document currently being edited; direct filesystem changes do not automatically update the open editor. Save and review the resulting presentation before publishing it.

The JSON format is readable and editable by local tools. `window.keynoteLocal` provides document operations, element updates, subscriptions and saving. See [the local agent API](doc/LOCAL_AGENT_API.md). Imported webpages remain whole pages; they are not automatically decomposed into native text boxes and shapes.

```sh
npm run type-check
node --test --test-concurrency=1 scripts/tests/*.test.mjs
npm run build
```

## License and attribution

Keytist / Slide Studio is a modified version of **[PPTist](https://github.com/pipipi-pikachu/PPTist)** by **[pipipi-pikachu](https://github.com/pipipi-pikachu)**. It retains the **GNU Affero General Public License v3.0**; see [LICENSE](LICENSE). The [original upstream README](doc/README.upstream.md), including the original author's public contact and project notices, is retained.

Fonts and dependencies retain their own licenses. See [third-party notices](doc/THIRD_PARTY_NOTICES.md) and the accompanying license files. Public distributions exclude the two upstream converted font binaries whose redistribution provenance was not established; system font files and private documents are not distributed. This project is independent of Apple and is not an Apple Keynote product.
