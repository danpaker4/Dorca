import { fileURLToPath, pathToFileURL } from 'node:url'
import { CancellationTokenSource, type MessageConnection } from 'vscode-jsonrpc/node'
import type { FsChangeEvent } from '../../shared/file-watch/filesystem-change-event'
import type {
  TypeScriptDocumentRange,
  TypeScriptNavigationRequest,
  TypeScriptNavigationResult
} from '../../shared/editor-language/typescript-navigation'
import { isPathInsideOrEqual } from '../../shared/file-access/cross-platform-path'
import { startTypeScriptLspTransport } from './typescript-lsp-transport'

type LspRange = {
  start: { line: number; character: number }
  end: { line: number; character: number }
}
type LspLocation =
  | { uri: string; range: LspRange }
  | { targetUri: string; targetSelectionRange: LspRange }
type LspHover = {
  contents: { kind: 'markdown' | 'plaintext'; value: string }
  range?: LspRange
}
type LspDiagnostic = {
  range: LspRange
  severity?: number
  message: string
  code?: number | string
}

function toEditorRange(range: LspRange): TypeScriptDocumentRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  }
}

export class TypeScriptLanguageServer {
  private readonly connection: MessageConnection
  private readonly transport: ReturnType<typeof startTypeScriptLspTransport>
  private readonly ready: Promise<void>
  private readonly documents = new Map<string, { content: string; version: number }>()
  private pending: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly root: string,
    binary: string,
    onClosed: () => void
  ) {
    this.transport = startTypeScriptLspTransport(binary)
    this.connection = this.transport.connection
    this.connection.onDispose(onClosed)
    this.ready = this.initialize()
  }

  private async initialize(): Promise<void> {
    const uri = pathToFileURL(this.root).href
    await this.connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri: uri,
      workspaceFolders: [{ uri, name: this.root }],
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        textDocument: { hover: { contentFormat: ['markdown'] }, diagnostic: {} },
        workspace: { configuration: true, workspaceFolders: true }
      },
      initializationOptions: { enableTelemetry: false, runExternalCode: false }
    })
    await this.connection.sendNotification('initialized', {})
  }

  async query(
    request: TypeScriptNavigationRequest,
    signal?: AbortSignal
  ): Promise<TypeScriptNavigationResult> {
    if (request.kind === 'diagnostics') {
      let pending: Promise<unknown>
      do {
        pending = this.pending
        await pending
        signal?.throwIfAborted()
      } while (pending !== this.pending)
    }
    const dispatch = this.pending.then(() => this.dispatch(request, signal))
    const result = dispatch.then((query) => query.result)
    // The native server captures the document snapshot on dispatch, so hover can proceed during a check.
    const serialized = request.kind === 'diagnostics' ? dispatch : result
    this.pending = serialized.catch(() => undefined)
    return result
  }

  async filesChanged(events: FsChangeEvent[]): Promise<void> {
    await this.ready
    if (events.some((event) => event.kind === 'overflow')) {
      void this.dispose()
      return
    }
    await this.connection.sendNotification('workspace/didChangeWatchedFiles', {
      changes: events.flatMap((event) => [
        ...(event.oldAbsolutePath
          ? [{ uri: pathToFileURL(event.oldAbsolutePath).href, type: 3 }]
          : []),
        {
          uri: pathToFileURL(event.absolutePath).href,
          type:
            event.kind === 'delete' ? 3 : event.kind === 'create' || event.kind === 'rename' ? 1 : 2
        }
      ])
    })
  }

  private async dispatch(
    request: TypeScriptNavigationRequest,
    signal?: AbortSignal
  ): Promise<{ result: Promise<TypeScriptNavigationResult> }> {
    signal?.throwIfAborted()
    await this.ready
    signal?.throwIfAborted()
    const retained = new Set(request.buffers.map((buffer) => pathToFileURL(buffer.filePath).href))
    for (const uri of this.documents.keys()) {
      if (!retained.has(uri)) {
        await this.connection.sendNotification('textDocument/didClose', { textDocument: { uri } })
        this.documents.delete(uri)
      }
    }
    for (const buffer of request.buffers) {
      const uri = pathToFileURL(buffer.filePath).href
      const previous = this.documents.get(uri)
      if (previous?.content === buffer.content) {
        continue
      }
      const version = (previous?.version ?? 0) + 1
      await this.connection.sendNotification(
        previous ? 'textDocument/didChange' : 'textDocument/didOpen',
        previous
          ? {
              textDocument: { uri, version },
              contentChanges: [{ text: buffer.content }]
            }
          : { textDocument: { uri, version, text: buffer.content, languageId: buffer.languageId } }
      )
      this.documents.set(uri, { content: buffer.content, version })
    }
    signal?.throwIfAborted()
    return { result: this.requestResult(request, signal) }
  }

  private async requestResult(
    request: TypeScriptNavigationRequest,
    signal?: AbortSignal
  ): Promise<TypeScriptNavigationResult> {
    const token = new CancellationTokenSource()
    const abort = (): void => token.cancel()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const params = {
        textDocument: { uri: pathToFileURL(request.filePath).href },
        position: { line: request.lineNumber - 1, character: request.column - 1 },
        ...(request.kind === 'references'
          ? { context: { includeDeclaration: request.includeDeclaration } }
          : {})
      }
      if (request.kind === 'hover') {
        const response = await this.connection.sendRequest<LspHover | null>(
          'textDocument/hover',
          params,
          token.token
        )
        return {
          available: true,
          locations: [],
          hover: response
            ? {
                markdown: response.contents.value,
                range: response.range && toEditorRange(response.range)
              }
            : undefined
        }
      }
      if (request.kind === 'diagnostics') {
        const response = await this.connection.sendRequest<{ items: LspDiagnostic[] }>(
          'textDocument/diagnostic',
          { textDocument: params.textDocument },
          token.token
        )
        return {
          available: true,
          locations: [],
          errors: response.items
            .filter(({ severity }) => severity === 1 || severity === undefined)
            .map(({ range, message, code }) => ({
              range: toEditorRange(range),
              message,
              code: code === undefined ? undefined : String(code)
            }))
        }
      }
      const response = await this.connection.sendRequest<LspLocation[] | LspLocation | null>(
        request.kind === 'references' ? 'textDocument/references' : 'textDocument/definition',
        params,
        token.token
      )
      const locations = (Array.isArray(response) ? response : response ? [response] : []).flatMap(
        (entry) => {
          const uri = new URL('uri' in entry ? entry.uri : entry.targetUri)
          if (uri.protocol !== 'file:') {
            return []
          }
          const filePath = fileURLToPath(uri)
          if (!isPathInsideOrEqual(this.root, filePath)) {
            return []
          }
          const range = 'range' in entry ? entry.range : entry.targetSelectionRange
          return [{ filePath, range: toEditorRange(range) }]
        }
      )
      return { available: true, locations: request.kind === 'prepare' ? [] : locations }
    } finally {
      signal?.removeEventListener('abort', abort)
      token.dispose()
    }
  }

  dispose(): Promise<void> {
    return this.transport.dispose()
  }
}
