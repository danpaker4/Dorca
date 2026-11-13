import type {
  TypeScriptNavigationRequest,
  TypeScriptNavigationResult
} from '../../shared/editor-language/typescript-navigation'
import { getAppEnvironment, hasAppEnvironment } from '../../shared/app-environment'
import { TypeScriptLanguageServer } from './typescript-language-server'
import { resolveTypeScriptServerBinary } from './typescript-server-binary'
import { watchFileExplorerInWatcherProcess } from '../runtime/files/watch/file-watcher-host'
import { hasTypeScriptProjectConfig } from './typescript-project-config-presence'

const IDLE_STOP_MS = 15 * 60_000
const MAX_SERVERS = 4
type ServerEntry = {
  server: TypeScriptLanguageServer
  active: number
  touched: number
  timer?: NodeJS.Timeout
  stopWatch?: () => Promise<void>
}
const servers = new Map<string, ServerEntry>()
let registeredQuit = false

function closeServer(key: string): void {
  const entry = servers.get(key)
  if (!entry) {
    return
  }
  servers.delete(key)
  clearTimeout(entry.timer)
  void entry.server.dispose()
  void entry.stopWatch?.().catch(() => undefined)
}

export async function queryTypeScriptOnHost(
  client: string,
  request: TypeScriptNavigationRequest,
  signal?: AbortSignal
): Promise<TypeScriptNavigationResult> {
  if (
    request.kind === 'references' &&
    !(await hasTypeScriptProjectConfig(request.rootPath, request.filePath))
  ) {
    return { available: false, locations: [] }
  }
  const key = `${client}\0${request.rootPath}`
  let entry = servers.get(key)
  if (!entry) {
    const binary = await resolveTypeScriptServerBinary()
    if (!binary) {
      return { available: false, locations: [] }
    }
    // Binary resolution yields; another caller may have started this owner's server.
    entry = servers.get(key)
    if (!entry) {
      if (servers.size >= MAX_SERVERS) {
        const idle = [...servers]
          .filter(([, value]) => value.active === 0)
          .sort(([, a], [, b]) => a.touched - b.touched)[0]
        if (!idle) {
          return { available: false, locations: [] }
        }
        closeServer(idle[0])
      }
      const server = new TypeScriptLanguageServer(request.rootPath, binary, () => {
        if (servers.get(key)?.server === server) {
          closeServer(key)
        }
      })
      entry = { server, active: 0, touched: Date.now() }
      servers.set(key, entry)
      const created = entry
      const closeCreated = (): void => {
        if (servers.get(key) === created) {
          closeServer(key)
        }
      }
      void watchFileExplorerInWatcherProcess(
        request.rootPath,
        (events) => {
          void created.server.filesChanged(events).catch(closeCreated)
        },
        closeCreated
      )
        .then((stop) => {
          if (servers.get(key) === created) {
            created.stopWatch = stop
          } else {
            void stop()
          }
        })
        .catch(closeCreated)
      if (!registeredQuit && hasAppEnvironment()) {
        registeredQuit = true
        getAppEnvironment().onWillQuit(() => [...servers.keys()].forEach(closeServer))
      }
    }
  }
  clearTimeout(entry.timer)
  entry.active++
  const current = entry
  const deadline = setTimeout(() => {
    if (servers.get(key) === current) {
      closeServer(key)
    }
  }, 30_000)
  try {
    return await entry.server.query(request, signal)
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    if (servers.get(key) === current) {
      closeServer(key)
    }
    return { available: false, locations: [] }
  } finally {
    clearTimeout(deadline)
    entry.active--
    entry.touched = Date.now()
    if (entry.active === 0 && servers.get(key) === entry) {
      entry.timer = setTimeout(() => closeServer(key), IDLE_STOP_MS)
      entry.timer.unref()
    }
  }
}
