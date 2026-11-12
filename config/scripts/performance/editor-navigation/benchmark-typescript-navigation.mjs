import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { runProcess } from '@orca/process-host'

const repo = resolve(import.meta.dirname, '../../../..')
const require = createRequire(import.meta.url)
const {
  copyPackagedTypeScriptLanguageServer
} = require('../../../packaged-typescript-language-server.cjs')
const scratch = await mkdtemp(join(tmpdir(), 'dorca-navigation-benchmark-'))
const output = join(scratch, 'benchmark.cjs')
const binary = join(
  scratch,
  'typescript-language-server',
  process.platform === 'win32' ? 'tsc.exe' : 'tsc'
)
try {
  copyPackagedTypeScriptLanguageServer(scratch, process.platform, process.arch, repo)
  await build({
    entryPoints: [
      join(repo, 'src/main/worker-thread-child-process/worker-thread-child-process-entry.ts')
    ],
    outfile: join(scratch, 'worker-thread-child-process-entry.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'error'
  })
  await build({
    stdin: {
      resolveDir: repo,
      sourcefile: 'typescript-navigation-benchmark.ts',
      contents: `
import { readFileSync } from 'node:fs'
import { TypeScriptLanguageServer } from ${JSON.stringify(join(repo, 'src/main/typescript-navigation/typescript-language-server.ts'))}
const root = process.argv[2]
const binary = process.argv[3]
const filePath = root + '/src/renderer/src/components/editor/monaco-ts-workspace-definitions.ts'
const content = readFileSync(filePath, 'utf8')
const prefix = content.slice(0, content.indexOf('registerWorkspaceDefinitions') + 2).split('\\n')
const request = { rootPath: root, filePath, kind: 'references', lineNumber: prefix.length,
  column: prefix.at(-1).length + 1, includeDeclaration: false,
  buffers: [{ filePath, content, languageId: 'typescript' }] }
async function measure() {
  let server = new TypeScriptLanguageServer(root, binary, () => {})
  try {
    let start = performance.now()
    const result = await server.query(request)
    const coldMs = performance.now() - start
    if (result.locations.length !== 3) { throw new Error('Expected the three call references in this repository') }
    start = performance.now()
    await server.query(request)
    const warmMs = performance.now() - start
    await server.dispose()
    server = new TypeScriptLanguageServer(root, binary, () => {})
    start = performance.now()
    await server.query({ ...request, kind: 'prepare', lineNumber: 1, column: 1 })
    const prepareMs = performance.now() - start
    start = performance.now()
    const prepared = await server.query(request)
    if (prepared.locations.length !== 3) { throw new Error('Prepared query lost references') }
    const preparedLookupMs = performance.now() - start
    console.log(JSON.stringify({ coldMs, warmMs, prepareMs, preparedLookupMs, locations: result.locations }, null, 2))
  } finally { await server.dispose() }
}
const keepAlive = setInterval(() => {}, 1_000)
void measure().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => clearInterval(keepAlive))
`
    },
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'error'
  })
  const result = await runProcess({
    program: process.execPath,
    args: [output, repo, binary],
    cwd: repo,
    env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 60_000
  })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  if (result.code !== 0 || result.timedOut) {
    process.exitCode = 1
  }
} finally {
  const path = relative(tmpdir(), scratch)
  if (
    !path.startsWith('..') &&
    !path.includes(':') &&
    path.startsWith('dorca-navigation-benchmark-')
  ) {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
