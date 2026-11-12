import { expect, it } from 'vitest'
import { queryTypeScriptProject } from './monaco-ts-project-service'

it('returns a resolved definition while unrelated workspace imports are still unloaded', () => {
  const content = "import { Server } from './server'\nnew Server()"
  const result = queryTypeScriptProject({
    rootPath: '/repo',
    filePath: '/repo/use.ts',
    offset: content.lastIndexOf('Server') + 2,
    kind: 'definition',
    includeDeclaration: true,
    fileNames: ['/repo/use.ts', '/repo/server.ts', '/repo/other.ts'],
    files: {
      '/repo/tsconfig.json': null,
      '/repo/jsconfig.json': null,
      '/repo/use.ts': content,
      '/repo/server.ts': "import './other'\nexport class Server {}"
    }
  })
  expect(result.locations).toEqual([
    {
      filePath: '/repo/server.ts',
      range: { startLineNumber: 2, startColumn: 14, endLineNumber: 2, endColumn: 20 }
    }
  ])
})
