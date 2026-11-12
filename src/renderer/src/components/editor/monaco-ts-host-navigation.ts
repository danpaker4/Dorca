import type * as Monaco from 'monaco-editor'
import type {
  TypeScriptNavigationRequest,
  TypeScriptNavigationResult
} from '../../../../shared/editor-language/typescript-navigation'
import type { ModelWorkspaceContext } from './monaco-ts-workspace-models'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'

export async function queryHostTypeScriptNavigation(
  ctx: ModelWorkspaceContext,
  request: TypeScriptNavigationRequest
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
  model: Monaco.editor.ITextModel
): void {
  void queryHostTypeScriptNavigation(ctx, {
    rootPath: ctx.projectRootPath ?? ctx.worktreePath,
    filePath: ctx.filePath,
    kind: 'prepare',
    lineNumber: 1,
    column: 1,
    includeDeclaration: false,
    buffers: [
      { filePath: ctx.filePath, content: model.getValue(), languageId: model.getLanguageId() }
    ]
  }).catch(() => undefined)
}
