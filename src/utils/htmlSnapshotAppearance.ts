/** Record the live appearance before an asynchronous DOM clone starts. All
 * helpers intentionally live inside this factory because PDF's sandbox injects
 * its serialized function; no module state or live DOM mutation is required. */
export function createHtmlSnapshotAppearance(root: HTMLElement): (svgDataUrl: string) => Promise<string> {
  const svgNamespace = 'http://www.w3.org/2000/svg'
  const view = root.ownerDocument.defaultView
  if (!view) throw new Error('无法读取网页当前的显示样式。')
  const omitted = new Set(['script', 'style', 'link', 'meta'])
  const controls = new Set(['input', 'textarea', 'select', 'button', 'option', 'progress', 'meter'])
  const controlElements: Element[] = []
  const presentation = [
    'color', 'display', 'visibility', 'opacity', 'overflow',
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
    'marker-start', 'marker-mid', 'marker-end', 'clip-path', 'clip-rule', 'filter', 'mask', 'mask-type',
    'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant',
    'font-feature-settings', 'font-kerning', 'font-variation-settings', 'font-optical-sizing',
    'font-synthesis', 'letter-spacing', 'word-spacing', 'text-anchor', 'text-decoration',
    'text-rendering', 'text-transform', 'direction', 'unicode-bidi', 'writing-mode',
    'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'paint-order', 'vector-effect',
    'shape-rendering', 'image-rendering', 'color-interpolation', 'color-interpolation-filters',
    'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity', 'lighting-color',
    'transform', 'transform-origin', 'transform-box',
  ]
  type Appearance = {
    name: string
    namespace: string | null
    styles: [string, string][]
    children: Appearance[]
    deepSvg: boolean
  }
  const visible = (element: Element) => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      if (view.getComputedStyle(current).display === 'none') return false
    }
    return true
  }
  const record = (element: Element, deepSvg: boolean): Appearance => {
    const svg = element.namespaceURI === svgNamespace
    const deep = deepSvg || svg
    const computed = view.getComputedStyle(element)
    const names = new Set(['font-size'])
    if (svg) presentation.forEach(name => names.add(name))
    // SVG foreignObject descendants are also deep-cloned by the library and
    // therefore never receive its normal HTML style copying.
    if (deepSvg && !svg) Array.from(computed).filter(name => !name.startsWith('--')).forEach(name => names.add(name))
    if (controls.has(element.localName)) {
      controlElements.push(element)
      Array.from(computed).filter(name => name.startsWith('--')).forEach(name => names.add(name))
    }
    const styles: [string, string][] = []
    for (const name of names) {
      const value = computed.getPropertyValue(name)
      if (value) styles.push([name, value])
    }
    let children: Element[]
    if (!deep && element.localName === 'slot' && 'assignedNodes' in element) {
      children = (element as HTMLSlotElement).assignedNodes().filter(node => node.nodeType === 1) as Element[]
    }
    else children = Array.from((!deep && element.shadowRoot ? element.shadowRoot : element).children)
    return {
      name: element.localName, namespace: element.namespaceURI, styles, deepSvg: deep,
      children: children.filter(child => deep || (!omitted.has(child.localName) && visible(child))).map(child => record(child, deep)),
    }
  }
  const appearance = record(root, false)
  type ControlRule = { selector: string; declarations: string; wrappers: string[]; base: string } | { statement: string; wrappers: string[] }
  const controlRules: ControlRule[] = []
  const nativePseudo = /::?(?:-webkit-(?:slider-thumb|slider-runnable-track|progress-bar|progress-value|meter-bar|meter-optimum-value|meter-suboptimum-value|meter-even-less-good-value|search-cancel-button|search-decoration|inner-spin-button|outer-spin-button|file-upload-button|color-swatch|color-swatch-wrapper|calendar-picker-indicator|input-placeholder)|-moz-(?:range-thumb|range-track|range-progress|progress-bar|placeholder|color-swatch)|-ms-(?:thumb|track|fill-lower|fill-upper)|placeholder|file-selector-button)\b/i
  const splitSelectors = (text: string) => {
    const result: string[] = []
    let start = 0, depth = 0, quote = ''
    for (let index = 0; index < text.length; index++) {
      const char = text[index]
      if (char === '\\') {
        index++; continue 
      }
      if (quote) {
        if (char === quote) quote = ''; continue 
      }
      if (char === '"' || char === "'") quote = char
      else if (char === '(' || char === '[') depth++
      else if (char === ')' || char === ']') depth--
      else if (char === ',' && depth === 0) {
        result.push(text.slice(start, index)); start = index + 1 
      }
    }
    result.push(text.slice(start))
    return result
  }
  const appliesToControl = (selector: string) => splitSelectors(selector).some(part => {
    const match = nativePseudo.exec(part)
    if (!match) return false
    const owner = part.slice(0, match.index).trim() || '*'
    return controlElements.some(element => {
      try {
        return element.matches(owner) 
      }
      catch {
        return true 
      } // Preserve a native skin rule if its owner cannot be queried separately.
    })
  })
  const activeMedia = (media: string | undefined) => !media || view.matchMedia(media).matches
  const seenSheets = new Set<CSSStyleSheet>()
  type GroupRule = CSSRule & { selectorText?: string; style?: CSSStyleDeclaration; cssRules?: CSSRuleList; conditionText?: string; media?: MediaList; styleSheet?: CSSStyleSheet; layerName?: string; supportsText?: string }
  const visitRules = (rules: CSSRuleList, base: string, wrappers: string[]) => {
    for (const original of Array.from(rules)) {
      const rule = original as GroupRule
      if (rule.type === 1 && rule.selectorText && rule.style) {
        if (nativePseudo.test(rule.selectorText) && appliesToControl(rule.selectorText)) {
          controlRules.push({ selector: rule.selectorText, declarations: rule.style.cssText, wrappers, base: rule.parentStyleSheet?.href || base })
        }
      }
      else if (rule.type === 3 && rule.styleSheet && activeMedia(rule.media?.mediaText)) {
        if (rule.supportsText && !view.CSS.supports(rule.supportsText)) continue
        const layers = typeof rule.layerName === 'string' ? [...wrappers, `@layer ${rule.layerName}`.trim()] : wrappers
        visitSheet(rule.styleSheet, layers)
      }
      else if (rule.type === 4 && rule.cssRules && activeMedia(rule.conditionText || rule.media?.mediaText)) visitRules(rule.cssRules, base, wrappers)
      else if (rule.type === 12 && rule.cssRules && (!rule.conditionText || view.CSS.supports(rule.conditionText))) visitRules(rule.cssRules, base, wrappers)
      else if (/^@layer\b/i.test(rule.cssText)) {
        if (rule.cssRules) visitRules(rule.cssRules, base, [...wrappers, rule.cssText.slice(0, rule.cssText.indexOf('{')).trim()])
        else controlRules.push({ statement: rule.cssText, wrappers })
      }
    }
  }
  const visitSheet = (sheet: CSSStyleSheet, wrappers: string[]) => {
    if (seenSheets.has(sheet) || sheet.disabled || !activeMedia(sheet.media?.mediaText)) return
    seenSheets.add(sheet)
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules 
    }
    catch {
      throw new Error('网页控件的样式表无法读取，未生成外观不完整的快照。') 
    }
    visitRules(rules, sheet.href || root.ownerDocument.baseURI, wrappers)
  }
  // Only special native-control pseudos are retained. Ordinary page CSS and
  // font-face rules would reintroduce unrelated images/fonts or animations.
  if (controlElements.length) for (const sheet of Array.from(root.ownerDocument.styleSheets)) visitSheet(sheet as CSSStyleSheet, [])
  const bases = [root.ownerDocument.URL, root.ownerDocument.baseURI].filter(Boolean)
  const withoutHash = (url: string) => url.split('#')[0]
  const sameDocument = new Set(bases.map(withoutHash))
  const normalize = (value: string, base: string) => {
    if (value.startsWith('#') || value.startsWith('data:')) return value
    let url: URL
    try {
      url = new URL(value, base) 
    }
    catch {
      throw new Error('网页样式包含无法解析的素材地址。') 
    }
    return url.hash && sameDocument.has(withoutHash(url.href)) ? url.hash : url.href
  }
  const resourceCache = new Map<string, Promise<string>>()
  let resourceBytes = 0
  const embedded = (value: string, base: string): Promise<string> => {
    const source = normalize(value, base)
    if (source.startsWith('#') || source.startsWith('data:')) return Promise.resolve(source)
    const previous = resourceCache.get(source)
    if (previous) return previous
    const pending = (async () => {
      if (resourceCache.size >= 256) throw new Error('网页样式素材过多，无法完整冻结。')
      let response: Response
      try {
        response = await fetch(source) 
      }
      catch {
        throw new Error('网页样式素材无法读取，未生成外观不完整的快照。') 
      }
      if (!response.ok) throw new Error('网页样式素材无法读取，未生成外观不完整的快照。')
      const blob = await response.blob()
      resourceBytes += blob.size
      if (resourceBytes > 64 * 1024 * 1024) throw new Error('网页样式素材过大，无法完整冻结。')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let index = 0; index < bytes.length; index += 16384) binary += String.fromCharCode(...bytes.subarray(index, index + 16384))
      const fragment = new URL(source).hash
      return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}${fragment}`
    })()
    resourceCache.set(source, pending)
    return pending
  }
  const embedCss = async (css: string, base = root.ownerDocument.baseURI) => {
    const pattern = /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/gi
    const matches = [...css.matchAll(pattern)]
    let result = '', cursor = 0
    for (const match of matches) {
      const raw = (match[1] ?? match[2] ?? match[3]).trim().replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, char) => hex ? String.fromCodePoint(parseInt(hex, 16)) : char)
      result += css.slice(cursor, match.index) + `url(${JSON.stringify(await embedded(raw, base))})`
      cursor = match.index! + match[0].length
    }
    return result + css.slice(cursor)
  }
  const generatedDefinition = (element: Element) => element.localName === 'svg' && element.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
    (element as HTMLElement).style?.display === 'none' && (element as HTMLElement).style?.position === 'absolute' &&
    (element as HTMLElement).style?.width === '0px' && (element as HTMLElement).style?.height === '0px'
  return async (svgDataUrl: string) => {
    if (!svgDataUrl.startsWith('data:image/svg+xml')) throw new Error('网页快照的 SVG 数据无效。')
    let markup: string
    try {
      markup = decodeURIComponent(svgDataUrl.slice(svgDataUrl.indexOf(',') + 1)) 
    }
    catch {
      throw new Error('网页快照的 SVG 数据无效。') 
    }
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
    if (parsed.querySelector('parsererror')) throw new Error('网页快照的 SVG 数据无效。')
    const foreign = Array.from(parsed.documentElement.children).find(element => element.localName === 'foreignObject')
    const clone = foreign?.firstElementChild
    if (!clone) throw new Error('网页快照缺少当前画面的内容。')
    const apply = async (source: Appearance, target: Element) => {
      const substituted = !source.deepSvg && ['canvas', 'video', 'iframe'].includes(source.name) && target.localName === 'img'
      if ((!substituted && source.name !== target.localName) || (!substituted && source.namespace !== target.namespaceURI)) {
        throw new Error('网页结构在冻结时发生变化，请重新冻结当前画面。')
      }
      const style = (target as HTMLElement | SVGElement).style
      if (style) {
        for (const [name, value] of source.styles) style.setProperty(name, await embedCss(value), 'important')
        style.setProperty('animation', 'none', 'important')
        style.setProperty('transition', 'none', 'important')
      }
      if (substituted) return
      const children = Array.from(target.children).filter(element => {
        if (!source.deepSvg && omitted.has(element.localName)) return false
        return true
      })
      // Definitions added by html-to-image are appended after source children.
      // Keep an originally hidden nested SVG when it belongs to the source.
      while (children.length > source.children.length && generatedDefinition(children[children.length - 1])) children.pop()
      if (children.length !== source.children.length) throw new Error('网页结构在冻结时发生变化，请重新冻结当前画面。')
      for (let index = 0; index < children.length; index++) await apply(source.children[index], children[index])
      // Deep-cloned SVG may contain source CSS/scripts. Their effective styles
      // are now frozen inline; retaining the original sheets could restart
      // animations or introduce unembedded URLs during the final redraw.
      if (source.deepSvg) for (const child of Array.from(target.children)) if (omitted.has(child.localName)) child.remove()
    }
    await apply(appearance, clone)
    if (controlRules.some(rule => 'selector' in rule)) {
      const css: string[] = []
      for (const rule of controlRules) {
        let text = 'statement' in rule ? rule.statement : `${rule.selector}{${await embedCss(rule.declarations, rule.base)};animation:none!important;transition:none!important;}`
        for (const wrapper of [...rule.wrappers].reverse()) text = `${wrapper}{${text}}`
        css.push(text)
      }
      const style = parsed.createElementNS('http://www.w3.org/1999/xhtml', 'style')
      style.textContent = css.join('\n')
      clone.appendChild(style)
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(parsed))}`
  }
}
