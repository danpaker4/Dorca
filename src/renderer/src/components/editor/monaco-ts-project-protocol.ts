import type { languages } from 'monaco-editor'
import {
  isCaseInsensitiveRuntimeRoot,
  isPathInsideOrEqual,
  resolveRuntimePath
} from '../../../../shared/cross-platform-path'

export type TypeScriptProjectQuery = {
  rootPath: string
  filePath: string
  offset: number
  kind: 'definition' | 'references'
  includeDeclaration: boolean
  fileNames: string[]
  files: Record<string, string | null>
  referenceFileNames?: string[]
  referenceNames?: string[]
}

export type TypeScriptProjectResult = {
  missingFiles: string[]
  missingPaths: string[]
  referenceNames: string[]
  locations: { filePath: string; range: languages.Location['range'] }[]
}

export type TypeScriptProjectWorker = {
  query(request: TypeScriptProjectQuery): Promise<TypeScriptProjectResult>
}

export function normalizeProjectPath(path: string): string {
  const normalized = resolveRuntimePath(path, '.')
  return isCaseInsensitiveRuntimeRoot(normalized) ? normalized.toLowerCase() : normalized
}

export function isInsideProject(root: string, path: string): boolean {
  return isPathInsideOrEqual(root, path)
}
