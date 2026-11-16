// @vitest-environment happy-dom
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { afterEach, expect, it, vi } from 'vitest'
import { captureNavigationBuffers } from './monaco-ts-navigation-buffers'
import { modelContextByUri, type ModelWorkspaceContext } from './monaco-ts-workspace-models'
import { toEditorModelUri } from './model-lifetime/identity/editor-model-uri'
import type { EditorBufferKeptRecords } from '@/store/slices/editor/buffers/editor-buffer-kept'

const state = vi.hoisted(
  (): {
    openFiles: { filePath: string; worktreeId: string; runtimeEnvironmentId?: string }[]
    editorBufferKept: EditorBufferKeptRecords
  } => ({ openFiles: [], editorBufferKept: {} })
)
vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))

afterEach(() => {
  monaco.editor.getModels().forEach((model) => model.dispose())
  modelContextByUri.clear()
  state.openFiles = []
  state.editorBufferKept = {}
})

it('uses the queried diff buffer instead of another model for the same file', () => {
  const context: ModelWorkspaceContext = {
    filePath: '/repo/use.ts',
    relativePath: 'use.ts',
    worktreeId: 'workspace',
    worktreePath: '/repo',
    readContext: { target: { kind: 'local' }, worktreeId: 'workspace', worktreePath: '/repo' },
    assertAuthorityCurrent() {}
  }
  monaco.editor.createModel('older source buffer', 'typescript', monaco.Uri.file('/repo/use.ts'))
  const diff = monaco.editor.createModel(
    'current diff buffer',
    'typescript',
    monaco.Uri.parse('dorca-diff:/use.ts')
  )
  state.openFiles = [{ filePath: '/repo/use.ts', worktreeId: 'workspace' }]
  expect(
    [...captureNavigationBuffers(monaco, context, diff)].map(([model, path]) => [
      path,
      model.getValue()
    ])
  ).toEqual([['/repo/use.ts', 'current diff buffer']])
})

it('captures open and retained drafts without taking closed or differently owned models', () => {
  const context: ModelWorkspaceContext = {
    filePath: '/repo/app/source.ts',
    relativePath: 'app/source.ts',
    worktreeId: 'workspace',
    worktreePath: '/repo',
    projectRootPath: '/repo/app',
    readContext: { target: { kind: 'local' }, worktreeId: 'workspace', worktreePath: '/repo' },
    assertAuthorityCurrent() {}
  }
  const create = (filePath: string, content: string, fileId?: string): monaco.editor.ITextModel => {
    const model = monaco.editor.createModel(content, 'typescript', monaco.Uri.file(filePath))
    modelContextByUri.set(model.uri.toString(), { ...context, filePath, fileId })
    return model
  }
  const source = create('/repo/app/source.ts', 'source draft')
  create('/repo/app/open.ts', 'open draft')
  create('/repo/app/kept.ts', 'retained draft', 'kept-view')
  create('/repo/app/closed.ts', 'closed draft')
  create('/repo/other/outside.ts', 'different project')
  create('/repo/app/remote.ts', 'different host')
  const otherOwner = monaco.editor.createModel(
    'different owner',
    'typescript',
    monaco.Uri.parse(toEditorModelUri('/repo/app/closed.ts', 'other-owner'))
  )
  modelContextByUri.set(otherOwner.uri.toString(), {
    ...context,
    filePath: '/repo/app/closed.ts',
    fileId: 'other-view',
    modelOwnerKey: 'other-owner'
  })
  state.openFiles = [
    { filePath: '/repo/app/open.ts', worktreeId: 'workspace' },
    { filePath: '/repo/other/outside.ts', worktreeId: 'workspace' },
    {
      filePath: '/repo/app/remote.ts',
      worktreeId: 'workspace',
      runtimeEnvironmentId: 'remote'
    }
  ]
  state.editorBufferKept = {
    retained: {
      record: { isDirty: true },
      draft: 'retained draft',
      viewIds: ['kept-view', 'other-view'],
      notice: 1
    }
  }

  expect(
    [...captureNavigationBuffers(monaco, context, source)].map(([model, filePath]) => [
      filePath,
      model.getValue()
    ])
  ).toEqual([
    ['/repo/app/source.ts', 'source draft'],
    ['/repo/app/open.ts', 'open draft'],
    ['/repo/app/kept.ts', 'retained draft']
  ])
})
