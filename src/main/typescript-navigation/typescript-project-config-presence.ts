import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'

export async function hasTypeScriptProjectConfig(root: string, file: string): Promise<boolean> {
  let directory = dirname(file)
  while (isPathInsideOrEqual(root, directory)) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      try {
        await access(join(directory, name))
        return true
      } catch {
        continue
      }
    }
    const parent = dirname(directory)
    if (parent === directory) {
      break
    }
    directory = parent
  }
  return false
}
