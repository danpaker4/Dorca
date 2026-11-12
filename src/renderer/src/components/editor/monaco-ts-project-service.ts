import { queryProjectLocations } from './monaco-ts-project-locations'
import { createProjectService } from './monaco-ts-language-service'
import { ProjectFiles } from './monaco-ts-project-files'
import { typescript as ts } from 'monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js'
import { resolveRuntimePath } from '../../../../shared/cross-platform-path'
import type {
  CompilerOptions,
  LanguageService,
  PreProcessedFileInfo,
  ResolvedModuleFull
} from 'typescript-api'
import {
  normalizeProjectPath,
  type TypeScriptProjectQuery,
  type TypeScriptProjectResult
} from './monaco-ts-project-protocol'

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/i

type ProjectServiceCache = {
  request?: TypeScriptProjectQuery
  service?: LanguageService
  inventory?: ProjectFiles
  imports: Map<string, { content: string; info: PreProcessedFileInfo }>
  resolutions: Map<string, ResolvedModuleFull | undefined>
  optionsKey?: string
}

export function createTypeScriptProjectQuery(): typeof queryTypeScriptProject {
  const cache: ProjectServiceCache = { imports: new Map(), resolutions: new Map() }
  return (request) => queryTypeScriptProject(request, cache)
}

function isSameProject(a: TypeScriptProjectQuery, b: TypeScriptProjectQuery): boolean {
  return (
    a.rootPath === b.rootPath &&
    a.filePath === b.filePath &&
    a.kind === b.kind &&
    JSON.stringify(a.referenceFileNames) === JSON.stringify(b.referenceFileNames) &&
    JSON.stringify(a.referenceNames) === JSON.stringify(b.referenceNames) &&
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
  const files = new ProjectFiles(request, cache?.inventory)
  if (cache) {
    if (
      cache.inventory &&
      (cache.inventory.root !== files.root ||
        Object.entries(cache.inventory.request.files).some(
          ([name, content]) => request.files[name] !== content
        ))
    ) {
      cache.resolutions.clear()
      cache.imports.clear()
    }
    cache.inventory = files
  }
  const project = files.project()
  if (files.missing.size > 0 || files.missingPaths.size > 0) {
    return {
      missingFiles: [...files.missing],
      missingPaths: [...files.missingPaths],
      referenceNames: [],
      locations: []
    }
  }
  const filePath = normalizeProjectPath(request.filePath)
  const source = files.readFile(filePath) ?? ''
  const ambientScript =
    project &&
    project.options.moduleDetection !== ts.ModuleDetectionKind.Force &&
    !/\.[cm][jt]s$/i.test(filePath) &&
    !ts.isExternalModule(ts.createSourceFile(filePath, source, ts.ScriptTarget.ESNext))
  const candidatePaths =
    request.referenceFileNames && !ambientScript
      ? new Set(request.referenceFileNames.map(normalizeProjectPath))
      : undefined
  const roots =
    request.kind === 'definition'
      ? [filePath]
      : [
          ...new Set([
            ...(
              project?.fileNames ??
              files.names.filter(
                (name) => SOURCE_FILE.test(name) && !name.includes('/node_modules/')
              )
            ).filter((name) => {
              if (!candidatePaths) {
                return true
              }
              if (/\.d\.[cm]?ts$/i.test(name)) {
                return true
              }
              if (!candidatePaths.has(normalizeProjectPath(name))) {
                return false
              }
              const content = files.readFile(name)
              return (
                content === undefined ||
                containsReferenceName(content, request.referenceNames ?? [])
              )
            }),
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
  if (cache && cache.optionsKey !== JSON.stringify(options)) {
    cache.resolutions.clear()
    cache.optionsKey = JSON.stringify(options)
  }
  // Discover unloaded imports before paying to build and type-check a program.
  const visited = new Set<string>()
  const pending = [...roots]
  for (const type of options.types ?? []) {
    const resolved = ts.resolveTypeReferenceDirective(
      type,
      filePath,
      options,
      files
    ).resolvedTypeReferenceDirective
    if (resolved?.resolvedFileName) {
      pending.push(resolved.resolvedFileName)
    }
  }
  const resolutions = new Map<string, ResolvedModuleFull | undefined>()
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
    const previous = cache?.imports.get(name)
    const info =
      previous?.content === content ? previous.info : ts.preProcessFile(content, true, true)
    cache?.imports.set(name, { content, info })
    const directory = resolveRuntimePath(name, '..')
    for (const imported of info.importedFiles) {
      const key = `${directory}\0${imported.fileName}`
      const unresolved = files.unresolvedAccesses
      let resolved = cache?.resolutions.get(key)
      if (!cache?.resolutions.has(key)) {
        if (resolutions.has(key)) {
          resolved = resolutions.get(key)
        } else {
          resolved = ts.resolveModuleName(imported.fileName, name, options, files).resolvedModule
          resolutions.set(key, resolved)
          if (files.unresolvedAccesses === unresolved) {
            cache?.resolutions.set(key, resolved)
          }
        }
      }
      if (
        resolved &&
        !(
          resolved.isExternalLibraryImport &&
          /\.[cm]?jsx?$/i.test(resolved.resolvedFileName) &&
          (options.maxNodeModuleJsDepth ?? 0) === 0
        )
      ) {
        pending.push(resolved.resolvedFileName)
      }
    }
    for (const reference of info.referencedFiles) {
      pending.push(
        normalizeProjectPath(resolveRuntimePath(resolveRuntimePath(name, '..'), reference.fileName))
      )
    }
    for (const reference of info.typeReferenceDirectives) {
      const resolved = ts.resolveTypeReferenceDirective(
        reference.fileName,
        name,
        options,
        files
      ).resolvedTypeReferenceDirective
      if (resolved?.resolvedFileName) {
        pending.push(resolved.resolvedFileName)
      }
    }
  }
  if (request.kind === 'references' && (files.missing.size > 0 || files.missingPaths.size > 0)) {
    return {
      missingFiles: [...files.missing],
      missingPaths: [...files.missingPaths],
      referenceNames: [],
      locations: []
    }
  }
  const service = createProjectService(files, roots, options)
  try {
    const result = queryProjectLocations(request, service, files.root, [])
    result.missingFiles = [...files.missing]
    result.missingPaths = [...files.missingPaths]
    if (cache && files.missing.size === 0 && files.missingPaths.size === 0) {
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

function containsReferenceName(content: string, names: string[]): boolean {
  if (names.some((name) => content.includes(name))) {
    return true
  }
  const candidates = new Set(names)
  const scanner = ts.createScanner(
    ts.ScriptTarget.ESNext,
    true,
    ts.LanguageVariant.Standard,
    content
  )
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    if (candidates.has(scanner.getTokenValue())) {
      return true
    }
  }
  return false
}
