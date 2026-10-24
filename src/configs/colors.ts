// Coordinated Studio palettes inspired by Keynote's theme-based color wells.
// These are sRGB design choices, not a universal or official Keynote palette.
export const STUDIO_ACCENT_COLORS = ['#007aff', '#32ade6', '#00a99d', '#61b346', '#f5c344', '#f69a38', '#e96c63', '#a477c8']

export const STUDIO_THEME_COLORS = ['#007aff', '#00a99d', '#61b346', '#f5c344', '#e96c63', '#a477c8']

export const STUDIO_NEUTRAL_COLORS = ['#ffffff', '#f2f2f7', '#e5e5ea', '#c7c7cc', '#8e8e93', '#636366', '#38383a', '#1d1d1f']

export const STUDIO_COLOR_SCHEMES = [
  { id: 'bright', name: '明亮', colors: STUDIO_ACCENT_COLORS },
  { id: 'soft', name: '柔和', colors: ['#487b98', '#76a8ba', '#76987f', '#a3997e', '#d2ae70', '#c77f69', '#b47b96', '#8e7daa'] },
  // Approximate CSS RGB references to Keynote 14.4's Spectrum chart colors;
  // the original calibrated RGB colors can differ under color management.
  { id: 'spectrum', name: '光谱', colors: ['#2e578c', '#5d9648', '#e7a13d', '#bc2d30', '#6f3d79', '#7d807f'] },
] as const

export const STUDIO_CHART_PALETTES = [
  STUDIO_THEME_COLORS,
  ['#64b5f6', '#5bc5bb', '#a4cf7b', '#f4d56a', '#f49e91', '#bc9dd9'],
  ['#15539b', '#277c78', '#476e36', '#af8530', '#9d4b48', '#6d528c'],
  STUDIO_COLOR_SCHEMES[1].colors,
  STUDIO_COLOR_SCHEMES[2].colors,
  ['#4aa9e0', '#8bd2d6', '#e6b869', '#cc7a72', '#a8a2d6', '#8cba9a'],
  ['#1d1d1f', '#48484a', '#636366', '#8e8e93', '#aeaeb2', '#c7c7cc'],
].map(colors => [...colors])
