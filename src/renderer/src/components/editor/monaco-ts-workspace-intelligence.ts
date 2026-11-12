import type * as Monaco from 'monaco-editor'
import { translate } from '@/i18n/i18n'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { findFirstIndexedWorktree as findWorktreeById } from '@/lib/workspace/ownership/worktree-runtime-owner-index'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { acquireEditorFileOperation } from '@/lib/editor/file-operations/editor-file-operation-owner'
import { registerEditorForNavigationHistory } from '@/lib/workspace-navigation-history'
import { toEditorModelUri } from './model-lifetime/identity/editor-model-uri'
import { modelContextByUri, TS_WORKSPACE_LANGUAGE_IDS } from './monaco-ts-workspace-models'
import { prepareHostTypeScriptNavigation } from './monaco-ts-host-navigation'
import { computeRelativePath } from './monaco-ts-workspace-imports'
import { registerWorkspaceReferences } from './monaco-ts-workspace-references'
import { registerWorkspaceDefinitions } from './monaco-ts-workspace-definitions'
import { registerWorkspaceEditorOpener } from './monaco-ts-workspace-opener'

export function installMonacoTypeScriptWorkspaceIntelligence(monaco: typeof Monaco): void {
  const sharedCompilerOptions: Monaco.typescript.CompilerOptions = {
    ...monaco.typescript.typescriptDefaults.getCompilerOptions(),
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    allowJs: true,
    jsx: monaco.typescript.JsxEmit.Preserve
  }
  monaco.typescript.typescriptDefaults.setCompilerOptions(sharedCompilerOptions)
  monaco.typescript.javascriptDefaults.setCompilerOptions(sharedCompilerOptions)

  for (const defaults of [
    monaco.typescript.typescriptDefaults,
    monaco.typescript.javascriptDefaults
  ]) {
    defaults.setModeConfiguration({
      ...defaults.modeConfiguration,
      definitions: false,
      references: false
    })
  }

  registerWorkspaceReferences(monaco)
  registerWorkspaceDefinitions(monaco)
  registerWorkspaceEditorOpener(monaco)
}

export function registerEditorInstanceForTsWorkspace(
  editorInstance: editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  params: {
    fileId: string
    filePath: string
    worktreeId?: string
    modelOwnerKey?: string
  }
): () => void {
  const { fileId, filePath, worktreeId, modelOwnerKey } = params
  const state = useAppStore.getState()
  const worktree = worktreeId
    ? findWorktreeById(selectWorktreesByRepo(state), worktreeId)
    : undefined
  const openFile = state.openFiles?.find((f) => f.id === fileId)
  let resolvedRelativePath =
    openFile?.relativePath || (worktree ? computeRelativePath(worktree.path, filePath) : filePath)

  if (openFile && worktreeId) {
    const modelUriStr = toEditorModelUri(filePath, modelOwnerKey)
    try {
      const operation = acquireEditorFileOperation(useAppStore.getState, openFile)
      const worktreePath = operation.context.worktreePath
      if (worktreePath) {
        resolvedRelativePath = openFile.relativePath || computeRelativePath(worktreePath, filePath)
        modelContextByUri.set(modelUriStr, {
          filePath,
          fileId,
          relativePath: resolvedRelativePath,
          worktreeId,
          worktreePath,
          modelOwnerKey,
          runtimeEnvironmentId: openFile?.runtimeEnvironmentId,
          connectionId: operation.context.connectionId,
          readContext: operation.context,
          assertAuthorityCurrent: operation.assertAuthorityCurrent,
          projectRootPath: operation.provenance.childRepo?.path
        })
        const model = editorInstance.getModel()
        const context = modelContextByUri.get(modelUriStr)
        if (model && context && TS_WORKSPACE_LANGUAGE_IDS.includes(model.getLanguageId())) {
          prepareHostTypeScriptNavigation(context, model)
        }
      } else {
        modelContextByUri.delete(modelUriStr)
      }
    } catch {
      modelContextByUri.delete(modelUriStr)
    }
  }

  const disposeNavHistory = registerEditorForNavigationHistory(
    fileId,
    filePath,
    resolvedRelativePath,
    worktreeId,
    openFile?.runtimeEnvironmentId,
    editorInstance
  )

  const findAllReferencesAction = editorInstance.addAction({
    id: 'dorca.findAllReferences',
    label: translate('dorca.findAllReferences', 'Find All References'),
    keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.F12],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.4,
    run: (ed) => {
      ed.trigger('dorca', 'editor.action.referenceSearch.trigger', null)
    }
  })

  return () => {
    disposeNavHistory()
    findAllReferencesAction.dispose()
  }
}
