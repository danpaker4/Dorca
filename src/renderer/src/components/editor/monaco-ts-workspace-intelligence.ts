import type * as Monaco from 'monaco-editor'
import type { editor, IPosition, IRange } from 'monaco-editor'
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { getOpenedEditFileIdAfterOpen } from '@/store/slices/editor/file-ids/editor-file-ids'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'
import { detectLanguage } from '@/lib/language-detect'
import { getConnectionId } from '@/lib/connection-context'
import {
  recordExplicitEditorJump,
  registerEditorForNavigationHistory
} from '@/lib/workspace-navigation-history'
import type { SearchFileResult } from '../../../../shared/code-search-types'
import { toEditorModelUri } from './editor-model-uri'

type ModelWorkspaceContext = {
  filePath: string
  relativePath: string
  worktreeId: string
  worktreePath: string
  modelOwnerKey?: string
  runtimeEnvironmentId?: string | null
  connectionId?: string
}

const modelContextByUri = new Map<string, ModelWorkspaceContext>()
const hydratedFileStamps = new Map<string, number>()
const searchCache = new Map<string, { timestamp: number; files: SearchFileResult[] }>()
const inFlightSearches = new Map<string, Promise<SearchFileResult[]>>()
const resolvedImportPathCache = new Map<string, { timestamp: number; filePath: string | null }>()

const TS_JS_SEARCH_INCLUDE = '*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'
const MAX_HYDRATED_FILES_PER_QUERY = 25
const HYDRATION_CACHE_TTL_MS = 15_000
const SEARCH_CACHE_TTL_MS = 5_000
const IMPORT_PATH_CACHE_TTL_MS = 15_000

const RESOLVABLE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.d.ts',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
  '.json'
]

function isTsOrJsLanguageId(langId: string): boolean {
  return (
    langId === 'typescript' ||
    langId === 'javascript' ||
    langId === 'typescriptreact' ||
    langId === 'javascriptreact'
  )
}

function toMonacoTsLanguageId(filePath: string): 'typescript' | 'javascript' {
  const lower = filePath.toLowerCase()
  if (
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.mjs') ||
    lower.endsWith('.cjs')
  ) {
    return 'javascript'
  }
  return 'typescript'
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/')
}

function computeRelativePath(worktreePath: string, filePath: string): string {
  const normRoot = normalizeSlashes(worktreePath).replace(/\/+$/, '')
  const normFile = normalizeSlashes(filePath)
  if (normFile.toLowerCase().startsWith(normRoot.toLowerCase() + '/')) {
    return normFile.slice(normRoot.length + 1)
  }
  return filePath
}

function resolveModelContext(modelUriStr: string): ModelWorkspaceContext | null {
  const existing = modelContextByUri.get(modelUriStr)
  if (existing) {
    return existing
  }
  const state = useAppStore.getState()
  const worktreesByRepo = selectWorktreesByRepo(state)
  for (const openFile of state.openFiles ?? []) {
    const worktree = findWorktreeById(worktreesByRepo, openFile.worktreeId)
    if (!worktree) {
      continue
    }
    const candidateUri = toEditorModelUri(openFile.filePath, '')
    const parsedUri = URI.parse(modelUriStr)
    if (
      candidateUri === modelUriStr ||
      normalizeSlashes(openFile.filePath).toLowerCase() ===
        normalizeSlashes(URI.file(parsedUri.path).fsPath).toLowerCase()
    ) {
      const ctx: ModelWorkspaceContext = {
        filePath: openFile.filePath,
        relativePath:
          openFile.relativePath || computeRelativePath(worktree.path, openFile.filePath),
        worktreeId: openFile.worktreeId,
        worktreePath: worktree.path,
        modelOwnerKey: '',
        runtimeEnvironmentId: openFile.runtimeEnvironmentId,
        connectionId: getConnectionId(openFile.worktreeId) ?? undefined
      }
      modelContextByUri.set(modelUriStr, ctx)
      return ctx
    }
  }
  return null
}

function registerTargetUriContext(
  parentCtx: ModelWorkspaceContext,
  candidateFilePath: string
): string {
  const targetUriStr = toEditorModelUri(candidateFilePath, parentCtx.modelOwnerKey)
  if (!modelContextByUri.has(targetUriStr)) {
    modelContextByUri.set(targetUriStr, {
      filePath: candidateFilePath,
      relativePath: computeRelativePath(parentCtx.worktreePath, candidateFilePath),
      worktreeId: parentCtx.worktreeId,
      worktreePath: parentCtx.worktreePath,
      modelOwnerKey: parentCtx.modelOwnerKey,
      runtimeEnvironmentId: parentCtx.runtimeEnvironmentId,
      connectionId: parentCtx.connectionId
    })
  }
  return targetUriStr
}

async function ensureCandidateFileModel(
  monaco: typeof Monaco,
  parentCtx: ModelWorkspaceContext,
  candidateFilePath: string
): Promise<Monaco.editor.ITextModel | null> {
  const targetUriStr = registerTargetUriContext(parentCtx, candidateFilePath)
  const targetUri = monaco.Uri.parse(targetUriStr)
  const existingModel = monaco.editor.getModel(targetUri)
  const now = Date.now()
  const lastHydrated = hydratedFileStamps.get(targetUriStr) ?? 0

  if (existingModel && now - lastHydrated < HYDRATION_CACHE_TTL_MS) {
    return existingModel
  }

  const state = useAppStore.getState()
  const isOpenInTab = state.openFiles?.some(
    (f) =>
      f.worktreeId === parentCtx.worktreeId &&
      normalizeSlashes(f.filePath).toLowerCase() === normalizeSlashes(candidateFilePath).toLowerCase()
  )
  if (existingModel && isOpenInTab) {
    hydratedFileStamps.set(targetUriStr, now)
    return existingModel
  }

  try {
    const fileRes = await window.api.fs.readFile({
      filePath: candidateFilePath,
      connectionId: parentCtx.connectionId
    })
    if (fileRes.isBinary || typeof fileRes.content !== 'string') {
      return existingModel
    }
    hydratedFileStamps.set(targetUriStr, now)
    const rechecked = monaco.editor.getModel(targetUri)
    if (rechecked) {
      if (!isOpenInTab && rechecked.getValue() !== fileRes.content) {
        rechecked.setValue(fileRes.content)
      }
      return rechecked
    }
    return monaco.editor.createModel(
      fileRes.content,
      toMonacoTsLanguageId(candidateFilePath),
      targetUri
    )
  } catch {
    return existingModel
  }
}

async function searchWorkspaceForWord(
  ctx: ModelWorkspaceContext,
  word: string
): Promise<SearchFileResult[]> {
  const key = `${ctx.worktreePath}::${word}`
  const now = Date.now()
  const cached = searchCache.get(key)
  if (cached && now - cached.timestamp < SEARCH_CACHE_TTL_MS) {
    return cached.files
  }

  const existingInFlight = inFlightSearches.get(key)
  if (existingInFlight) {
    return existingInFlight
  }

  const promise = (async (): Promise<SearchFileResult[]> => {
    try {
      const searchRes = await window.api.fs.search({
        query: word,
        rootPath: ctx.worktreePath,
        caseSensitive: true,
        wholeWord: true,
        includePattern: TS_JS_SEARCH_INCLUDE,
        maxResults: 200,
        connectionId: ctx.connectionId
      })
      const files = searchRes.files ?? []
      searchCache.set(key, { timestamp: Date.now(), files })
      return files
    } catch {
      return []
    } finally {
      inFlightSearches.delete(key)
    }
  })()

  inFlightSearches.set(key, promise)
  return promise
}

function isCommentLine(lineContent: string): boolean {
  const trimmed = lineContent.trim()
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('*/')
  )
}

function isExportedDeclarationLine(lineContent: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const exportDeclRegex = new RegExp(
    `\\bexport\\s+(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:function\\*?\\s+|const\\s+|let\\s+|var\\s+|class\\s+|interface\\s+|type\\s+|enum\\s+)(${escaped})\\b`
  )
  return exportDeclRegex.test(lineContent)
}

function dirnameOf(filePath: string): string {
  const useBackslash = filePath.includes('\\')
  const norm = normalizeSlashes(filePath).replace(/\/+$/, '')
  const idx = norm.lastIndexOf('/')
  if (idx < 0) {
    return filePath
  }
  const dir = norm.slice(0, idx)
  return useBackslash ? dir.replace(/\//g, '\\') : dir
}

function joinAndNormalizePath(baseDir: string, relativeSpecifier: string): string {
  const useBackslash = baseDir.includes('\\')
  const normBase = normalizeSlashes(baseDir).replace(/\/+$/, '')
  let prefix = ''
  let restBase = normBase
  if (restBase.startsWith('//')) {
    prefix = '//'
    restBase = restBase.slice(2)
  } else if (restBase.startsWith('/')) {
    prefix = '/'
    restBase = restBase.slice(1)
  } else if (/^[A-Za-z]:/.test(restBase)) {
    prefix = restBase.slice(0, 2) + '/'
    restBase = restBase.slice(2).replace(/^\/+/, '')
  }

  const combined = `${restBase}/${normalizeSlashes(relativeSpecifier)}`.split('/')
  const stack: string[] = []
  for (const segment of combined) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  const result = prefix + stack.join('/')
  return useBackslash ? result.replace(/\//g, '\\') : result
}

function findNearestSrcAncestor(filePath: string): string | null {
  const useBackslash = filePath.includes('\\')
  const norm = normalizeSlashes(filePath)
  const match = /^(.*\/src)(?:\/|$)/i.exec(norm)
  if (!match) {
    return null
  }
  return useBackslash ? match[1].replace(/\//g, '\\') : match[1]
}

function buildImportCandidateFilePaths(basePath: string): string[] {
  const sep = basePath.includes('\\') ? '\\' : '/'
  const candidates: string[] = []

  const extMatch = /\.(tsx?|jsx?|d\.ts|mts|cts|mjs|cjs|json|css|scss|less|svg|md)$/i.exec(basePath)
  if (extMatch) {
    if (/\.(m|c)?jsx?$/i.test(extMatch[0])) {
      const stem = basePath.slice(0, -extMatch[0].length)
      candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`, `${stem}.mts`, `${stem}.cts`)
    }
    candidates.push(basePath)
    return candidates
  }

  for (const ext of RESOLVABLE_EXTENSIONS) {
    candidates.push(`${basePath}${ext}`)
  }
  for (const ext of RESOLVABLE_EXTENSIONS) {
    candidates.push(`${basePath}${sep}index${ext}`)
  }
  return candidates
}

async function resolveImportSpecifierToFilePath(
  ctx: ModelWorkspaceContext,
  specifier: string
): Promise<string | null> {
  const trimmed = specifier.trim()
  if (!trimmed || trimmed.startsWith('node:') || /^[a-z]+:\/\//i.test(trimmed)) {
    return null
  }

  const cacheKey = `${ctx.filePath}::${trimmed}`
  const now = Date.now()
  const cached = resolvedImportPathCache.get(cacheKey)
  if (cached && now - cached.timestamp < IMPORT_PATH_CACHE_TTL_MS) {
    return cached.filePath
  }

  const baseDirsToTry: string[] = []
  if (trimmed.startsWith('.')) {
    baseDirsToTry.push(joinAndNormalizePath(dirnameOf(ctx.filePath), trimmed))
  } else if (trimmed.startsWith('@/') || trimmed.startsWith('~/')) {
    const subPath = trimmed.slice(2)
    const nearestSrc = findNearestSrcAncestor(ctx.filePath)
    if (nearestSrc) {
      baseDirsToTry.push(joinAndNormalizePath(nearestSrc, subPath))
    }
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, `src/${subPath}`))
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, `src/renderer/src/${subPath}`))
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, subPath))
  } else {
    const nearestSrc = findNearestSrcAncestor(ctx.filePath)
    if (nearestSrc) {
      baseDirsToTry.push(joinAndNormalizePath(nearestSrc, trimmed))
    }
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, trimmed))
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, `src/${trimmed}`))
    baseDirsToTry.push(joinAndNormalizePath(ctx.worktreePath, `packages/${trimmed}`))
  }

  const seenCandidates = new Set<string>()
  const candidatePaths: string[] = []
  for (const base of baseDirsToTry) {
    for (const candidate of buildImportCandidateFilePaths(base)) {
      if (!seenCandidates.has(candidate) && candidatePaths.length < 120) {
        seenCandidates.add(candidate)
        candidatePaths.push(candidate)
      }
    }
  }

  if (candidatePaths.length === 0) {
    resolvedImportPathCache.set(cacheKey, { timestamp: now, filePath: null })
    return null
  }

  try {
    if (typeof window.api?.fs?.pathsExist === 'function') {
      const results = await window.api.fs.pathsExist({
        filePaths: candidatePaths,
        connectionId: ctx.connectionId
      })
      for (let i = 0; i < results.length; i++) {
        const item = results[i]
        if (item && 'exists' in item && item.exists) {
          const found = candidatePaths[i]
          resolvedImportPathCache.set(cacheKey, { timestamp: Date.now(), filePath: found })
          return found
        }
      }
    } else if (typeof window.api?.fs?.pathExists === 'function') {
      const checks = await Promise.all(
        candidatePaths.map((filePath) =>
          window.api.fs
            .pathExists({ filePath, connectionId: ctx.connectionId })
            .catch(() => false)
        )
      )
      const idx = checks.findIndex(Boolean)
      if (idx >= 0) {
        const found = candidatePaths[idx]
        resolvedImportPathCache.set(cacheKey, { timestamp: Date.now(), filePath: found })
        return found
      }
    }
  } catch {
    // Fall through on error
  }

  resolvedImportPathCache.set(cacheKey, { timestamp: Date.now(), filePath: null })
  return null
}

type ModuleSpecifierMatch = {
  specifier: string
  startColumn: number
  endColumn: number
}

function extractModuleSpecifierAtPosition(
  lineContent: string,
  column: number
): ModuleSpecifierMatch | null {
  const patterns = [
    /\b(?:from|import)\s+(['"])([^'"]+)\1/g,
    /\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g
  ]
  for (const regex of patterns) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(lineContent)) !== null) {
      const fullMatch = match[0]
      const quote = match[1]
      const specifier = match[2]
      const quoteStartIdx = match.index + fullMatch.indexOf(quote)
      const quoteEndIdx = quoteStartIdx + 1 + specifier.length
      const startQuoteCol = quoteStartIdx + 1
      const endQuoteCol = quoteEndIdx + 2
      if (column >= startQuoteCol && column <= endQuoteCol) {
        return {
          specifier,
          startColumn: quoteStartIdx + 2,
          endColumn: quoteEndIdx + 1
        }
      }
    }
  }
  return null
}

function findImportForIdentifierInModel(
  model: Monaco.editor.ITextModel,
  identifier: string
): { specifier: string; importedSymbol: string; isDefault: boolean } | null {
  const maxLines = Math.min(model.getLineCount(), 250)
  const headerText = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: maxLines,
    endColumn: model.getLineMaxColumn(maxLines)
  })

  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const importStmtRegex =
    /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/g
  let match: RegExpExecArray | null
  while ((match = importStmtRegex.exec(headerText)) !== null) {
    const clause = match[1].trim()
    const specifier = match[3]

    // Named imports: { Foo, Bar as Identifier }
    const braceMatch = /\{([\s\S]*?)\}/.exec(clause)
    if (braceMatch) {
      const namedParts = braceMatch[1].split(',')
      for (const rawPart of namedParts) {
        const part = rawPart.replace(/\btype\s+/, '').trim()
        if (!part) continue
        const asMatch = new RegExp(`^([A-Za-z0-9_$]+)\\s+as\\s+${escaped}$`).exec(part)
        if (asMatch) {
          return { specifier, importedSymbol: asMatch[1], isDefault: false }
        }
        if (part === identifier) {
          return { specifier, importedSymbol: identifier, isDefault: false }
        }
      }
    }

    // Namespace import: * as Identifier
    if (new RegExp(`\\*\\s+as\\s+${escaped}\\b`).test(clause)) {
      return { specifier, importedSymbol: identifier, isDefault: true }
    }

    // Default import: import Identifier from '...' or import Identifier, { ... } from '...'
    const withoutBraces = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, '').trim()
    if (withoutBraces === identifier) {
      return { specifier, importedSymbol: identifier, isDefault: true }
    }
  }
  return null
}

function findExportRangeInTargetModel(
  targetModel: Monaco.editor.ITextModel,
  symbolName: string,
  isDefault: boolean
): Monaco.IRange {
  const lineCount = targetModel.getLineCount()
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wordRegex = new RegExp(`\\b(${escaped})\\b`)

  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
    const line = targetModel.getLineContent(lineNumber)
    if (isCommentLine(line)) continue
    if (isExportedDeclarationLine(line, symbolName)) {
      const m = wordRegex.exec(line)
      const startCol = m ? m.index + 1 : 1
      return {
        startLineNumber: lineNumber,
        startColumn: startCol,
        endLineNumber: lineNumber,
        endColumn: startCol + symbolName.length
      }
    }
    if (isDefault && /\bexport\s+default\b/.test(line)) {
      const m = wordRegex.exec(line) ?? /\bdefault\b/.exec(line)
      const startCol = m ? m.index + 1 : 1
      const len = m ? m[0].length : 1
      return {
        startLineNumber: lineNumber,
        startColumn: startCol,
        endLineNumber: lineNumber,
        endColumn: startCol + len
      }
    }
  }

  // Fallback: any mention of export { ... symbolName ... }
  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
    const line = targetModel.getLineContent(lineNumber)
    if (isCommentLine(line)) continue
    if (/\bexport\b/.test(line) && wordRegex.test(line)) {
      const m = wordRegex.exec(line)!
      return {
        startLineNumber: lineNumber,
        startColumn: m.index + 1,
        endLineNumber: lineNumber,
        endColumn: m.index + 1 + symbolName.length
      }
    }
  }

  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1
  }
}

function deduplicateLocations(locations: Monaco.languages.Location[]): Monaco.languages.Location[] {
  const seen = new Set<string>()
  const unique: Monaco.languages.Location[] = []
  for (const loc of locations) {
    const key = `${loc.uri.toString()}:${loc.range.startLineNumber}:${loc.range.startColumn}:${loc.range.endLineNumber}:${loc.range.endColumn}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(loc)
    }
  }
  return unique
}

function normalizeDefinitionLinksToLocations(
  raw: Monaco.languages.Definition | Monaco.languages.LocationLink[] | null | undefined
): Monaco.languages.Location[] {
  if (!raw) {
    return []
  }
  const items: Array<Monaco.languages.Location | Monaco.languages.LocationLink> = Array.isArray(raw)
    ? raw
    : [raw]
  return items.map((item): Monaco.languages.Location => ({
    uri: item.uri,
    range:
      'targetSelectionRange' in item && item.targetSelectionRange
        ? item.targetSelectionRange
        : item.range
  }))
}

export function installMonacoTypeScriptWorkspaceIntelligence(monaco: typeof Monaco): void {
  const sharedCompilerOptions: Monaco.typescript.CompilerOptions = {
    ...monaco.typescript.typescriptDefaults.getCompilerOptions(),
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    allowJs: true,
    jsx: monaco.typescript.JsxEmit.Preserve
  }
  monaco.typescript.typescriptDefaults.setCompilerOptions(sharedCompilerOptions)
  monaco.typescript.javascriptDefaults.setCompilerOptions(sharedCompilerOptions)

  const originalRegisterReferenceProvider = monaco.languages.registerReferenceProvider.bind(
    monaco.languages
  )
  monaco.languages.registerReferenceProvider = (
    languageSelector: Monaco.languages.LanguageSelector,
    provider: Monaco.languages.ReferenceProvider
  ): Monaco.IDisposable => {
    const isTsOrJs =
      typeof languageSelector === 'string' && isTsOrJsLanguageId(languageSelector)
    if (!isTsOrJs) {
      return originalRegisterReferenceProvider(languageSelector, provider)
    }

    const wrappedProvider: Monaco.languages.ReferenceProvider = {
      provideReferences: async (model, position, context, token) => {
        const ctx = resolveModelContext(model.uri.toString())
        const wordObj = model.getWordAtPosition(position)
        const word = wordObj?.word ?? null

        if (!ctx || !word || word.length < 2) {
          return (await provider.provideReferences(model, position, context, token)) ?? []
        }

        const [baseRefs, searchFiles] = await Promise.all([
          provider.provideReferences(model, position, context, token),
          searchWorkspaceForWord(ctx, word)
        ])

        if (token.isCancellationRequested) {
          return baseRefs ?? []
        }

        const filesToHydrate = searchFiles.slice(0, MAX_HYDRATED_FILES_PER_QUERY)
        await Promise.all(
          filesToHydrate.map((fileEntry) =>
            ensureCandidateFileModel(monaco, ctx, fileEntry.filePath)
          )
        )

        const crossFileLocations: Monaco.languages.Location[] = []
        for (const fileEntry of searchFiles) {
          const targetUriStr = registerTargetUriContext(ctx, fileEntry.filePath)
          const targetUri = monaco.Uri.parse(targetUriStr)
          for (const match of fileEntry.matches ?? []) {
            if (isCommentLine(match.lineContent)) {
              continue
            }
            const startColumn = Math.max(1, match.column)
            const length = match.matchLength > 0 ? match.matchLength : word.length
            crossFileLocations.push({
              uri: targetUri,
              range: {
                startLineNumber: match.line,
                startColumn,
                endLineNumber: match.line,
                endColumn: startColumn + length
              }
            })
          }
        }

        return deduplicateLocations([...(baseRefs ?? []), ...crossFileLocations])
      }
    }
    return originalRegisterReferenceProvider(languageSelector, wrappedProvider)
  }

  const originalRegisterDefinitionProvider = monaco.languages.registerDefinitionProvider.bind(
    monaco.languages
  )
  monaco.languages.registerDefinitionProvider = (
    languageSelector: Monaco.languages.LanguageSelector,
    provider: Monaco.languages.DefinitionProvider
  ): Monaco.IDisposable => {
    const isTsOrJs =
      typeof languageSelector === 'string' && isTsOrJsLanguageId(languageSelector)
    if (!isTsOrJs) {
      return originalRegisterDefinitionProvider(languageSelector, provider)
    }

    const wrappedProvider: Monaco.languages.DefinitionProvider = {
      provideDefinition: async (model, position, token) => {
        const lineContent = model.getLineContent(position.lineNumber)

        // 1. Check if cursor is on an import/export/require module route string (e.g. '../utils/errors/http-custom-errors')
        const specMatch = extractModuleSpecifierAtPosition(lineContent, position.column)
        if (specMatch) {
          const ctx = resolveModelContext(model.uri.toString())
          if (ctx) {
            const resolvedPath = await resolveImportSpecifierToFilePath(ctx, specMatch.specifier)
            if (token.isCancellationRequested) {
              return []
            }
            if (resolvedPath) {
              const targetUriStr = registerTargetUriContext(ctx, resolvedPath)
              const targetUri = monaco.Uri.parse(targetUriStr)
              void ensureCandidateFileModel(monaco, ctx, resolvedPath)
              return [
                {
                  originSelectionRange: {
                    startLineNumber: position.lineNumber,
                    startColumn: specMatch.startColumn,
                    endLineNumber: position.lineNumber,
                    endColumn: specMatch.endColumn
                  },
                  uri: targetUri,
                  range: {
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 1
                  },
                  targetSelectionRange: {
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 1
                  }
                }
              ]
            }
          }
        }

        const wordObj = model.getWordAtPosition(position)
        const word = wordObj?.word ?? null

        // 2. Fast path: if cursor is already on an exported declaration in this file, return immediately (<1ms)
        if (word && isExportedDeclarationLine(lineContent, word)) {
          return [
            {
              uri: model.uri,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: wordObj!.startColumn,
                endLineNumber: position.lineNumber,
                endColumn: wordObj!.endColumn
              }
            }
          ]
        }

        // 3. Check local TypeScript worker first before doing any workspace search
        const rawDefs = await provider.provideDefinition(model, position, token)
        if (token.isCancellationRequested) {
          return rawDefs
        }

        const defs = normalizeDefinitionLinksToLocations(rawDefs)
        const onlyPointsToImportInSameFile =
          defs.length === 0 ||
          defs.every(
            (d) =>
              d.uri.toString() === model.uri.toString() &&
              /\bimport\b/.test(model.getLineContent(d.range.startLineNumber))
          )

        if (!onlyPointsToImportInSameFile) {
          return rawDefs
        }

        const ctx = resolveModelContext(model.uri.toString())
        if (!ctx || !word || word.length < 2) {
          return rawDefs
        }

        // 4. Direct import resolution: if identifier is imported in this file, resolve its module path first
        const importedInfo = findImportForIdentifierInModel(model, word)
        if (importedInfo) {
          const resolvedImportFile = await resolveImportSpecifierToFilePath(
            ctx,
            importedInfo.specifier
          )
          if (token.isCancellationRequested) {
            return rawDefs
          }
          if (resolvedImportFile) {
            const targetModel = await ensureCandidateFileModel(monaco, ctx, resolvedImportFile)
            const targetUriStr = registerTargetUriContext(ctx, resolvedImportFile)
            const targetUri = monaco.Uri.parse(targetUriStr)
            if (targetModel) {
              const targetRange = findExportRangeInTargetModel(
                targetModel,
                importedInfo.importedSymbol,
                importedInfo.isDefault
              )
              // If found on a specific declaration line or it's a default import, return immediately
              if (targetRange.startLineNumber > 1 || importedInfo.isDefault) {
                return [
                  {
                    uri: targetUri,
                    range: targetRange
                  }
                ]
              }
            } else {
              return [
                {
                  uri: targetUri,
                  range: {
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: 1,
                    endColumn: 1
                  }
                }
              ]
            }
          }
        }

        const searchFiles = await searchWorkspaceForWord(ctx, word)
        if (token.isCancellationRequested) {
          return rawDefs
        }

        const exportedDefs: Monaco.languages.Location[] = []
        const filesWithExports: string[] = []

        for (const fileEntry of searchFiles) {
          const targetUriStr = registerTargetUriContext(ctx, fileEntry.filePath)
          if (targetUriStr === model.uri.toString()) {
            continue
          }
          const targetUri = monaco.Uri.parse(targetUriStr)
          for (const match of fileEntry.matches ?? []) {
            if (!isCommentLine(match.lineContent) && isExportedDeclarationLine(match.lineContent, word)) {
              const startColumn = Math.max(1, match.column)
              const length = match.matchLength > 0 ? match.matchLength : word.length
              exportedDefs.push({
                uri: targetUri,
                range: {
                  startLineNumber: match.line,
                  startColumn,
                  endLineNumber: match.line,
                  endColumn: startColumn + length
                }
              })
              if (!filesWithExports.includes(fileEntry.filePath)) {
                filesWithExports.push(fileEntry.filePath)
              }
            }
          }
        }

        if (exportedDefs.length > 0) {
          await Promise.all(
            filesWithExports
              .slice(0, 5)
              .map((filePath) => ensureCandidateFileModel(monaco, ctx, filePath))
          )
          return deduplicateLocations([...exportedDefs, ...defs])
        }

        return rawDefs
      }
    }
    return originalRegisterDefinitionProvider(languageSelector, wrappedProvider)
  }

  monaco.editor.registerEditorOpener({
    openCodeEditor(
      source: editor.ICodeEditor,
      resource: Monaco.Uri,
      selectionOrPosition?: IRange | IPosition
    ): boolean {
      const targetLine = selectionOrPosition
        ? 'startLineNumber' in selectionOrPosition
          ? selectionOrPosition.startLineNumber
          : selectionOrPosition.lineNumber
        : 1
      const targetColumn = selectionOrPosition
        ? 'startColumn' in selectionOrPosition
          ? selectionOrPosition.startColumn
          : selectionOrPosition.column
        : 1

      const sourceUriStr = source.getModel()?.uri.toString()
      const targetUriStr = resource.toString()
      const sourceCtx = sourceUriStr ? resolveModelContext(sourceUriStr) : null
      const sourcePos = source.getPosition() ?? { lineNumber: 1, column: 1 }

      if (sourceUriStr === targetUriStr) {
        if (sourceCtx) {
          recordExplicitEditorJump({
            worktreeId: sourceCtx.worktreeId,
            source: {
              filePath: sourceCtx.filePath,
              relativePath: sourceCtx.relativePath,
              runtimeEnvironmentId: sourceCtx.runtimeEnvironmentId,
              lineNumber: sourcePos.lineNumber,
              column: sourcePos.column
            },
            target: {
              filePath: sourceCtx.filePath,
              relativePath: sourceCtx.relativePath,
              runtimeEnvironmentId: sourceCtx.runtimeEnvironmentId,
              lineNumber: targetLine,
              column: targetColumn
            }
          })
        }
        source.setPosition({ lineNumber: targetLine, column: targetColumn })
        source.revealLineInCenterIfOutsideViewport(targetLine)
        source.focus()
        return true
      }

      const targetCtx = resolveModelContext(targetUriStr) ?? sourceCtx
      if (!targetCtx) {
        return false
      }

      const knownTarget = modelContextByUri.get(targetUriStr)
      const targetFilePath =
        knownTarget?.filePath ?? URI.file(URI.parse(targetUriStr).path).fsPath
      const targetRelativePath =
        knownTarget?.relativePath ?? computeRelativePath(targetCtx.worktreePath, targetFilePath)

      const state = useAppStore.getState()
      state.openFile(
        {
          filePath: targetFilePath,
          relativePath: targetRelativePath,
          worktreeId: targetCtx.worktreeId,
          language: detectLanguage(targetFilePath),
          mode: 'edit',
          runtimeEnvironmentId: targetCtx.runtimeEnvironmentId ?? undefined
        },
        {
          preview: true,
          targetGroupId: state.activeGroupIdByWorktree?.[targetCtx.worktreeId],
          recordReplacedPreview: true
        }
      )

      const fileId = getOpenedEditFileIdAfterOpen(
        useAppStore.getState(),
        targetFilePath,
        targetCtx.worktreeId
      )
      recordExplicitEditorJump({
        worktreeId: targetCtx.worktreeId,
        source: sourceCtx
          ? {
              filePath: sourceCtx.filePath,
              relativePath: sourceCtx.relativePath,
              runtimeEnvironmentId: sourceCtx.runtimeEnvironmentId,
              lineNumber: sourcePos.lineNumber,
              column: sourcePos.column
            }
          : undefined,
        target: {
          fileId,
          filePath: targetFilePath,
          relativePath: targetRelativePath,
          runtimeEnvironmentId: targetCtx.runtimeEnvironmentId,
          lineNumber: targetLine,
          column: targetColumn
        }
      })
      scheduleEditorLineReveal(
        () => useAppStore.getState(),
        targetFilePath,
        targetLine,
        targetColumn,
        fileId
      )
      return true
    }
  })
}

export function registerEditorInstanceForTsWorkspace(
  editorInstance: editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  params: {
    fileId: string
    filePath: string
    worktreeId?: string
    modelOwnerKey?: string
  }
): () => void {
  const { fileId, filePath, worktreeId, modelOwnerKey } = params
  const state = useAppStore.getState()
  const worktree = worktreeId
    ? findWorktreeById(selectWorktreesByRepo(state), worktreeId)
    : undefined
  const openFile = state.openFiles?.find((f) => f.id === fileId)
  const resolvedRelativePath =
    openFile?.relativePath || (worktree ? computeRelativePath(worktree.path, filePath) : filePath)

  if (worktree && worktreeId) {
    const modelUriStr = toEditorModelUri(filePath, modelOwnerKey)
    modelContextByUri.set(modelUriStr, {
      filePath,
      relativePath: resolvedRelativePath,
      worktreeId,
      worktreePath: worktree.path,
      modelOwnerKey,
      runtimeEnvironmentId: openFile?.runtimeEnvironmentId,
      connectionId: getConnectionId(worktreeId) ?? undefined
    })
  }

  const disposeNavHistory = registerEditorForNavigationHistory(
    fileId,
    filePath,
    resolvedRelativePath,
    worktreeId,
    openFile?.runtimeEnvironmentId,
    editorInstance
  )

  const findAllReferencesAction = editorInstance.addAction({
    id: 'dorca.findAllReferences',
    label: 'Find All References',
    keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.F12],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.4,
    run: (ed) => {
      ed.trigger('dorca', 'editor.action.referenceSearch.trigger', null)
    }
  })

  return () => {
    disposeNavHistory()
    findAllReferencesAction.dispose()
  }
}
