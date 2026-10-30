/* eslint-env node */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveLocalFileDirectories } from '../local-files.mjs'

const configurationKeys = ['repositoryPath', 'nodePath', 'localURL', 'defaultOutputDirectory']

export function launcherConfiguration({ repositoryPath, nodePath, previous, home = os.homedir(), exists = fs.existsSync }) {
  const configuration = previous ? Object.fromEntries(configurationKeys.map(key => [key, previous[key]])) : {
    repositoryPath,
    nodePath,
    localURL: 'http://127.0.0.1:4178',
    defaultOutputDirectory: resolveLocalFileDirectories({ home, env: {}, exists }).outputDirectory,
  }
  for (const key of ['repositoryPath', 'nodePath', 'defaultOutputDirectory']) {
    if (typeof configuration[key] !== 'string' || !path.isAbsolute(configuration[key])) {
      throw new Error(`启动配置中的 ${key} 必须是完整路径；未修改原应用。`)
    }
  }
  if (configuration.localURL !== 'http://127.0.0.1:4178') {
    throw new Error('本地地址配置无效；未修改原应用。')
  }
  return configuration
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [repositoryPath, nodePath, output, configurationFile] = process.argv.slice(2)
  const previous = configurationFile ? JSON.parse(fs.readFileSync(configurationFile, 'utf8')) : undefined
  fs.writeFileSync(output, `${JSON.stringify(launcherConfiguration({ repositoryPath, nodePath, previous }), null, 2)}\n`, { mode: 0o600 })
}
