import { defineMethod } from '../../core'
import { FileTypeScriptNavigation } from '../../../../../shared/rpc-contract/files-params'

export const FILE_TYPESCRIPT_NAVIGATION_METHODS = [
  defineMethod({
    name: 'files.typescriptNavigation',
    permission: 'workspace',
    params: FileTypeScriptNavigation,
    handler: (params, { runtime, clientId, signal }) =>
      runtime.queryTypeScriptNavigation(params.worktree, params, clientId, signal)
  })
]
