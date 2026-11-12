import { relative, resolve } from 'node:path'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import type {
  TypeScriptNavigationRequest,
  TypeScriptNavigationResult
} from '../../shared/editor-language/typescript-navigation'

export async function authorizeTypeScriptNavigation(
  request: TypeScriptNavigationRequest,
  authorize: (path: string) => Promise<string>
): Promise<TypeScriptNavigationRequest> {
  const rootPath = await authorize(request.rootPath)
  const translate = (filePath: string): string => {
    if (!isPathInsideOrEqual(request.rootPath, filePath)) {
      throw new Error('TypeScript file is outside its owning workspace')
    }
    return resolve(rootPath, relative(request.rootPath, filePath))
  }
  return {
    ...request,
    rootPath,
    filePath: translate(request.filePath),
    buffers: request.buffers.map((buffer) => ({ ...buffer, filePath: translate(buffer.filePath) }))
  }
}

export function restoreTypeScriptNavigationPaths(
  result: TypeScriptNavigationResult,
  root: string,
  originalRoot: string
): TypeScriptNavigationResult {
  return {
    ...result,
    locations: result.locations.map((entry) => ({
      ...entry,
      filePath: resolve(originalRoot, relative(root, entry.filePath))
    }))
  }
}
