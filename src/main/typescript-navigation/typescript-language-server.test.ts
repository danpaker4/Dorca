import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { TypeScriptLanguageServer } from './typescript-language-server'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import {
  TYPESCRIPT_LANGUAGE_SERVER_DIRECTORY,
  typeScriptLanguageServerBinary
} from '../../shared/orcad-artifacts'
import type { TypeScriptNavigationRequest } from '../../shared/editor-language/typescript-navigation'

vi.mock(
  '../worker-thread-child-process/worker-thread-child-process',
  async () =>
    import('../worker-thread-child-process/worker-thread-child-process-in-process.test-fixtures')
)

const {
  copyPackagedTypeScriptLanguageServer
}: {
  copyPackagedTypeScriptLanguageServer: (root: string, platform: string, arch: string) => void
} = createRequire(import.meta.url)('../../../config/packaged-typescript-language-server.cjs')
let artifacts: string
let root: string
let server: TypeScriptLanguageServer
const source = "import { Service as Renamed } from './index'\nnew Renamed()"

beforeAll(async () => {
  artifacts = await mkdtemp(join(tmpdir(), 'dorca-typescript-server-'))
  copyPackagedTypeScriptLanguageServer(artifacts, process.platform, process.arch)
})

beforeEach(async () => {
  root = await mkdtemp(join(artifacts, 'workspace-'))
  await Promise.all(
    Object.entries({
      'tsconfig.json':
        '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"},"include":["*.ts"]}',
      'server.ts': 'export class Server {}',
      'index.ts': "export { Server as Service } from './server'",
      'use.ts': source,
      'unrelated.ts': 'export class Server {}\nnew Server()\n// Service Renamed'
    }).map(([file, content]) => writeFile(join(root, file), content))
  )
  server = new TypeScriptLanguageServer(
    root,
    join(
      artifacts,
      TYPESCRIPT_LANGUAGE_SERVER_DIRECTORY,
      typeScriptLanguageServerBinary(process.platform)
    ),
    () => {}
  )
})

afterEach(async () => {
  await server.dispose()
})
afterAll(async () => {
  if (artifacts && artifacts !== tmpdir() && isPathInsideOrEqual(tmpdir(), artifacts)) {
    await rm(artifacts, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function request(): TypeScriptNavigationRequest {
  return {
    rootPath: root,
    filePath: join(root, 'use.ts'),
    kind: 'definition',
    lineNumber: 2,
    column: 7,
    includeDeclaration: true,
    buffers: [{ filePath: join(root, 'use.ts'), content: source, languageId: 'typescript' }]
  }
}

it('returns semantic alias references from the staged native server', async () => {
  const result = await server.query({
    ...request(),
    kind: 'references',
    filePath: join(root, 'server.ts'),
    lineNumber: 1,
    column: 15,
    buffers: [
      ...request().buffers,
      {
        filePath: join(root, 'server.ts'),
        content: 'export class Server {}',
        languageId: 'typescript'
      }
    ]
  })
  expect(
    result.locations
      .map(({ filePath, range }) => [
        filePath.slice(root.length + 1).replaceAll('\\', '/'),
        range.startLineNumber,
        range.startColumn
      ])
      .toSorted(
        ([a, lineA, columnA], [b, lineB, columnB]) =>
          String(a).localeCompare(String(b)) ||
          Number(lineA) - Number(lineB) ||
          Number(columnA) - Number(columnB)
      )
  ).toEqual([
    ['index.ts', 1, 10],
    ['index.ts', 1, 20],
    ['server.ts', 1, 14],
    ['use.ts', 1, 10],
    ['use.ts', 1, 21],
    ['use.ts', 2, 5]
  ])
})

it('keeps queued unsaved snapshots separate and restores disk content after a draft closes', async () => {
  const dirty = {
    ...request(),
    buffers: [
      ...request().buffers,
      {
        filePath: join(root, 'server.ts'),
        content: '\n\nconst text = "😀"; export class Server {}',
        languageId: 'typescript'
      }
    ]
  }
  const [draft, disk] = await Promise.all([server.query(dirty), server.query(request())])
  expect(
    draft.locations.map((entry) => ({
      ...entry,
      filePath: relative(root, entry.filePath).replaceAll('\\', '/')
    }))
  ).toEqual([
    {
      filePath: 'server.ts',
      range: { startLineNumber: 3, startColumn: 33, endLineNumber: 3, endColumn: 39 }
    }
  ])
  expect(
    disk.locations.map((entry) => ({
      ...entry,
      filePath: relative(root, entry.filePath).replaceAll('\\', '/')
    }))
  ).toEqual([
    {
      filePath: 'server.ts',
      range: { startLineNumber: 1, startColumn: 14, endLineNumber: 1, endColumn: 20 }
    }
  ])
})

it('updates cached definition targets after an on-disk reexport changes', async () => {
  const original = await server.query(request())
  expect(original.locations.map((entry) => relative(root, entry.filePath))).toEqual(['server.ts'])
  await writeFile(join(root, 'index.ts'), "export { Server as Service } from './unrelated'")
  await server.filesChanged([{ kind: 'update', absolutePath: join(root, 'index.ts') }])
  const updated = await server.query(request())
  expect(
    updated.locations.map((entry) => ({
      ...entry,
      filePath: relative(root, entry.filePath)
    }))
  ).toEqual([
    {
      filePath: 'unrelated.ts',
      range: { startLineNumber: 1, startColumn: 14, endLineNumber: 1, endColumn: 20 }
    }
  ])
})
