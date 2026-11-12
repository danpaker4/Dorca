import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { resolveWorktreeGitCopy } from '@/lib/worktree-git-copy'
import { getRuntimeTargetForFileOwner } from '@/lib/file-owner-runtime-target'
import { selectWorkspaceByHostTarget } from '@/store/workspaces/selection/workspace-host-target'
import { hostWorktreeTarget } from '../../../../../shared/worktree/host-qualified-identity'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { RuntimeGitContext } from '@/runtime/source-control/git/runtime-git-client-context'
import { BoundedMap } from '../../../../../shared/bounded-map'

export type InlineGitContext = RuntimeGitContext & { worktreeId: string; hostId: ExecutionHostId }
const contexts = new BoundedMap<string, InlineGitContext>({ maxEntries: 64 })

export function resolveInlineGitContext(
  worktreeId: string | null | undefined,
  runtimeEnvironmentId: string | null | undefined,
  hostId: ExecutionHostId | null,
  catalog: AppState['worktreesByRepo'],
  folders: AppState['folderWorkspaces']
): InlineGitContext | null {
  if (!worktreeId) {
    return null
  }
  const state = { ...useAppStore.getState(), worktreesByRepo: catalog, folderWorkspaces: folders }
  const copy = resolveWorktreeGitCopy(state, worktreeId, hostId)
  const target = getRuntimeTargetForFileOwner(state, worktreeId, runtimeEnvironmentId)
  if (!copy?.hostId || !target || JSON.stringify(copy.transport) !== JSON.stringify(target)) {
    return null
  }
  const worktree = selectWorkspaceByHostTarget(
    state,
    hostWorktreeTarget({ hostId: copy.hostId, id: worktreeId })
  )
  if (!worktree) {
    return null
  }
  const key = JSON.stringify([target, worktreeId, worktree.path, copy.connectionId, copy.hostId])
  const previous = contexts.get(key)
  if (previous) {
    return previous
  }
  const context = {
    target,
    worktreeId,
    worktreePath: worktree.path,
    connectionId: copy.connectionId,
    hostId: copy.hostId
  }
  contexts.set(key, context)
  return context
}
