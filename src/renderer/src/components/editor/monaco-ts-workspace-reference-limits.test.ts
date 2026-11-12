// @vitest-environment happy-dom
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createTypeScriptProjectQuery } from './monaco-ts-project-service'
import { queryWorkspaceSymbol } from './monaco-ts-workspace-navigation'
import { modelContextByUri } from './monaco-ts-workspace-models'

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ openFiles: [], editorBufferKept: {} }) }
}))

beforeEach(() => {
  vi.stubGlobal('Worker', class {})
  const query = createTypeScriptProjectQuery()
  vi.spyOn(monaco.editor, 'createWebWorker').mockReturnValue({
    getProxy: async () => ({ query }),
    withSyncedResources: async () => ({ query }),
    dispose() {}
  })
})

afterEach(() => {
  monaco.editor.getModels().forEach((model) => model.dispose())
  modelContextByUri.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function references(
  disk: Record<string, string>,
  column = 15
): Promise<[string, number, number][] | undefined> {
  const model = monaco.editor.createModel(
    disk['/repo/server.ts'],
    'typescript',
    monaco.Uri.file('/repo/server.ts')
  )
  modelContextByUri.set(model.uri.toString(), {
    filePath: '/repo/server.ts',
    relativePath: 'server.ts',
    worktreeId: 'workspace',
    worktreePath: '/repo',
    readContext: { target: { kind: 'local' }, worktreeId: 'workspace', worktreePath: '/repo' },
    assertAuthorityCurrent() {}
  })
  vi.stubGlobal('api', {
    fs: {
      search: async ({ query }: { query: string }) => {
        const pattern = new RegExp(query)
        const matches = Object.entries(disk).filter(([, content]) => pattern.test(content))
        return {
          files: matches.map(([filePath]) => ({
            filePath,
            relativePath: filePath.slice(6),
            matches: []
          })),
          totalMatches: matches.length,
          truncated: false
        }
      },
      listFiles: async () => Object.keys(disk),
      pathsExist: async ({ filePaths }: { filePaths: string[] }) =>
        filePaths.map((filePath) => ({ exists: filePath in disk })),
      readFile: async ({ filePath }: { filePath: string }) => {
        if (!(filePath in disk)) {
          throw new Error('missing')
        }
        return { content: disk[filePath] }
      }
    }
  })
  const locations = await queryWorkspaceSymbol(
    monaco,
    model,
    new monaco.Position(1, column),
    { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    'references',
    false
  )
  return locations?.map(({ uri, range }): [string, number, number] => [
    uri.path,
    range.startLineNumber,
    range.startColumn
  ])
}

it('finds semantic references when the project exceeds the former snapshot budget', async () => {
  expect(
    await references({
      '/repo/server.ts': 'export class Server {}\nnew Server()',
      '/repo/use.ts': "import { Server } from './server'\nnew Server()",
      '/repo/unrelated.ts': `export class Server {}\n/*${'x'.repeat(34 * 1024 * 1024)}*/`
    })
  ).toEqual([
    ['/repo/server.ts', 2, 5],
    ['/repo/use.ts', 1, 10],
    ['/repo/use.ts', 2, 5]
  ])
})

it('finds semantic references without charging absent module candidates as loaded source files', async () => {
  expect(
    await references({
      '/repo/server.ts': 'export class Server {}\nnew Server()',
      '/repo/use.ts': [
        "import { Server } from './server'",
        'new Server()',
        ...Array.from({ length: 2000 }, (_, index) => `import 'optional-package-${index}'`)
      ].join('\n')
    })
  ).toEqual([
    ['/repo/server.ts', 2, 5],
    ['/repo/use.ts', 1, 10],
    ['/repo/use.ts', 2, 5]
  ])
})

it('follows renamed reexports without returning unrelated names', async () => {
  const result = await references({
    '/repo/server.ts': 'export class Server {}\nnew Server()',
    '/repo/index.ts': "export { Server as Service } from './server'",
    '/repo/middle.ts': "export { Service as Api } from './index'",
    '/repo/use.ts': "import { Api as Renamed } from './middle'\nnew Renamed()",
    '/repo/unrelated.ts': 'export class Server {}\nnew Server()\n// Service Api Renamed'
  })
  expect(
    result?.toSorted(
      ([a, lineA, columnA], [b, lineB, columnB]) =>
        a.localeCompare(b) || lineA - lineB || columnA - columnB
    )
  ).toEqual([
    ['/repo/index.ts', 1, 10],
    ['/repo/index.ts', 1, 20],
    ['/repo/middle.ts', 1, 10],
    ['/repo/middle.ts', 1, 21],
    ['/repo/server.ts', 2, 5],
    ['/repo/use.ts', 1, 10],
    ['/repo/use.ts', 1, 17],
    ['/repo/use.ts', 2, 5]
  ])
})

it('preserves the configured global context of script references', async () => {
  expect(
    await references(
      {
        '/repo/tsconfig.json': '{"files":["server.ts","globals.ts","use.ts"]}',
        '/repo/server.ts': 'class Server { run() {} }',
        '/repo/globals.ts': 'const subject = new Server()',
        '/repo/use.ts': 'subject.run()'
      },
      17
    )
  ).toEqual([['/repo/use.ts', 1, 9]])
})
