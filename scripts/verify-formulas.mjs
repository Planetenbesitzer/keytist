import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = path.join(root, `.formula-verification-${process.pid}.mjs`)
const presetsTemporary = path.join(root, `.formula-presets-${process.pid}.mjs`)
const samples = {
  aligned: String.raw`\begin{aligned}\mu\frac{\mathrm d}{\mathrm d\mu}\hat H(z,\mu)&=\frac{\alpha_s}{2\pi}\int_z^1\frac{\mathrm dy}{y}\,P\!\left(\frac zy\right)\hat H(y,\mu)\\&\quad+\mathcal O(\alpha_s^2)\end{aligned}`,
  nested: String.raw`\frac{\int_0^1\mathrm dz\,z\,\hat H(z)}{\sqrt{1+\frac{q_T^2}{Q^2}}}`,
  customMacros: String.raw`\newcommand{\cF}{\mathcal F}\newcommand{\dd}{\mathrm d}\cF(Q)=\int_0^1\dd z\,\hat H(z,Q)`,
  matrix: String.raw`\begin{pmatrix}A&B\\C&D\end{pmatrix}\begin{pmatrix}q\\g\end{pmatrix}`,
  qcd: String.raw`\mathcal{L}_{\mathrm{QCD}}=-\frac14F^a_{\mu\nu}F^{a\mu\nu}+\sum_f\bar q_f\left(i\gamma^\mu D_\mu-m_f\right)q_f`,
}

try {
  await fs.mkdir(path.join(root, 'verification'), { recursive: true })
  const source = await fs.readFile(path.join(root, 'src/utils/latex.ts'), 'utf8')
  const compiled = await transform(source, { loader: 'ts', format: 'esm', target: 'es2020' })
  await fs.writeFile(temporary, compiled.code)
  const { renderLatex, sanitizeLatexSvg, mergeLatexElement } = await import(temporary)
  const presetsSource = await fs.readFile(path.join(root, 'src/configs/latex.ts'), 'utf8')
  await fs.writeFile(presetsTemporary, (await transform(presetsSource, { loader: 'ts', format: 'esm', target: 'es2020' })).code)
  const { FORMULA_LIST, SYMBOL_LIST } = await import(presetsTemporary)
  const presets = [...FORMULA_LIST, ...SYMBOL_LIST.flatMap(group => group.children)]
  for (const preset of presets) renderLatex(preset.latex)
  const results = {}
  for (const [name, latex] of Object.entries(samples)) {
    const result = renderLatex(latex)
    assert.ok(result.w > 0 && result.h > 0)
    assert.ok(Number.isFinite(result.w) && Number.isFinite(result.h))
    assert.match(result.svg, /<path/)
    assert.doesNotMatch(result.svg, /<(?:image|use|foreignObject|script)\b|(?:href|src)\s*=/i)
    assert.equal(result.latex, latex)
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
    const viewBox = /viewBox="([^"]+)"/.exec(result.svg)?.[1]
    assert.ok(viewBox)
    const [, , width, height] = viewBox.split(/\s+/).map(Number)
    assert.ok(Math.abs(result.w - width / 1000 * 32) < 0.01)
    assert.ok(Math.abs(result.h - height / 1000 * 32) < 0.01)
    results[name] = { source: latex, width: result.w, height: result.h, viewBox, bytes: result.svg.length, sourcePreserved: true, selfContained: true, jsonRoundtrip: true }
    await fs.writeFile(path.join(root, 'verification', `math-${name}.svg`), result.svg)
  }
  for (const input of [String.raw`\undefinedCommand{x}`, String.raw`\frac{a}`, String.raw`\dd x`]) assert.throws(() => renderLatex(input))
  const originalRender = renderLatex('x^2')
  const original = { type: 'latex', id: 'formula-test', latex: 'x^2', path: '', svg: originalRender.svg, width: originalRender.w * 2, height: originalRender.h * 2, viewBox: [originalRender.w, originalRender.h], left: 100, top: 200, rotate: 0, color: '#007aff', strokeWidth: 0, fixedRatio: true }
  const edited = mergeLatexElement(original, { latex: 'x^2+y^2' })
  assert.match(edited.svg, /<path/)
  assert.notEqual(edited.svg, original.svg)
  assert.equal(edited.latex, 'x^2+y^2')
  assert.ok(Math.abs(edited.width / edited.viewBox[0] - 2) < 1e-9)
  assert.ok(Math.abs(edited.height / edited.viewBox[1] - 2) < 1e-9)
  assert.ok(Math.abs((edited.left + edited.width / 2) - (original.left + original.width / 2)) < 1e-9)
  assert.ok(Math.abs((edited.top + edited.height / 2) - (original.top + original.height / 2)) < 1e-9)
  const explicit = mergeLatexElement(original, { latex: 'x^2+y^2', width: 333, left: 20 })
  assert.equal(explicit.width, 333)
  assert.equal(explicit.left, 20)
  assert.ok(Math.abs(explicit.width / explicit.height - explicit.viewBox[0] / explicit.viewBox[1]) < 1e-9)
  const originalSnapshot = JSON.stringify(original)
  assert.throws(() => mergeLatexElement(original, { latex: String.raw`\undefinedCommand{x}` }))
  assert.equal(JSON.stringify(original), originalSnapshot)
  assert.deepEqual(JSON.parse(JSON.stringify(edited)), edited)
  const malicious = '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><foreignObject><img src="x" onerror="alert(2)"></foreignObject><image href="https://example.com/x"/><animate attributeName="href"/><path d="M0 0L2 2" fill="url(https://example.com)" onclick="alert(1)"/></svg>'
  const sanitized = sanitizeLatexSvg(malicious)
  assert.doesNotMatch(sanitized, /script|foreignObject|<img|<image|<animate|onload|onerror|onclick|href|url\(/i)
  assert.match(sanitized, /viewBox="0 0 10 10"/)
  assert.match(sanitized, /<path d="M0 0L2 2"/)
  const report = { generatedAt: new Date().toISOString(), engine: 'MathJax 3.2.2, local SVG, fontCache=none', results, checks: { allPresetCount: presets.length, allPresetsRendered: true, invalidSyntaxRejected: true, macrosIsolated: true, importedSvgSanitized: true, intrinsicDimensionsMatchViewBox: true, sourceOnlyPatchUpdatesSvg: true, sourcePatchPreservesScaleAndCenter: true, explicitGeometryHonored: true, invalidSourceDoesNotMutateOriginal: true, editedFormulaJsonRoundtrip: true }, visualChecks: 'This script checks rendering structure and data roundtrip; visual inspection is a separate check.' }
  await fs.writeFile(path.join(root, 'verification/math-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log('Math checks passed:', Object.keys(results).join(', '))
  console.log('Wrote verification/math-report.json and self-contained SVG fixtures.')
}
finally { await fs.rm(temporary, { force: true }); await fs.rm(presetsTemporary, { force: true }) }
