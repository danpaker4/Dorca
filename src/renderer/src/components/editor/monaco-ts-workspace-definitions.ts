import type * as Monaco from 'monaco-editor'
import {
  isTsOrJsLanguageId,
  resolveModelContext,
  registerTargetUriContext,
  ensureCandidateFileModel
} from './monaco-ts-workspace-models'
import { resolveImportSpecifierToFilePath } from './monaco-ts-workspace-imports'
import { searchWorkspaceForWord } from './monaco-ts-workspace-search'
import {
  isCommentLine,
  isExportedDeclarationLine,
  extractModuleSpecifierAtPosition,
  findImportForIdentifierInModel,
  findExportRangeInTargetModel,
  deduplicateLocations,
  normalizeDefinitionLinksToLocations
} from './monaco-ts-workspace-symbols'

export function registerWorkspaceDefinitions(monaco: typeof Monaco): void {
  const originalRegisterDefinitionProvider = monaco.languages.registerDefinitionProvider.bind(
    monaco.languages
  )
  monaco.languages.registerDefinitionProvider = (
    languageSelector: Monaco.languages.LanguageSelector,
    provider: Monaco.languages.DefinitionProvider
  ): Monaco.IDisposable => {
    const isTsOrJs = typeof languageSelector === 'string' && isTsOrJsLanguageId(languageSelector)
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
        const onlyPointsToImportInSameFile = defs.every(
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
            if (
              !isCommentLine(match.lineContent) &&
              isExportedDeclarationLine(match.lineContent, word)
            ) {
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
}
