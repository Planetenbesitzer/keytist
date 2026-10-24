import axios from './axios'
import fetchRequest from './fetch'
import { t } from '@/i18n'

// Remote tools are opt-in. Local editing and agent access need no cloud service.
export const SERVER_URL = (import.meta.env.VITE_STUDIO_REMOTE_API || '').replace(/\/$/, '')
const remoteUrl = (pathname: string) => {
  if (!SERVER_URL) throw new Error(t('在线服务尚未配置，请设置 VITE_STUDIO_REMOTE_API 后重试。'))
  return `${SERVER_URL}${pathname}`
}

interface ImageSearchPayload {
  query: string;
  orientation?: 'landscape' | 'portrait' | 'square' | 'all';
  locale?: 'zh' | 'en';
  order?: 'popular' | 'latest';
  size?: 'large' | 'medium' | 'small';
  image_type?: 'all' | 'photo' | 'illustration' | 'vector';
  page?: number;
  per_page?: number;
}

interface AIPPTOutlinePayload {
  content: string
  language: string
  provider: string
  model: string
}

interface AIPPTPayload {
  content: string
  language: string
  style: string
  provider: string
  model: string
}

interface AIWritingPayload {
  content: string
  command: string
}

export default {
  getMockData(filename: string): Promise<any> {
    return axios.get(`./mocks/${filename}.json`)
  },

  async searchImage(body: ImageSearchPayload): Promise<any> {
    return axios.post(remoteUrl('/tools/img_search'), body)
  },

  async AIPPT_Outline({
    content,
    language,
    provider,
    model,
  }: AIPPTOutlinePayload): Promise<any> {
    return fetchRequest(remoteUrl('/tools/aippt_outline'), {
      method: 'POST',
      body: JSON.stringify({
        content,
        language,
        provider,
        model,
        stream: true,
      }),
    })
  },

  async AIPPT({
    content,
    language,
    style,
    provider,
    model,
  }: AIPPTPayload): Promise<any> {
    return fetchRequest(remoteUrl('/tools/aippt'), {
      method: 'POST',
      body: JSON.stringify({
        content,
        language,
        provider,
        model,
        style,
        stream: true,
      }),
    })
  },

  async AI_Writing({
    content,
    command,
  }: AIWritingPayload): Promise<any> {
    return fetchRequest(remoteUrl('/tools/ai_writing'), {
      method: 'POST',
      body: JSON.stringify({
        content,
        command,
        stream: true,
      }),
    })
  },
}
