import { searchRuntimeFiles } from '@/runtime/files/search/runtime-file-search-client'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import { isInsideProject, normalizeProjectPath } from './monaco-ts-project-protocol'

export class ReferenceCandidates {
  readonly names = new Set<string>()
  readonly paths: Set<string>
  private fullProject = false

  constructor(
    private readonly context: RuntimeFileOperationArgs,
    private readonly root: string,
    buffers: string[],
    private readonly cache: Map<string, string[]>
  ) {
    this.paths = new Set(buffers)
  }

  get request(): { referenceFileNames?: string[]; referenceNames?: string[] } {
    return this.fullProject
      ? {}
      : { referenceFileNames: [...this.paths], referenceNames: [...this.names] }
  }

  async expand(names: string[]): Promise<boolean> {
    let changed = false
    for (const name of names) {
      if (!name || this.names.has(name) || this.fullProject) {
        continue
      }
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const query =
        this.names.size === 0 ? `${escaped}|\\\\u(?:[0-9a-fA-F]{4}|\\{[0-9a-fA-F]+\\})` : escaped
      this.names.add(name)
      changed = true
      try {
        let paths = this.cache.get(query)
        if (!paths) {
          const result = await searchRuntimeFiles(this.context, {
            rootPath: this.root,
            query,
            caseSensitive: true,
            useRegex: true,
            includePattern: '*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
            maxResults: 100_000
          })
          if (result.truncated) {
            this.fullProject = true
            return true
          }
          paths = result.files
            .map(({ filePath }) => normalizeProjectPath(filePath))
            .filter((path) => isInsideProject(this.root, path))
          this.cache.set(query, paths)
        }
        paths.forEach((path) => this.paths.add(path))
      } catch {
        this.fullProject = true
      }
    }
    return changed
  }
}
