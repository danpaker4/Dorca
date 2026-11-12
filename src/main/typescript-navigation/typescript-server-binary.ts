import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../shared/app-environment'
import {
  TYPESCRIPT_LANGUAGE_SERVER_DIRECTORY,
  typeScriptLanguageServerBinary
} from '../../shared/orcad-artifacts'

export async function resolveTypeScriptServerBinary(): Promise<string | null> {
  const name = typeScriptLanguageServerBinary(process.platform)
  const app = hasAppEnvironment() ? getAppEnvironment() : null
  const candidates = [
    ...(process.resourcesPath
      ? [join(process.resourcesPath, TYPESCRIPT_LANGUAGE_SERVER_DIRECTORY, name)]
      : []),
    ...(app ? [join(app.getAppPath(), TYPESCRIPT_LANGUAGE_SERVER_DIRECTORY, name)] : [])
  ]
  if (!app?.isPackaged()) {
    try {
      const require = createRequire(__filename)
      const compiler = require.resolve('typescript/package.json')
      const platformPackage = createRequire(compiler).resolve(
        `@typescript/typescript-${process.platform}-${process.arch}/package.json`
      )
      candidates.push(join(dirname(platformPackage), 'lib', name))
    } catch {
      /* Development installs may omit their optional compiler binary. */
    }
  }
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      continue
    }
  }
  return null
}
