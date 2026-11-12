// @vitest-environment happy-dom
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerWorkspaceDefinitions } from './monaco-ts-workspace-definitions'
import { registerWorkspaceReferences } from './monaco-ts-workspace-references'
import { modelContextByUri } from './monaco-ts-workspace-models'
import { queryTypeScriptProject } from './monaco-ts-project-service'
import { queryWorkspaceSymbol } from './monaco-ts-workspace-navigation'
import { toEditorModelUri } from './model-lifetime/identity/editor-model-uri'
import type { EditorBufferKeptRecords } from '@/store/slices/editor/buffers/editor-buffer-kept'

type OpenBuffer = { filePath: string; worktreeId: string; runtimeEnvironmentId?: string | null }
const state = vi.hoisted(
  (): { openFiles: OpenBuffer[]; editorBufferKept: EditorBufferKeptRecords } => ({
    openFiles: [],
    editorBufferKept: {}
  })
)
vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))

beforeEach(() => {
  vi.stubGlobal('Worker', class {})
  vi.spyOn(monaco.editor, 'createWebWorker').mockReturnValue({
    getProxy: async () => ({ query: queryTypeScriptProject }),
    withSyncedResources: async () => ({ query: queryTypeScriptProject }),
    dispose() {}
  })
})

afterEach(() => {
  monaco.editor.getModels().forEach((model) => model.dispose())
  modelContextByUri.clear()
  state.openFiles = []
  state.editorBufferKept = {}
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('does not turn unrelated Server name matches into definitions or references', async () => {
  const model = monaco.editor.createModel(
    'new Server()',
    'typescript',
    monaco.Uri.file('/repo/use.ts')
  )
  modelContextByUri.set(model.uri.toString(), {
    filePath: '/repo/use.ts',
    relativePath: 'use.ts',
    worktreeId: 'workspace',
    worktreePath: '/repo',
    readContext: { target: { kind: 'local' }, worktreeId: 'workspace', worktreePath: '/repo' },
    assertAuthorityCurrent() {}
  })
  vi.stubGlobal('api', {
    fs: {
      search: async () => ({
        files: [
          {
            filePath: '/repo/unrelated.ts',
            matches: [
              { line: 1, column: 14, matchLength: 6, lineContent: 'export class Server {}' }
            ]
          }
        ]
      }),
      listFiles: async () => ['use.ts', 'unrelated.ts'],
      readFile: async ({ filePath }: { filePath: string }) => {
        if (filePath === '/repo/unrelated.ts') {
          return { content: 'export class Server {}' }
        }
        throw new Error('missing')
      }
    }
  })
  let definitions: monaco.languages.DefinitionProvider | undefined
  let references: monaco.languages.ReferenceProvider | undefined
  const api = {
    ...monaco,
    languages: {
      ...monaco.languages,
      registerDefinitionProvider: (
        _language: unknown,
        provider: monaco.languages.DefinitionProvider
      ) => {
        definitions = provider
        return { dispose() {} }
      },
      registerReferenceProvider: (
        _language: unknown,
        provider: monaco.languages.ReferenceProvider
      ) => {
        references = provider
        return { dispose() {} }
      }
    }
  }
  registerWorkspaceDefinitions(api)
  registerWorkspaceReferences(api)
  api.languages.registerDefinitionProvider('typescript', { provideDefinition: () => [] })
  api.languages.registerReferenceProvider('typescript', { provideReferences: () => [] })
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} })
  }
  const position = new monaco.Position(1, 6)
  expect.soft(await definitions!.provideDefinition(model, position, token)).toEqual([])
  expect(
    await references!.provideReferences(model, position, { includeDeclaration: true }, token)
  ).toEqual([])
})

it('resolves a source definition when ignored build output would exhaust the project inventory', async () => {
  const content = "import { Server } from './server'\nnew Server()"
  const model = monaco.editor.createModel(content, 'typescript', monaco.Uri.file('/repo/use.ts'))
  modelContextByUri.set(model.uri.toString(), {
    filePath: '/repo/use.ts',
    relativePath: 'use.ts',
    worktreeId: 'workspace',
    worktreePath: '/repo',
    readContext: { target: { kind: 'local' }, worktreeId: 'workspace', worktreePath: '/repo' },
    assertAuthorityCurrent() {}
  })
  vi.stubGlobal('api', {
    fs: {
      listFiles: async ({ includeIgnored }: { includeIgnored?: boolean }) =>
        includeIgnored === false
          ? ['use.ts', 'server.ts']
          : ['use.ts', 'server.ts', ...Array.from({ length: 100_001 }, (_, i) => `dist/${i}.js`)],
      readFile: async ({ filePath }: { filePath: string }) => {
        if (filePath === '/repo/server.ts') {
          return { content: 'export class Server {}' }
        }
        throw new Error('missing')
      }
    }
  })
  const locations = await queryWorkspaceSymbol(
    monaco,
    model,
    new monaco.Position(2, 7),
    { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    'definition'
  )
  expect(locations?.map(({ uri, range }) => [uri.toString(), range])).toEqual([
    [
      'file:///repo/server.ts',
      { startLineNumber: 1, startColumn: 14, endLineNumber: 1, endColumn: 20 }
    ]
  ])
})

it('returns a known definition without requiring unrelated missing dependencies', async () => {
  const model = monaco.editor.createModel(
    [
      'export class Server {}',
      ...Array.from({ length: 2000 }, (_, index) => `import 'optional-package-${index}'`),
      'new Server()'
    ].join('\n'),
    'typescript',
    monaco.Uri.file('/repo/use.ts')
  )
  modelContextByUri.set(model.uri.toString(), {
    filePath: '/repo/use.ts',
    relativePath: 'use.ts',
    worktreeId: 'workspace',
    worktreePath: '/repo',
    readContext: { target: { kind: 'local' }, worktreeId: 'workspace', worktreePath: '/repo' },
    assertAuthorityCurrent() {}
  })
  vi.stubGlobal('api', {
    fs: {
      listFiles: async () => ['use.ts'],
      readFile: async () => {
        throw new Error('missing')
      }
    }
  })
  const locations = await queryWorkspaceSymbol(
    monaco,
    model,
    new monaco.Position(model.getLineCount(), 7),
    { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
    'definition'
  )
  expect(locations?.map(({ uri, range }) => [uri.toString(), range])).toEqual([
    [
      'file:///repo/use.ts',
      { startLineNumber: 1, startColumn: 14, endLineNumber: 1, endColumn: 20 }
    ]
  ])
})

it('resolves aliases and reexports in the selected project and reads unsaved buffers on their owning host', async () => {
  const disk: Record<string, string> = {
    '/repo/tsconfig.json': '{ "references": [{"path":"./app"}, {"path":"./other"}], "files": [] }',
    '/repo/app/tsconfig.json': '{ "extends":"../base.json", "include":["**/*"] }',
    '/repo/base.json': '{ "compilerOptions": { "baseUrl":"./app", "paths":{"@/*":["./*"]} } }',
    '/repo/app/server.ts': 'export class Server {}\n// Server\nconst text = "Server"',
    '/repo/app/index.ts': "export { Server as Service } from './server'",
    '/repo/app/use.ts': "import { Service } from '@/index'\nnew Service()",
    '/repo/app/other.ts': 'export class Server {}\nnew Server()\n// Server\nconst text = "Server"',
    '/repo/other/tsconfig.json': '{}',
    '/repo/other/server.ts': 'export class Server {}'
  }
  const source = monaco.editor.createModel(
    disk['/repo/app/server.ts'],
    'typescript',
    monaco.Uri.parse(toEditorModelUri('/repo/app/server.ts', 'ssh:host'))
  )
  const unsaved = monaco.editor.createModel(
    "import { Service as Renamed } from '@/index'\nnew Renamed()",
    'typescript',
    monaco.Uri.parse(toEditorModelUri('/repo/app/use.ts', 'ssh:host'))
  )
  monaco.editor.createModel(
    'export class Server { wrongHost = true }',
    'typescript',
    monaco.Uri.file('/repo/app/server.ts')
  )
  state.openFiles = [
    { filePath: '/repo/app/use.ts', worktreeId: 'remote', runtimeEnvironmentId: undefined }
  ]
  const ctx = {
    filePath: '/repo/app/server.ts',
    relativePath: 'app/server.ts',
    worktreePath: '/repo',
    worktreeId: 'remote',
    modelOwnerKey: 'ssh:host',
    connectionId: 'host',
    readContext: {
      target: { kind: 'local' as const },
      worktreeId: 'remote',
      worktreePath: '/repo',
      connectionId: 'host'
    },
    assertAuthorityCurrent() {}
  }
  modelContextByUri.set(source.uri.toString(), ctx)
  modelContextByUri.set(unsaved.uri.toString(), {
    ...ctx,
    filePath: '/repo/app/use.ts',
    fileId: 'use-view',
    relativePath: 'app/use.ts'
  })
  vi.stubGlobal('api', {
    fs: {
      listFiles: async ({ connectionId }: { connectionId?: string }) => {
        if (connectionId !== 'host') {
          throw new Error('wrong host')
        }
        return Object.keys(disk)
      },
      readFile: async ({ filePath, connectionId }: { filePath: string; connectionId?: string }) => {
        if (connectionId !== 'host' || !(filePath in disk)) {
          throw new Error('missing')
        }
        return { content: disk[filePath] }
      }
    }
  })
  const api = monaco
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} })
  }
  const refs = await queryWorkspaceSymbol(
    api,
    source,
    { lineNumber: 1, column: 15 },
    token,
    'references',
    false
  )
  const expectedReferences = [
    ['/repo/app/index.ts', 1, 10],
    ['/repo/app/index.ts', 1, 20],
    ['/repo/app/use.ts', 1, 10],
    ['/repo/app/use.ts', 1, 21],
    ['/repo/app/use.ts', 2, 5]
  ]
  expect(
    refs?.map((entry) => [entry.uri.path, entry.range.startLineNumber, entry.range.startColumn])
  ).toEqual(expectedReferences)
  expect(refs?.every((entry) => entry.uri.authority === source.uri.authority)).toBe(true)
  state.openFiles = []
  state.editorBufferKept = {
    retained: {
      record: { isDirty: true },
      draft: unsaved.getValue(),
      viewIds: ['use-view'],
      notice: 1
    }
  }
  const keptRefs = await queryWorkspaceSymbol(
    api,
    source,
    { lineNumber: 1, column: 15 },
    token,
    'references',
    false
  )
  expect(
    keptRefs?.map((entry) => [entry.uri.path, entry.range.startLineNumber, entry.range.startColumn])
  ).toEqual(expectedReferences)
  const defs = await queryWorkspaceSymbol(
    api,
    unsaved,
    { lineNumber: 2, column: 8 },
    token,
    'definition'
  )
  expect(defs?.map((entry) => [entry.uri.path, entry.range.startColumn])).toEqual([
    ['/repo/app/server.ts', 14]
  ])
  expect(unsaved.getValue()).toBe("import { Service as Renamed } from '@/index'\nnew Renamed()")
})

it.each([
  {
    name: 'TSX',
    expectedFile: '/repo/server.tsx',
    server: '/repo/server.tsx',
    use: '/repo/use.tsx',
    declaration: 'export class Server {}',
    content: "import { Server } from './server'\nconst view: unknown = <Server />",
    column: 14
  },
  {
    name: 'JSX',
    expectedFile: '/repo/server.jsx',
    server: '/repo/server.jsx',
    use: '/repo/use.jsx',
    declaration: 'export class Server {}',
    content: "import { Server } from './server'\nconst view = <Server />",
    column: 14
  },
  {
    name: 'CommonJS',
    expectedFile: '/repo/server.cjs',
    server: '/repo/server.cjs',
    use: '/repo/use.cjs',
    declaration: 'class Server {}\nmodule.exports = { Server }',
    content: "const { Server } = require('./server.cjs')\nnew Server()",
    column: 7
  },
  {
    name: 'NodeNext TypeScript',
    expectedFile: 'c:/repo/server.mts',
    server: 'C:/repo/server.mts',
    use: 'C:/repo/use.mts',
    declaration: 'export class Server {}',
    content: "import { Server } from './server.mjs'\nnew Server()",
    column: 14
  }
])(
  'resolves $name modules without confusing another Server',
  ({ server, use, declaration, content, column, expectedFile }) => {
    const root = server.startsWith('C:') ? 'C:/repo' : '/repo'
    const files = {
      [`${root}/tsconfig.json`]:
        '{"compilerOptions":{"allowJs":true,"module":"NodeNext","moduleResolution":"NodeNext","jsx":"preserve"}}',
      [server]: declaration,
      [use]: content,
      [`${root}/unrelated.ts`]: 'export class Server {}\nnew Server()'
    }
    const result = queryTypeScriptProject({
      rootPath: root,
      filePath: use,
      offset: content.lastIndexOf('Server') + 2,
      kind: 'definition',
      includeDeclaration: true,
      fileNames: Object.keys(files),
      files
    })
    expect(
      result.locations.map((entry) => [
        entry.filePath,
        entry.range.startLineNumber,
        entry.range.startColumn
      ])
    ).toEqual([[expectedFile, 1, column]])
  }
)
