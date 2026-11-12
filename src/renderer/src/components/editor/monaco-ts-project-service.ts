import { ProjectFiles } from './monaco-ts-project-files'
import { typescript as ts } from 'monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js'
import { TypeScriptWorker } from 'monaco-editor/esm/vs/language/typescript/tsWorker.js'
import {
  isCaseInsensitiveRuntimeRoot,
  resolveRuntimePath
} from '../../../../shared/cross-platform-path'
import type { CompilerOptions, IScriptSnapshot, ScriptKind, LanguageService } from 'typescript-api'
import {
  isInsideProject,
  normalizeProjectPath,
  type TypeScriptProjectQuery,
  type TypeScriptProjectResult
} from './monaco-ts-project-protocol'

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/i

function createProjectService(
  files: ProjectFiles,
  roots: string[],
  options: CompilerOptions
): LanguageService {
  class ProjectLanguageService extends TypeScriptWorker {
    constructor() {
      super(
        { getMirrorModels: () => [] },
        {
          compilerOptions: options,
          extraLibs: {},
          inlayHintsOptions: {}
        }
      )
    }

    getCurrentDirectory(): string {
      return files.root
    }
    useCaseSensitiveFileNames(): boolean {
      return !isCaseInsensitiveRuntimeRoot(files.root)
    }
    getScriptFileNames(): string[] {
      return roots
    }
    getScriptVersion(): string {
      return '1'
    }
    readFile(name: string): string | undefined {
      return super.readFile(name) ?? files.readFile(name)
    }
    fileExists(name: string): boolean {
      return super.readFile(name) !== undefined || files.fileExists(name)
    }
    getScriptSnapshot(name: string): IScriptSnapshot | undefined {
      const content = this.readFile(name)
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
    }
    getScriptKind(name: string): ScriptKind {
      if (/\.tsx$/i.test(name)) {
        return ts.ScriptKind.TSX
      }
      if (/\.jsx$/i.test(name)) {
        return ts.ScriptKind.JSX
      }
      if (/\.json$/i.test(name)) {
        return ts.ScriptKind.JSON
      }
      return /\.[cm]?js$/i.test(name) ? ts.ScriptKind.JS : ts.ScriptKind.TS
    }
  }
  return new ProjectLanguageService().getLanguageService()
}

type ProjectServiceCache = { request?: TypeScriptProjectQuery; service?: LanguageService }

export function createTypeScriptProjectQuery(): typeof queryTypeScriptProject {
  const cache: ProjectServiceCache = {}
  return (request) => queryTypeScriptProject(request, cache)
}

function isSameProject(a: TypeScriptProjectQuery, b: TypeScriptProjectQuery): boolean {
  return (
    a.rootPath === b.rootPath &&
    a.filePath === b.filePath &&
    a.kind === b.kind &&
    a.fileNames.length === b.fileNames.length &&
    a.fileNames.every((name, index) => name === b.fileNames[index]) &&
    Object.keys(a.files).length === Object.keys(b.files).length &&
    Object.entries(a.files).every(([name, content]) => b.files[name] === content)
  )
}

export function queryTypeScriptProject(
  request: TypeScriptProjectQuery,
  cache?: ProjectServiceCache
): TypeScriptProjectResult {
  if (cache?.request && cache.service && isSameProject(cache.request, request)) {
    return queryProjectLocations(request, cache.service, normalizeProjectPath(request.rootPath), [])
  }
  cache?.service?.dispose()
  if (cache) {
    cache.service = undefined
    cache.request = undefined
  }
  const files = new ProjectFiles(request)
  const project = files.project()
  if (files.missing.size > 0) {
    return { missingFiles: [...files.missing], locations: [] }
  }
  const filePath = normalizeProjectPath(request.filePath)
  const roots =
    request.kind === 'definition'
      ? [filePath]
      : [
          ...new Set([
            ...(project?.fileNames ??
              files.names.filter(
                (name) => SOURCE_FILE.test(name) && !name.includes('/node_modules/')
              )),
            filePath
          ])
        ]
  const options: CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    ...(!project ? { moduleDetection: ts.ModuleDetectionKind.Force } : {}),
    ...project?.options
  }
  // Discover unloaded imports before paying to build and type-check a program.
  const visited = new Set<string>()
  const pending = [...roots]
  const knownNames = new Set(files.names)
  while (pending.length > 0) {
    const name = pending.pop()!
    if (visited.has(name)) {
      continue
    }
    visited.add(name)
    const content = files.readFile(name)
    if (content === undefined) {
      continue
    }
    const info = ts.preProcessFile(content, true, true)
    for (const imported of info.importedFiles) {
      const resolved = ts.resolveModuleName(imported.fileName, name, options, files).resolvedModule
      if (resolved) {
        pending.push(resolved.resolvedFileName)
      }
    }
    for (const reference of info.referencedFiles) {
      pending.push(
        normalizeProjectPath(resolveRuntimePath(resolveRuntimePath(name, '..'), reference.fileName))
      )
    }
  }
  if ([...files.missing].some((name) => knownNames.has(name))) {
    return { missingFiles: [...files.missing], locations: [] }
  }
  const service = createProjectService(files, roots, options)
  try {
    const result = queryProjectLocations(request, service, files.root, [])
    result.missingFiles = [...files.missing]
    if (cache && files.missing.size === 0) {
      cache.service = service
      cache.request = request
    }
    return result
  } finally {
    if (cache?.service !== service) {
      service.dispose()
    }
  }
}

function queryProjectLocations(
  request: TypeScriptProjectQuery,
  service: LanguageService,
  root: string,
  missingFiles: string[]
): TypeScriptProjectResult {
  const filePath = normalizeProjectPath(request.filePath)
  const entries =
    request.kind === 'definition'
      ? (service.getDefinitionAtPosition(filePath, request.offset) ?? []).filter(
          (entry) => entry.kind !== ts.ScriptElementKind.alias
        )
      : (service.findReferences(filePath, request.offset) ?? []).flatMap((group) =>
          group.references.filter((entry) => request.includeDeclaration || !entry.isDefinition)
        )
  const program = service.getProgram()
  const locations: TypeScriptProjectResult['locations'] = []
  for (const entry of entries) {
    if (!isInsideProject(root, normalizeProjectPath(entry.fileName))) {
      continue
    }
    const source = program?.getSourceFile(entry.fileName)
    if (!source) {
      continue
    }
    const start = source.getLineAndCharacterOfPosition(entry.textSpan.start)
    const end = source.getLineAndCharacterOfPosition(entry.textSpan.start + entry.textSpan.length)
    locations.push({
      filePath: entry.fileName,
      range: {
        startLineNumber: start.line + 1,
        startColumn: start.character + 1,
        endLineNumber: end.line + 1,
        endColumn: end.character + 1
      }
    })
  }
  return { missingFiles, locations }
}
