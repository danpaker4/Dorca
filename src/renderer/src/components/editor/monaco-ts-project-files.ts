import { typescript as ts } from 'monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js'
import { resolveRuntimePath } from '../../../../shared/cross-platform-path'
import type { ParsedCommandLine, ParseConfigHost } from 'typescript-api'
import {
  isInsideProject,
  normalizeProjectPath,
  type TypeScriptProjectQuery
} from './monaco-ts-project-protocol'

export class ProjectFiles {
  readonly missing = new Set<string>()
  readonly root: string
  readonly names: string[]
  private readonly knownNames: Set<string>
  private readonly directories = new Map<string, { files: Set<string>; directories: Set<string> }>()
  private readonly contents = new Map<string, string | null>()

  constructor(readonly request: TypeScriptProjectQuery) {
    this.root = normalizeProjectPath(request.rootPath)
    this.names = request.fileNames.map(normalizeProjectPath)
    this.knownNames = new Set(this.names)
    for (const name of this.names) {
      let path = name
      let isFile = true
      while (isInsideProject(this.root, path) && path !== this.root) {
        const parent = normalizeProjectPath(resolveRuntimePath(path, '..'))
        if (parent === path) {
          break
        }
        const entry = this.directories.get(parent) ?? {
          files: new Set<string>(),
          directories: new Set<string>()
        }
        entry[isFile ? 'files' : 'directories'].add(
          path.slice(parent.length + (parent.endsWith('/') ? 0 : 1))
        )
        this.directories.set(parent, entry)
        path = parent
        isFile = false
      }
    }
    for (const [name, content] of Object.entries(request.files)) {
      this.contents.set(normalizeProjectPath(name), content)
    }
  }

  readFile = (name: string): string | undefined => {
    const path = normalizeProjectPath(name)
    if (!isInsideProject(this.root, path)) {
      return undefined
    }
    if (!this.contents.has(path)) {
      this.missing.add(path)
    }
    return this.contents.get(path) ?? undefined
  }

  fileExists = (name: string): boolean => {
    const path = normalizeProjectPath(name)
    if (!isInsideProject(this.root, path)) {
      return false
    }
    if (this.contents.has(path)) {
      return this.contents.get(path) !== null
    }
    if (this.knownNames.has(path)) {
      return true
    }
    this.missing.add(path)
    return false
  }

  readDirectory: ParseConfigHost['readDirectory'] = (path, extensions, excludes, includes, depth) =>
    ts.matchFiles(
      path,
      extensions,
      excludes,
      includes,
      true,
      this.root,
      depth,
      (directory) => {
        const entry = this.directories.get(normalizeProjectPath(directory))
        return { files: [...(entry?.files ?? [])], directories: [...(entry?.directories ?? [])] }
      },
      normalizeProjectPath
    )

  project(): ParsedCommandLine | undefined {
    let directory = normalizeProjectPath(resolveRuntimePath(this.request.filePath, '..'))
    while (isInsideProject(this.root, directory)) {
      for (const name of ['tsconfig.json', 'jsconfig.json']) {
        const config = resolveRuntimePath(directory, name)
        if (this.fileExists(config)) {
          return this.readProject(config, new Set())
        }
      }
      const parent = normalizeProjectPath(resolveRuntimePath(directory, '..'))
      if (parent === directory) {
        break
      }
      directory = parent
    }
    return undefined
  }

  private readProject(config: string, seen: Set<string>): ParsedCommandLine | undefined {
    if (seen.has(config)) {
      return undefined
    }
    seen.add(config)
    const input = ts.readConfigFile(config, this.readFile)
    if (input.error) {
      return undefined
    }
    const project = ts.parseJsonConfigFileContent(
      input.config,
      {
        useCaseSensitiveFileNames: true,
        readDirectory: this.readDirectory,
        readFile: this.readFile,
        fileExists: this.fileExists
      },
      resolveRuntimePath(config, '..'),
      undefined,
      config
    )
    const source = normalizeProjectPath(this.request.filePath)
    if (project.fileNames.some((name) => normalizeProjectPath(name) === source)) {
      return project
    }
    for (const reference of project.projectReferences ?? []) {
      const path = ts.resolveProjectReferencePath(reference)
      if (!isInsideProject(this.root, normalizeProjectPath(path))) {
        continue
      }
      const child = this.readProject(path, seen)
      if (child?.fileNames.some((name) => normalizeProjectPath(name) === source)) {
        return child
      }
    }
    return project
  }
}
