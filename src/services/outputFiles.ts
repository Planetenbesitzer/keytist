export interface LocalOutputConfig {
  version: number
  outputDirectory: string
  token: string
}

export interface OutputFileBinding {
  fileName: string
  fileKey: string
  revision: string
}

export interface OutputFileResult extends OutputFileBinding {
  method: 'server'
  path: string
}

let configuration: Promise<LocalOutputConfig | null> | undefined

/** Static previews keep their normal browser download/picker fallback. */
export const preloadOutputConfiguration = (): Promise<LocalOutputConfig | null> => {
  configuration ||= (async () => {
    let response: Response
    try {
      response = await fetch('/api/local/config', { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    }
    catch {
      return null
    }
    if (response.status === 404 || !response.headers.get('content-type')?.includes('application/json')) return null
    if (!response.ok) throw new Error('无法读取本地保存目录，请重新启动 Keytist。')
    const config = await response.json()
    if (config.version !== 1 || typeof config.outputDirectory !== 'string' || typeof config.token !== 'string') {
      throw new Error('本地保存服务版本不匹配，请重新启动 Keytist。')
    }
    return config as LocalOutputConfig
  })()
  return configuration
}

const writeOutput = async (
  data: Blob | string | Uint8Array,
  fileName: string,
  binding?: OutputFileBinding,
): Promise<OutputFileResult | null> => {
  const config = await preloadOutputConfiguration()
  if (!config) return null
  const headers: Record<string, string> = { 'X-SlideStudio-Token': config.token }
  if (binding) {
    headers['X-SlideStudio-File-Key'] = binding.fileKey
    headers['X-SlideStudio-Revision'] = binding.revision
  }
  const body = data instanceof Uint8Array ? new Blob([new Uint8Array(data).buffer]) : data
  const response = await fetch(`/api/local/files?name=${encodeURIComponent(binding?.fileName || fileName)}`, {
    method: 'POST', headers, body,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || '保存失败，请确认本地服务与输出文件夹可用。')
  if (![result.fileName, result.path, result.fileKey, result.revision].every(value => typeof value === 'string' && value)) {
    throw new Error('本地服务未确认保存结果，请检查输出目录后重试。')
  }
  return { ...result, method: 'server' }
}

export const saveOutputFile = (data: Blob | string | Uint8Array, fileName: string, binding?: OutputFileBinding) =>
  writeOutput(data, fileName, binding)
