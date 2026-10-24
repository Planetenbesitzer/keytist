import { STUDIO_CHART_PALETTES } from './colors'
import type { ChartData } from '@/types/slides'

export const CHART_TYPE_MAP: Record<string, string> = {
  'bar': '柱状图',
  'column': '条形图',
  'line': '折线图',
  'area': '面积图',
  'scatter': '散点图',
  'pie': '饼图',
  'ring': '环形图',
  'radar': '雷达图',
}

export const CHART_DEFAULT_DATA: Record<string, ChartData> = {
  'bar': {
    labels: ['类别1', '类别2', '类别3', '类别4', '类别5'],
    legends: ['系列1', '系列2'],
    series: [[12, 19, 5, 2, 18], [7, 11, 13, 21, 9]],
  },
  'column': {
    labels: ['类别1', '类别2', '类别3', '类别4', '类别5'],
    legends: ['系列1', '系列2'],
    series: [[12, 19, 5, 2, 18], [7, 11, 13, 21, 9]],
  },
  'line': {
    labels: ['类别1', '类别2', '类别3', '类别4', '类别5'],
    legends: ['系列1', '系列2'],
    series: [[12, 19, 5, 2, 18], [7, 11, 13, 21, 9]],
  },
  'pie': {
    labels: ['类别1', '类别2', '类别3', '类别4', '类别5'],
    legends: ['值'],
    series: [[12, 19, 5, 2, 18]],
  },
  'ring': {
    labels: ['类别1', '类别2', '类别3', '类别4', '类别5'],
    legends: ['值'],
    series: [[12, 19, 5, 2, 18]],
  },
  'area': {
    labels: ['类别1', '类别2', '类别3', '类别4', '类别5'],
    legends: ['系列1', '系列2'],
    series: [[12, 19, 5, 2, 18], [7, 11, 13, 21, 9]],
  },
  'radar': {
    labels: ['类别1', '类别2', '类别3', '类别4', '类别5'],
    legends: ['系列1', '系列2'],
    series: [[12, 19, 5, 2, 18], [7, 11, 13, 21, 9]],
  },
  'scatter': {
    labels: ['坐标1', '坐标2', '坐标3', '坐标4', '坐标5'],
    legends: ['X', 'Y'],
    series: [[12, 19, 5, 2, 18], [7, 11, 13, 21, 9]],
  },
}

export const CHART_PRESET_THEMES = STUDIO_CHART_PALETTES
