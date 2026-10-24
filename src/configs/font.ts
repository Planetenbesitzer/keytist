import { reactive } from 'vue'
import { hasSystemFont } from '@/utils/fontAvailability'

export interface FontOption {
  label: string
  value: string
  fontFamily?: string
  group?: string
  note?: string
  disabled?: boolean
}

export const PREFERRED_FONT_NAMES = ['Helvetica Neue', 'Times New Roman', 'Apple Chancery', 'Arial']
export const preferredFontOption = (family: string): FontOption => {
  const available = hasSystemFont(family)
  return { label: family, value: family, fontFamily: family, group: '常用', note: available ? '本机可用' : '未安装', disabled: !available }
}

// System faces stay local. Imported font files are added to this same reactive
// list so every text, table, and theme font selector sees them immediately.
export const FONTS = reactive<FontOption[]>([
  ...PREFERRED_FONT_NAMES.map(preferredFontOption),
  { label: '默认字体', value: '' },
  { label: '系统字体', value: '-apple-system' },
  { label: 'Avenir Next', value: 'Avenir Next' },
  { label: 'Avenir', value: 'Avenir' },
  { label: 'Gill Sans', value: 'Gill Sans' },
  { label: 'Optima', value: 'Optima' },
  { label: 'Futura', value: 'Futura' },
  { label: 'Baskerville', value: 'Baskerville' },
  { label: 'Palatino', value: 'Palatino' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Hoefler Text', value: 'Hoefler Text' },
  { label: 'Didot', value: 'Didot' },
  { label: 'Menlo', value: 'Menlo' },
  { label: 'Monaco', value: 'Monaco' },
  { label: '苹方', value: 'PingFang SC' },
  { label: '冬青黑体', value: 'Hiragino Sans GB' },
  { label: '华文宋体', value: 'Songti SC' },
  { label: '华文黑体', value: 'Heiti SC' },
  { label: '华文楷体', value: 'Kaiti SC' },
  { label: '思源黑体', value: 'SourceHanSans' },
  { label: '思源宋体', value: 'SourceHanSerif' },
  { label: '文鼎PL楷体', value: 'WenDingPLKaiTi' },
  { label: '文鼎PL宋体', value: 'WenDingPLSongTi' },
  { label: '朱雀仿宋', value: 'ZhuQueFangSong' },
  { label: '霞鹜文楷', value: 'LXGWWenKai' },
  { label: '霞鹜新致宋', value: 'LXGWNeoZhiSong' },
  { label: '霞鹜新晰黑', value: 'LXGWNeoXiHei' },
  { label: '得意黑', value: 'DeYiHei' },
  { label: 'Source Serif 4', value: 'SourceSerif4' },
  { label: 'JetBrains Mono', value: 'JetBrainsMono' },
  { label: 'Literata', value: 'Literata' },
  { label: 'Inter', value: 'Inter' },
  { label: 'Roboto', value: 'Roboto' },
  { label: 'Open Sans', value: 'OpenSans' },
  { label: 'Montserrat', value: 'Montserrat' },
  { label: 'Source Sans Pro', value: 'SourceSansPro' },
  { label: 'Merriweather', value: 'Merriweather' },
  { label: 'Lato', value: 'Lato' },
].map(font => ({ group: '其他字体', ...font, fontFamily: font.value })))
