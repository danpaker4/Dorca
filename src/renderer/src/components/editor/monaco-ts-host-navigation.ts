import type * as Monaco from 'monaco-editor'
import type {
  TypeScriptNavigationRequest,
  TypeScriptNavigationResult
} from '../../../../shared/editor-language/typescript-navigation'
import type { ModelWorkspaceContext } from './monaco-ts-workspace-models'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import { captureNavigationBuffers } from './monaco-ts-navigation-buffers'

export async function queryHostTypeScriptNavigation(
  ctx: ModelWorkspaceContext,
  request: TypeScriptNavigationRequest,
  signal?: AbortSignal
): Promise<TypeScriptNavigationResult | null> {
  ctx.assertAuthorityCurrent()
  const target = ctx.readContext.target
  let result: TypeScriptNavigationResult
  if (target.kind === 'environment') {
    try {
      result = await callRuntimeRpc<TypeScriptNavigationResult>(
        target,
        'files.typescriptNavigation',
        {
          ...request,
          worktree: toRuntimeWorktreeSelector(ctx.worktreeId)
        },
        {
          timeoutMs: 30_000,
          signal,
          expectedEnvironmentPairingRevision: ctx.readContext.expectedEnvironmentPairingRevision
        }
      )
    } catch (error) {
      if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
        return null
      }
      throw error
    }
  } else {
    const query = window.api.fs.typescriptNavigation
    if (!query) {
      return null
    }
    result = await query({ ...request, connectionId: ctx.connectionId })
  }
  ctx.assertAuthorityCurrent()
  return result.available ? result : null
}

export function prepareHostTypeScriptNavigation(
  ctx: ModelWorkspaceContext,
  model: Monaco.editor.ITextModel,
  monaco: Pick<typeof Monaco, 'editor' | 'Uri'>
): void {
  void queryHostTypeScriptDocument(monaco, ctx, model, 'prepare').catch(() => undefined)
}

export async function queryHostTypeScriptDocument(
  monaco: Pick<typeof Monaco, 'editor' | 'Uri'>,
  ctx: ModelWorkspaceContext,
  model: Monaco.editor.ITextModel,
  kind: 'prepare' | 'hover' | 'diagnostics',
  position?: Monaco.IPosition,
  signal?: AbortSignal
): Promise<TypeScriptNavigationResult | null> {
  if (ctx.connectionId || signal?.aborted) {
    return null
  }
  const buffers = [...captureNavigationBuffers(monaco, ctx, model)]
  const versions = buffers.map(([buffer]) => buffer.getVersionId())
  const result = await queryHostTypeScriptNavigation(
    ctx,
    {
      rootPath: ctx.projectRootPath ?? ctx.worktreePath,
      filePath: ctx.filePath,
      kind,
      lineNumber: position?.lineNumber ?? 1,
      column: position?.column ?? 1,
      includeDeclaration: false,
      buffers: buffers.map(([buffer, filePath]) => ({
        filePath,
        content: buffer.getValue(),
        languageId: buffer.getLanguageId()
      }))
    },
    signal
  )
  if (
    signal?.aborted ||
    buffers.some(
      ([buffer], index) => buffer.isDisposed() || buffer.getVersionId() !== versions[index]
    )
  ) {
    return null
  }
  return result
}
