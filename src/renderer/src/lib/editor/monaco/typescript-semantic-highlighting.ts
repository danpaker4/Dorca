import type * as Monaco from 'monaco-editor'
import {
  TYPESCRIPT_HIGHLIGHT_CHARACTER_LIMIT,
  TYPESCRIPT_HIGHLIGHT_TOKEN_TYPES,
  type TypeScriptHighlightWorker
} from './typescript-highlight-protocol'

function encodeHighlights(model: Monaco.editor.ITextModel, spans: readonly number[]): Uint32Array {
  const data: number[] = []
  let previousLine = 0
  let previousStart = 0
  for (let index = 0; index < spans.length; index += 3) {
    const start = model.getPositionAt(spans[index])
    const end = model.getPositionAt(spans[index] + spans[index + 1])
    for (let line = start.lineNumber; line <= end.lineNumber; line++) {
      const column = line === start.lineNumber ? start.column - 1 : 0
      const endColumn = line === end.lineNumber ? end.column - 1 : model.getLineMaxColumn(line) - 1
      if (endColumn <= column) {
        continue
      }
      const zeroLine = line - 1
      data.push(
        zeroLine - previousLine,
        zeroLine === previousLine ? column - previousStart : column,
        endColumn - column,
        spans[index + 2],
        0
      )
      previousLine = zeroLine
      previousStart = column
    }
  }
  return new Uint32Array(data)
}

export function installTypeScriptSemanticHighlighting(monaco: typeof Monaco): () => void {
  const registrations = ['typescript', 'javascript'].map((languageId) =>
    monaco.languages.registerDocumentSemanticTokensProvider(languageId, {
      getLegend: () => ({ tokenTypes: [...TYPESCRIPT_HIGHLIGHT_TOKEN_TYPES], tokenModifiers: [] }),
      releaseDocumentSemanticTokens: () => {},
      provideDocumentSemanticTokens: async (model, _lastResultId, cancellation) => {
        if (model.getValueLength() > TYPESCRIPT_HIGHLIGHT_CHARACTER_LIMIT) {
          return null
        }
        const version = model.getVersionId()
        try {
          const getWorker = await (languageId === 'typescript'
            ? monaco.typescript.getTypeScriptWorker()
            : monaco.typescript.getJavaScriptWorker())
          if (cancellation.isCancellationRequested || model.isDisposed()) {
            return null
          }
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: MonacoEnvironment installs our TypeScriptHighlightWorker subclass for both language workers.
          const worker = (await getWorker(model.uri)) as Monaco.typescript.TypeScriptWorker &
            TypeScriptHighlightWorker
          const spans = await worker.getHighlightClassifications(model.uri.toString())
          if (
            cancellation.isCancellationRequested ||
            model.isDisposed() ||
            model.getVersionId() !== version
          ) {
            return null
          }
          return { data: encodeHighlights(model, spans) }
        } catch {
          // A stopped or unavailable worker leaves the ordinary syntax colors in place.
          return null
        }
      }
    })
  )
  return () => registrations.forEach((registration) => registration.dispose())
}
