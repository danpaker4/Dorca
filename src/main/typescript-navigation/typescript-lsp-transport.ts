import { PassThrough } from 'node:stream'
import { dirname } from 'node:path'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter
} from 'vscode-jsonrpc/node'
import { spawnProcessOnWorkerThread } from '../worker-thread-child-process/worker-thread-child-process'

export function startTypeScriptLspTransport(binary: string) {
  const child = spawnProcessOnWorkerThread({
    program: binary,
    args: ['--lsp', '--stdio'],
    cwd: dirname(binary)
  })
  const input = new PassThrough()
  const output = new PassThrough()
  input.setEncoding('utf8')
  input.on('data', (data: string) => child.stdin.write(data))
  child.stdout.on('data', (data: Buffer) => output.write(data))
  const connection = createMessageConnection(
    new StreamMessageReader(output),
    new StreamMessageWriter(input)
  )
  const closed = new Promise<void>((resolve) => child.once('close', resolve))
  child.on('error', () => connection.dispose())
  child.on('close', () => connection.dispose())
  connection.onDispose(() => {
    input.destroy()
    output.destroy()
    child.kill()
  })
  connection.onRequest('workspace/configuration', (params: { items: unknown[] }) =>
    params.items.map(() => ({ disableAutomaticTypeAcquisition: true }))
  )
  connection.onRequest('client/registerCapability', () => null)
  connection.onRequest('window/workDoneProgress/create', () => null)
  connection.listen()
  let stopping: Promise<void> | undefined
  return {
    connection,
    dispose(): Promise<void> {
      stopping ??= new Promise<void>((resolve) => {
        const deadline = setTimeout(resolve, 2_000)
        void closed.then(() => {
          clearTimeout(deadline)
          resolve()
        })
        connection.dispose()
      })
      return stopping
    }
  }
}
