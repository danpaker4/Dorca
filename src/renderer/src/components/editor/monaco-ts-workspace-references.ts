import type * as Monaco from 'monaco-editor'
import {
  isTsOrJsLanguageId,
  resolveModelContext,
  registerTargetUriContext,
  ensureCandidateFileModel
} from './monaco-ts-workspace-models'
import { searchWorkspaceForWord } from './monaco-ts-workspace-search'
import { isCommentLine, deduplicateLocations } from './monaco-ts-workspace-symbols'

const MAX_HYDRATED_FILES_PER_QUERY = 25

export function registerWorkspaceReferences(monaco: typeof Monaco): void {
  const originalRegisterReferenceProvider = monaco.languages.registerReferenceProvider.bind(
    monaco.languages
  )
  monaco.languages.registerReferenceProvider = (
    languageSelector: Monaco.languages.LanguageSelector,
    provider: Monaco.languages.ReferenceProvider
  ): Monaco.IDisposable => {
    const isTsOrJs = typeof languageSelector === 'string' && isTsOrJsLanguageId(languageSelector)
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
}
