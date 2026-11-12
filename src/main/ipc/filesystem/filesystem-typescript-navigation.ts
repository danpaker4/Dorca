import { ipcMain } from 'electron'
import { TypeScriptNavigationPayload } from '../../../shared/rpc-contract/files-params'
import {
  authorizeTypeScriptNavigation,
  restoreTypeScriptNavigationPaths
} from '../../typescript-navigation/typescript-navigation-paths'
import { queryTypeScriptOnHost } from '../../typescript-navigation/typescript-server-pool'
import { resolveLocalListRequestPath } from './access/local-file-access-resolution'
import type { FilesystemHandlerContext } from './filesystem-handler-context'
import { assertWslUncPathRunning } from '../../wsl/filesystem/wsl-unc-access-gate'
import type {
  TypeScriptNavigationRequest,
  TypeScriptNavigationResult
} from '../../../shared/editor-language/typescript-navigation'

export function registerFilesystemTypeScriptNavigation({ store }: FilesystemHandlerContext): void {
  ipcMain.handle(
    'fs:typescriptNavigation',
    async (
      event,
      args: TypeScriptNavigationRequest & { connectionId?: string }
    ): Promise<TypeScriptNavigationResult> => {
      if (args.connectionId) {
        return { available: false, locations: [] }
      }
      const parsed = TypeScriptNavigationPayload.parse(args)
      await assertWslUncPathRunning(parsed.rootPath)
      const request = await authorizeTypeScriptNavigation(parsed, (path) =>
        resolveLocalListRequestPath(path, undefined, store)
      )
      const result = await queryTypeScriptOnHost(`renderer:${event.sender.id}`, request)
      return restoreTypeScriptNavigationPaths(result, request.rootPath, parsed.rootPath)
    }
  )
}
