import fs from 'node:fs/promises'
import { createServer } from 'vite'
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { createStarterDocument } = await vite.ssrLoadModule('/src/configs/starter.ts')
  const { title, theme, slides, viewportSize, viewportRatio } = await createStarterDocument()
  const doc = { title, width:viewportSize, height:viewportSize*viewportRatio, theme, slides, embeddedFonts:[] }
  await fs.mkdir('examples',{recursive:true})
  await fs.writeFile('examples/我的第一份演示.json',JSON.stringify(doc,null,2)+'\n')
  console.log('已生成可编辑示例文稿。')
} finally { await vite.close() }
