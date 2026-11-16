import { useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react'
import { editor, KeyCode, KeyMod } from 'monaco-editor'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useTranslate, useIntlLocale } from '@/i18n/use-translate'
import type { GitBlameLine, GitBlameSnapshot } from '../../../../../shared/git/blame/git-blame'
import { blameLabel } from './git-blame-presentation'
import { getInclusiveEndLine } from '../contextual-copy/selection-copy'

type LineTarget = { filePath: string; line: number; revision?: string; initial: GitBlameLine }
export type BlameSelection = { target: LineTarget; newer: LineTarget[]; x: number; y: number }

export function useMonacoBlameDecorations({
  source,
  enabled,
  mode,
  relativePath,
  revision,
  snapshot,
  snapshotRef,
  selected,
  pinned,
  focusCard,
  keepOpen,
  closeSoon,
  setSelection
}: {
  source: editor.IStandaloneCodeEditor | null
  enabled: boolean
  mode: 'off' | 'current-line' | 'file'
  relativePath: string
  revision?: string
  snapshot: GitBlameSnapshot | null
  snapshotRef: RefObject<GitBlameSnapshot | null>
  selected: RefObject<BlameSelection | null>
  pinned: RefObject<boolean>
  focusCard: RefObject<boolean>
  keepOpen: () => void
  closeSoon: () => void
  setSelection: Dispatch<SetStateAction<BlameSelection | null>>
}): void {
  const t = useTranslate()
  const locale = useIntlLocale()
  useEffect(() => {
    let hoverTimer: ReturnType<typeof setTimeout> | undefined
    if (!source || !enabled) {
      return
    }
    const show = (line: number, force = false): void => {
      if (pinned.current && selected.current && !force) {
        return
      }
      const attribution = snapshotRef.current?.lines.find((entry) => entry.line === line)
      if (!attribution) {
        return
      }
      keepOpen()
      if (selected.current?.target.line === line && selected.current.target.revision === revision) {
        if (force) {
          setSelection({ ...selected.current })
        }
        return
      }
      const position = source.getScrolledVisiblePosition({
        lineNumber: line,
        column: source.getModel()?.getLineMaxColumn(line) ?? 1
      })
      const bounds = source.getContainerDomNode().getBoundingClientRect()
      setSelection({
        target: { filePath: relativePath, line, revision, initial: attribution },
        newer: [],
        x: Math.max(bounds.left, Math.min(bounds.right - 24, bounds.left + (position?.left ?? 0))),
        y: bounds.top + (position?.top ?? 0) + (position?.height ?? 0)
      })
    }
    const widgets: editor.IContentWidget[] = []
    const clearWidgets = (): void => {
      for (const widget of widgets.splice(0)) {
        source.removeContentWidget(widget)
      }
    }
    let painted = ''
    const clear = (): void => {
      snapshotRef.current = null
      clearWidgets()
      setSelection(null)
    }
    const render = (): void => {
      const model = source.getModel()
      const ranges = source.getVisibleRanges()
      const annotatedRanges =
        mode === 'file'
          ? ranges
          : (source.getSelections() ?? []).map((selection) => ({
              startLineNumber: selection.startLineNumber,
              endLineNumber: getInclusiveEndLine(selection)
            }))
      const layout = source.getLayoutInfo()
      const fontFamily = source.getOption(editor.EditorOption.fontFamily)
      const fontSize = source.getOption(editor.EditorOption.fontSize)
      const lineHeight = source.getOption(editor.EditorOption.lineHeight)
      const key = JSON.stringify([
        model?.uri.toString(),
        mode,
        annotatedRanges,
        ranges,
        layout.width,
        source.getScrollLeft(),
        fontFamily,
        fontSize,
        lineHeight
      ])
      if (painted === key) {
        return
      }
      painted = key
      clearWidgets()
      if (!model || !snapshotRef.current || mode === 'off') {
        return
      }
      for (const line of snapshotRef.current.lines) {
        if (
          line.line > model.getLineCount() ||
          !ranges.some(
            (range) => line.line >= range.startLineNumber && line.line <= range.endLineNumber
          ) ||
          !annotatedRanges.some(
            (range) => line.line >= range.startLineNumber && line.line <= range.endLineNumber
          )
        ) {
          continue
        }
        const position = { lineNumber: line.line, column: model.getLineMaxColumn(line.line) }
        const visible = source.getScrolledVisiblePosition(position)
        if (!visible) {
          continue
        }
        const width =
          layout.width - Math.max(layout.contentLeft, visible.left) - layout.verticalScrollbarWidth
        if (width < 16) {
          continue
        }
        const node = document.createElement('span')
        node.className = 'git-blame-annotation'
        node.textContent = blameLabel(line, locale, t).slice(0, 180)
        node.style.maxWidth = `${width}px`
        node.style.fontFamily = fontFamily
        node.style.fontSize = `${fontSize}px`
        node.style.lineHeight = `${lineHeight}px`
        node.onpointerenter = () => {
          clearTimeout(hoverTimer)
          keepOpen()
          hoverTimer = setTimeout(() => show(line.line), 250)
        }
        node.onpointerleave = () => {
          clearTimeout(hoverTimer)
          closeSoon()
        }
        node.onclick = () => {
          pinned.current = true
          show(line.line, true)
        }
        const widget: editor.IContentWidget = {
          getId: () => `dorca.blame.${source.getId()}.${line.line}`,
          getDomNode: () => node,
          getPosition: () => ({
            position,
            preference: [editor.ContentWidgetPositionPreference.EXACT]
          })
        }
        widgets.push(widget)
        source.addContentWidget(widget)
      }
    }
    render()
    if (focusCard.current && snapshot) {
      show(source.getPosition()?.lineNumber ?? 1, true)
    }
    const content = source.onDidChangeModelContent(clear)
    const model = source.onDidChangeModel(clear)
    const cursor = source.onDidChangeCursorSelection(render)
    const scroll = source.onDidScrollChange((event) => {
      if (event.scrollTopChanged || event.scrollLeftChanged) {
        render()
      }
      if ((event.scrollTopChanged || event.scrollLeftChanged) && !pinned.current) {
        setSelection(null)
      }
    })
    const layout = source.onDidLayoutChange(() => {
      render()
      if (!pinned.current) {
        setSelection(null)
      }
    })
    const configuration = source.onDidChangeConfiguration(render)
    const leave = (): void => {
      clearTimeout(hoverTimer)
      closeSoon()
    }
    const editorNode = source.getContainerDomNode()
    editorNode.addEventListener('pointerleave', leave)
    const actions = [
      source.addAction({
        id: 'dorca.toggleFileBlame',
        label: translate('dorca.blame.toggle', 'Git: Toggle File Blame'),
        keybindings: [KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB],
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 3,
        run: () =>
          useAppStore
            .getState()
            .updateSettings({ editorGitBlameMode: mode === 'file' ? 'current-line' : 'file' })
      }),
      source.addAction({
        id: 'dorca.showLineBlame',
        label: translate('dorca.blame.show', 'Git: Show Line History'),
        keybindings: [KeyMod.Alt | KeyCode.F8],
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 4,
        run: () => {
          focusCard.current = true
          if (mode === 'off') {
            void useAppStore.getState().updateSettings({ editorGitBlameMode: 'current-line' })
          } else {
            pinned.current = true
            show(source.getPosition()?.lineNumber ?? 1, true)
          }
        }
      })
    ]
    return () => {
      clearTimeout(hoverTimer)
      keepOpen()
      clearWidgets()
      for (const disposable of [
        content,
        model,
        cursor,
        scroll,
        layout,
        configuration,
        ...actions
      ]) {
        disposable.dispose()
      }
      editorNode.removeEventListener('pointerleave', leave)
    }
  }, [
    source,
    enabled,
    mode,
    relativePath,
    revision,
    snapshot,
    closeSoon,
    keepOpen,
    snapshotRef,
    selected,
    pinned,
    focusCard,
    setSelection,
    locale,
    t
  ])
}
