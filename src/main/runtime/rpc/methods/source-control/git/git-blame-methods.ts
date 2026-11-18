import {
  remoteRpcContentBudget,
  remoteRpcResultExceedsContentBudget
} from '../../../../../../shared/remote-runtime/rpc/remote-rpc-content-budget'
import { defineMethod } from '../../../core'
import { GitBlame } from '../../../../../../shared/rpc-contract/source-control/git-params'

export const GIT_BLAME_METHODS = [
  defineMethod({
    name: 'git.blame',
    permission: 'workspace',
    params: GitBlame,
    handler: async (params, { runtime, clientId, connectionId, signal, clientKind, requestId }) => {
      if (!('mode' in params)) {
        const result = await runtime.getRuntimeGitStatusBarBlame(
          params.worktree,
          params.filePath,
          params.knownHeadOid
        )
        return result.kind === 'ready' &&
          clientKind &&
          requestId &&
          remoteRpcResultExceedsContentBudget(result, remoteRpcContentBudget(requestId), [
            'headText'
          ])
          ? { kind: 'too-large' as const }
          : result
      }
      const result = await runtime.getRuntimeGitBlame(
        params.worktree,
        params,
        connectionId ?? clientId ?? 'local',
        signal
      )
      if (
        clientKind &&
        requestId &&
        remoteRpcResultExceedsContentBudget(result, remoteRpcContentBudget(requestId))
      ) {
        throw new Error('This file is too large for blame over this remote connection.')
      }
      return result
    }
  })
]
