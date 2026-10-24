import { STUDIO_THEME_COLORS } from './colors'
import type { PPTElementOutline, PPTElementShadow } from '@/types/slides'

export interface PresetTheme {
  background: string
  fontColor: string
  fontname: string
  colors: string[]
  borderColor?: string
  outline?: PPTElementOutline
  shadow?: PPTElementShadow
}

export const PRESET_THEMES: PresetTheme[] = [
  {
    'background': '#ffffff',
    'fontColor': '#1d1d1f',
    'fontname': 'Helvetica Neue',
    'colors': [...STUDIO_THEME_COLORS],
    'borderColor': '#007aff'
  },
  {
    'background': '#101014',
    'fontColor': '#f5f5f7',
    'fontname': 'Helvetica Neue',
    'colors': [
      '#64d2ff',
      '#bf5af2',
      '#5e5ce6',
      '#30d158',
      '#ffd60a',
      '#ff453a'
    ],
    'borderColor': '#64d2ff'
  },
  {
    'background': '#fbf7ef',
    'fontColor': '#39352e',
    'fontname': 'Helvetica Neue',
    'colors': [
      '#487b98',
      '#c77f69',
      '#a3997e',
      '#76987f',
      '#d2ae70',
      '#8e7daa'
    ],
    'borderColor': '#487b98'
  },
  {
    'background': '#f7f8fc',
    'fontColor': '#20253b',
    'fontname': 'Helvetica Neue',
    'colors': [
      '#5063b0',
      '#7c81ca',
      '#8ebfce',
      '#91ad8b',
      '#d9b376',
      '#c98693'
    ],
    'borderColor': '#5063b0'
  },
  {
    'background': '#ffffff',
    'fontColor': '#1d1d1f',
    'fontname': 'Helvetica Neue',
    'colors': [
      '#1d1d1f',
      '#636366',
      '#8e8e93',
      '#aeaeb2',
      '#c7c7cc',
      '#e5e5ea'
    ],
    'borderColor': '#1d1d1f'
  },
  {
    'background': '#10263a',
    'fontColor': '#ffffff',
    'fontname': 'Helvetica Neue',
    'colors': [
      '#4aa9e0',
      '#8bd2d6',
      '#e6b869',
      '#cc7a72',
      '#a8a2d6',
      '#8cba9a'
    ],
    'borderColor': '#4aa9e0'
  }
]
