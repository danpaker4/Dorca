import type * as Monaco from 'monaco-editor'
import { useEffect, type RefObject } from 'react'
import { monaco } from '@/lib/editor/monaco/monaco-setup'
import { applyModelLanguage } from '@/lib/monaco-languages/plugin-syntax-editor-options'
import { useAppStore } from '@/store'
import { getEditorModelOwnerKey } from '../../model-lifetime/identity/editor-model-owner'
import { registerEditorInstanceForTsWorkspace } from '../../monaco-ts-workspace-intelligence'

export function useDiffEditorLanguageNavigation(
  ref: RefObject<Monaco.editor.IStandaloneDiffEditor | null>,
  mounted: Monaco.editor.ICodeEditor | null,
  fileId: string | undefined,
  filePath: string,
  worktreeId: string | undefined,
  modifiedIsHistorical: boolean,
  language: string
): void {
  useEffect(() => {
    const models = ref.current?.getModel()
    applyModelLanguage([models?.original, models?.modified], language)
  }, [ref, mounted, language])
  useEffect(() => {
    const diff = ref.current
    if (!diff || !fileId) {
      return
    }
    return registerDiffEditorLanguageNavigation(diff, monaco, {
      fileId,
      filePath,
      worktreeId,
      modifiedIsHistorical
    })
  }, [ref, mounted, fileId, filePath, worktreeId, modifiedIsHistorical])
}

export function registerDiffEditorLanguageNavigation(
  diff: Monaco.editor.IStandaloneDiffEditor,
  monaco: typeof Monaco,
  params: {
    fileId: string
    filePath: string
    worktreeId?: string
    modifiedIsHistorical: boolean
    trackHistory?: boolean
  }
): () => void {
  let deletedLine = false
  const modifiedEditor = diff.getModifiedEditor()
  const node = modifiedEditor.getContainerDomNode()
  const pointer = (event: PointerEvent): void => {
    // Monaco paints inline deletions in view zones owned by the modified editor.
    deletedLine =
      event.target instanceof Element && Boolean(event.target.closest('.view-lines.line-delete'))
  }
  node.addEventListener('pointerdown', pointer, true)
  const cursor = modifiedEditor.onDidChangeCursorPosition((event) => {
    if (event.source === 'keyboard') {
      deletedLine = false
    }
  })
  let disposeModels = (): void => {}
  const attach = (): void => {
    disposeModels()
    const state = useAppStore.getState()
    const file = state.openFiles.find((entry) => entry.id === params.fileId)
    if (!file) {
      return
    }
    const modelOwnerKey = getEditorModelOwnerKey(file, state)
    const original = registerEditorInstanceForTsWorkspace(diff.getOriginalEditor(), monaco, {
      ...params,
      modelOwnerKey,
      historical: true,
      trackHistory: false
    })
    const modified = registerEditorInstanceForTsWorkspace(diff.getModifiedEditor(), monaco, {
      ...params,
      modelOwnerKey,
      historical: params.modifiedIsHistorical,
      isHistorical: () => deletedLine,
      trackHistory: params.trackHistory
    })
    disposeModels = () => {
      original()
      modified()
    }
  }
  attach()
  const models = diff.onDidChangeModel(attach)
  return () => {
    node.removeEventListener('pointerdown', pointer, true)
    cursor.dispose()
    models.dispose()
    disposeModels()
  }
}
