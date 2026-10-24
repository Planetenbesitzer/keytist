# Local documents and agent access

The editor runs locally. Its native document is readable JSON, using the upstream
`title`, `width`, `height`, `theme`, and `slides` fields. An additional
`embeddedFonts` array carries imported font bytes inside the same document:

```ts
type EmbeddedFont = {
  id: string
  family: string
  name: string
  mime: string
  dataUrl: string
}
```

Images uploaded from disk and imported fonts travel with the JSON. External image
URLs and media URLs still require their original resource. System font names in
native JSON still require that font when editing; publishing HTML now reads and
embeds the available font bytes separately without modifying the original JSON.
Equations preserve their editable LaTeX and
rendered SVG. Unrecognized top-level metadata fields are retained when loading,
editing, and saving a native document.

## Browser API

Wait for `window.keynoteLocal` or the `keynote-local:ready` event. API version 1.0:

```js
const studio = window.keynoteLocal
const document = studio.getDocument() // Detached JSON data, safe to edit.
document.title = 'My research talk'
document.slides[0].elements[0].left = 80
await studio.loadDocument(document) // Also accepts a JSON string; resets undo.
await studio.flush() // Resolve only after an IndexedDB commit.
```

`setDocument` is an alias for `loadDocument`. Loading validates the input before
replacing the current document. It rejects invalid dimensions, missing theme
fields, duplicate slide or element IDs, invalid geometry, and invalid embedded
font data. Failed validation leaves the current document intact.

For a small edit, preserve the existing undo history:

```js
const slide = studio.getDocument().slides[0]
await studio.updateElement(slide.id, slide.elements[0].id, {
  left: 100,
  top: 120,
})
studio.selectSlide(slide.id) // Also accepts a zero-based index.
studio.getSelection() // { slideIndex, slideId, elementIds }
```

`updateElement` retains the original element ID. Its `content` property for text
boxes is the upstream rich-text HTML string. Layout values use document pixels;
the default slide is 1000 × 562.5. LaTeX elements carry their original `latex`
source; see the upstream element schema in `src/types/slides.ts` for every field.

```js
const unsubscribe = studio.subscribe(document => {
  // Called after changes. Consumers receive detached document data.
})
unsubscribe()
studio.getStatus() // Local persistence state and last-save timestamp.
await studio.newDocument() // One blank slide with the local default theme.
```

`studio.download()` immediately downloads the current JSON document.
`await studio.save()` writes back to the native file opened in this session when
the browser supports File System Access. With no opened native handle, the local
Slide Studio server saves into its configured default output directory (normally
`~/Documents/Code/SlidesStudio/output`) without a picker. The returned server
result contains `fileName`, `path`, `fileKey`, and `revision`. Repeated saves and
browser reloads keep that binding; changing the document title does not rename
the bound file. Opening or creating another document clears the binding. Binding
metadata lives only in browser IndexedDB and is not added to the user's JSON.

New files with an existing name receive a distinct filename. Rewriting a bound
file checks its previous content revision; if another program changed that file,
Save reports the conflict and preserves the external file. A known local server
error is reported instead of silently sending the file to Downloads.
Generated JSON filenames are limited to 240 UTF-8 bytes without splitting Chinese
characters or emoji. This affects only the filename; the document title remains
unchanged.

`await studio.save({ saveAs: true })` chooses a new native target. In a standalone
static build without the local save API, ordinary Save retains the native picker
or browser-download fallback.
A native file picker requires a real user click. On the local Slide Studio
server an unattended agent can call `await studio.save()` to write the configured
output directory. In a standalone build it can instead use `getDocument()` and
write JSON through its filesystem tool, or use `download()` through browser
automation.

Agents may also edit a saved JSON directly and open that file in the editor.
Use the browser API when inspecting or changing the currently visible document.
No account or cloud document service is involved.

## Inline equations in native text

While editing a text box or shape text, place the caret between words and use
the toolbar's equation button or Option+Command+E (⌥⌘E). The equation stays in
the text flow and follows the surrounding font size and color. Double-click it
to edit its LaTeX. Outside text editing, inserting an equation retains the
existing independent vector-object behavior.

Native `text.content` and `shape.text.content` use the marker
`span[data-inline-math][data-latex]`. Agents can supply only the LaTeX source:

```js
await studio.updateElement(slide.id, textBox.id, {
  content: '<p>Energy <span data-inline-math="1" data-latex="E=mc^2"></span> in the text.</p>',
})
```

Escape attribute values when constructing HTML, including `&` and quotes in the
LaTeX. Loading or updating native content rebuilds the inline SVG from
`data-latex`; a supplied SVG is not authoritative. Surrounding rich-text marks
provide typography, and the generated SVG uses relative dimensions and inherited
color. JSON saves retain the LaTeX source and full editable document. Published
HTML retains the displayed text/SVG; select **保留重新导入编辑能力** when exporting
to include the native document and restore editable text and equations on import.

HTML and PDF retain the native text/SVG rendering. In a standard PPTX export,
each text layer containing inline equations becomes one high-resolution
transparent picture so its formulas, surrounding text, and line wrapping stay
together. That text layer is not editable as PowerPoint text. Unaffected text
layers and underlying shapes remain native PowerPoint objects. Independent
equation objects are unchanged.

## Automatic slide numbers

The toolbar's **文本框 → 自动页码…** dropdown or **⋯ → 自动页码…** menu
applies native automatic footer text to the document. The default counts the cover as page 1 but hides its footer, so the
second slide displays 2. New or copied slides inherit an existing automatic
footer; adding, deleting, reordering or restoring slides recalculates numbers
and cover visibility. Existing documents are unchanged until numbering is applied.

```js
await studio.setAutomaticPageNumbers({
  start: 1,
  format: 'number', // 'number', 'twoDigits', or 'fraction'
  hideOnFirst: true,
})
// Optional second argument: opt in to converting existing numeric footers.
await studio.setAutomaticPageNumbers({ start: 1, format: 'twoDigits', hideOnFirst: true }, true)
await studio.removeAutomaticPageNumbers()
```

These operations retain undo history and flush the updated local document.
`start` is an integer from 0 to 999999. `fraction` displays the current number
and the final number, for example `2 / 12` with the default start. The optional
conversion reuses a matching numeric footer's geometry, typography and ID; other
text is left intact. Removing automatic numbers deletes only still-marked fields.

An automatic number is a native `text` element carrying this additional property:

```ts
autoPageNumber?: {
  start: number
  format: 'number' | 'twoDigits' | 'fraction'
  hideOnFirst: boolean
  hidden?: boolean // Derived from physical slide order; do not set manually.
}
```

`content` remains ordinary rich-text HTML with the current number materialized.
Loading and saving native documents normalize that value, so files remain readable
without executing JavaScript. A `textType: 'footer'` alone does not enable automatic
numbering. Position, font, size and color can be edited normally without losing
automation. Changing the visible text through `updateElement` or the text editor
detaches only that field and preserves its new text and styling. Changing only
rich-text formatting retains automation. Hidden cover numbers cannot be selected
through the canvas, layer list or Tab navigation.

JSON and editable HTML retain the automatic field metadata. Playback HTML, PDF,
images and PPTX display the current number, omitting the hidden cover footer.

## Complete HTML pages

An HTML page is stored as `slide.html = { source, width?, height?, left?, top?, scale? }` beneath the
slide's native `elements`. `source` retains the complete HTML, CSS, and JavaScript.
The optional dimensions describe the page's own viewport; it scales uniformly to
fit the slide and stays centered. Without those dimensions it follows the slide.
`left` and `top` offset that complete fitted page in slide coordinates (default
zero); `scale` uniformly scales it around its top-left corner (default one,
range 0.05 to 10). These fields survive source edits, JSON round trips, thumbnails,
presentation and HTML publishing. Moving or resizing the outer page leaves its
own viewport and running JavaScript unchanged.

```js
await studio.importHtmlDocument(htmlSource, {
  mode: 'append', // Or 'replace' to open a new document and reset history.
  viewport: { width: 1280, height: 720 }, // Optional; applies to plain HTML only.
})
const id = studio.getSelection().slideId
await studio.updateHtmlSlideSource(id, updatedSource, { width: 1280, height: 720 })
// Omitting the third argument removes a previous viewport override.
await studio.updateHtmlSlideSource(id, updatedSource)
```

Appending and source edits retain undo history. Plain HTML imports as one whole
page; it is never automatically split into editable native objects. New exports
default to compact playback HTML, omitting the native editing backup. Selecting
**保留重新导入编辑能力** includes a `script#slide-studio-document` with
`type="application/json"` inside the expanded page; importing that export restores
the complete original document. Both modes deduplicate repeated embedded assets
and gzip the page into a self-contained loader, preserving the exact expanded
HTML, SVG and JavaScript. Import decompresses recognized compact exports as inert
data before reading their metadata; it does not run their scripts. Legacy
uncompressed exports remain supported. Playback-only HTML may be imported as one
whole HTML page within the ordinary per-page limit, without native object recovery.
Metadata import ignores a supplied viewport override. Appending a native document
with different slide dimensions or conflicting embedded fonts fails visibly;
use replace mode to preserve that document's original layout.

HTML runs in a separate opaque-origin iframe with `allow-scripts allow-forms`,
without access to the editor's DOM or CSS. Its pointer interaction is disabled in
the editor and thumbnails, and enabled in presentation mode. Frames expose
`data-ready="true"` after loading and painting. HTML source must be nonempty and
at most 25 MiB characters per slide; an imported metadata HTML envelope may be at
most 100 MiB characters. Recognized compact files are decoded under independent
512 MiB limits for the encoded file, decompressed payload and restored HTML;
their native document metadata may exceed the legacy envelope limit. The file
picker still accepts files up to 100 MiB. Playback-only imports retain the normal
25 MiB per-page limit. Invalid or oversized data leaves the current document intact.
Relative or external resources still need to be available to the browser; use a
self-contained HTML file for reliable offline presentation.

## Portable fonts in published HTML

HTML publishing automatically embeds Latin, Greek and math faces used by native
text and embedded HTML. It does not add CJK font libraries. Chinese characters
remain in the output and use the destination's fonts, so their appearance and
wrapping are not guaranteed across devices. Large CJK faces are identified by
Unicode coverage, including fonts with unrelated aliases. Existing fonts already
embedded in document metadata or HTML are preserved, and are outside the newly
packaged-font size report. English set in a CJK face is reported as outside the
automatic embedding scope rather than silently claiming portable typesetting.
It reads actual family/weight/style usage, validates Unicode coverage and OS/2
embedding flags, and carries complete selected faces. TTC collections are split by
`faceIndex`; SFNT tables are wrapped losslessly in WOFF, and WOFF2 remains WOFF2.
Repeated faces are deduplicated across slides by the compact HTML resource pack.
Fonts load before the player reveals content, and mobile text autosizing is
disabled. Antialiasing can still differ between browser engines.

An unavailable Latin font or an uncovered non-CJK character produces a visible
error naming the problem and cancels export. Non-CJK fallback faces can fill
missing characters; this produces a warning so authors can inspect the preview.
Publishing does not assume the destination has the selected Latin font. Import the
required font or choose an available bundled face to resolve the error. A font
package with an estimated encoded HTML cost of at least 5 MiB triggers a size
warning; fonts are retained when continuing.
The warning does not trigger automatic font replacement, rasterization or
subsetting. Preview/print-only fonts are accepted only in playback exports and
are rejected when embedding an editable document. Restricted or bitmap-only
outline fonts are not embedded.

The original document and its `embeddedFonts` are not rewritten by publishing.
Editable exports retain the original native JSON metadata, while their viewer
also carries its separate display fonts. Arbitrary JavaScript may introduce
additional text at runtime; use a carried family whose full charset covers that
text and declare any additional families in the source. Other external assets
inside an embedded page still require independent offline preparation.

Linked CSS is snapshotted in its original cascade position; `@import` conditions
are retained and relative URLs become absolute. Unreadable stylesheets and CSPs
that block embedded fonts or added inline styles stop export explicitly. Source
JavaScript is retained byte for byte. SVG images with text or `foreignObject`
must first have text outlined, become ordinary images, or use native text boxes;
their independent font contexts are not silently assumed portable. Native SVG
text and path-only formula artwork remain supported.

`node scripts/serve.mjs` generates `dist/local-fonts/catalog.json` before serving.
The catalog contains opaque font URLs, metadata and Unicode ranges, without
filesystem paths. Controlled file links expose only fonts found under the
platform font-directory allowlist. Font bytes are not duplicated on disk;
Windows can use same-volume hard links if symbolic-link permission is missing.
Catalog generation failures do not prevent native JSON saving. A running server
can serve a regenerated catalog immediately without restarting:

```js
import { generateLocalFontCatalog } from './scripts/font-catalog.mjs'
await generateLocalFontCatalog({ distDirectory: '/absolute/path/to/dist' })
```

Do not include `local-fonts` when copying or distributing a build. The share
packager excludes that directory at every level and checks the archive names.
Recipients generate their own catalog at startup. On a pure static deployment,
use bundled or imported fonts; missing system fonts are reported at export time.
Bundled WOFF2 metadata is stored in `src/configs/bundledFontMetadata.json`,
including font SHA256 hashes and Unicode coverage. It can be regenerated with
`scripts/generate-bundled-font-metadata.py` when FontTools and Brotli are present;
the running app and share package do not require Python.

## Persistence and file controls

The header provides Open, Save, and Save As. Keyboard shortcuts are
Command/Control+O, Command/Control+S, and Shift+Command/Control+S.

The complete current document automatically commits to the browser's
`KeynoteLocalDocuments` IndexedDB database after 350 ms without another edit,
and at least every 1.8 seconds during continuous editing. Reloading the same
local address restores that document and its active slide. The temporary undo
database is separate. Browser storage belongs to that browser profile and exact
local address; use JSON files for backups, portability, and version control.

The status indicator reports browser persistence. Its tooltip and the Save button
show the default output directory or last saved path when the local server is
available. Explicit Save creates or updates a JSON file; autosave does not
silently write into the user's filesystem.
If browser storage is unavailable or full, the indicator shows an error while
JSON file saving and downloading remain available.
