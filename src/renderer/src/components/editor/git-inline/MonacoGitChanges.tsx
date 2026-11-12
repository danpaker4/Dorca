import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { editor, KeyCode, KeyMod, Range } from 'monaco-editor'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  selectWorktreesByRepo,
  selectFolderWorkspaces
} from '@/store/workspaces/catalog/workspace-record-fields'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import { useWorktreeGitCopyHostId } from '@/lib/workspace/ownership/worktree-git-copy'
import { getRuntimeGitInlineSnapshot } from '@/runtime/source-control/git/runtime-git-inline-client'
import {
  getGitInlineHunks,
  normalizeGitEditorText,
  type GitInlineSnapshot
} from '../../../../../shared/git/diff/git-inline-hunks'
import { InlineGitPeek } from './InlineGitPeek'
import { resolveInlineGitContext } from './inline-git-context'
import { runInlineGitAction } from './inline-git-actions'
import './inline-git.css'

export function MonacoGitChanges({
  source,
  fileId,
  relativePath,
  enabled
}: {
  source: editor.IStandaloneCodeEditor | null
  fileId: string
  relativePath: string
  enabled: boolean
}): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<GitInlineSnapshot | null>(null)
  const [buffer, setBuffer] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [zone, setZone] = useState<HTMLDivElement | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const file = useAppStore((state) => state.openFiles.find((entry) => entry.id === fileId))
  const status = useAppStore((state) =>
    file?.worktreeId ? state.gitStatusByWorktree[file.worktreeId] : undefined
  )
  const hostId = useWorktreeGitCopyHostId(file?.worktreeId ?? null)
  const catalog = useAppStore(selectWorktreesByRepo)
  const folders = useAppStore(selectFolderWorkspaces)
  const worktreeId = file?.worktreeId
  const runtimeEnvironmentId = file?.runtimeEnvironmentId
  const context = useMemo(
    () =>
      enabled
        ? resolveInlineGitContext(worktreeId, runtimeEnvironmentId, hostId, catalog, folders)
        : null,
    [worktreeId, runtimeEnvironmentId, hostId, catalog, folders, enabled]
  )
  const invalidate = useCallback(() => {
    generation.current++
  }, [])
  const refresh = useCallback(async () => {
    if (!context) {
      return
    }
    const request = ++generation.current
    try {
      const result = await getRuntimeGitInlineSnapshot(context, relativePath)
      if (request === generation.current) {
        setSnapshot((old) => (old?.token === result.token ? old : result))
      }
    } catch {
      if (request === generation.current) {
        setSnapshot(null)
      }
    }
  }, [context, relativePath])
  useEffect(() => {
    setSnapshot(null)
    setSelected(null)
    if (!context) {
      return
    }
    const dispose = installWindowVisibilityInterval({
      run: () => void refresh(),
      intervalMs: 5000,
      slowWhileUnfocused: true
    })
    return () => {
      dispose()
      invalidate()
    }
  }, [refresh, context, invalidate])
  useEffect(() => {
    void refresh()
  }, [refresh, status])
  useEffect(() => {
    if (!source) {
      return
    }
    const update = (): void => {
      setBuffer(normalizeGitEditorText(source.getValue()))
      setSelected(null)
    }
    update()
    const disposable = source.onDidChangeModelContent(update)
    return () => disposable.dispose()
  }, [source])
  const headContent = snapshot?.headContent
  const indexContent = snapshot?.indexContent
  const headExists = snapshot?.headExists ?? false
  const indexExists = snapshot?.indexExists ?? false
  const diskExists = snapshot?.diskExists ?? false
  const changes = useMemo(() => {
    if (headContent === undefined || indexContent === undefined) {
      return []
    }
    try {
      const unstaged = getGitInlineHunks(indexContent, buffer, {
        originalExists: indexExists,
        modifiedExists: diskExists || buffer.length > 0
      })
      const staged = getGitInlineHunks(headContent, indexContent, {
        originalExists: headExists,
        modifiedExists: indexExists
      })
      const mapOffset = (offset: number): number => {
        let delta = 0
        for (const hunk of unstaged) {
          if (offset < hunk.originalStart) {
            break
          }
          if (offset <= hunk.originalEnd) {
            return hunk.modifiedStart
          }
          delta += hunk.modifiedEnd - hunk.modifiedStart - (hunk.originalEnd - hunk.originalStart)
        }
        return offset + delta
      }
      return [
        ...unstaged.map((hunk, hunkIndex) => ({
          hunk,
          staged: false,
          hunkIndex,
          line: hunk.lineNumber
        })),
        ...staged.map((hunk, hunkIndex) => ({
          hunk,
          staged: true,
          hunkIndex,
          line: buffer.slice(0, mapOffset(hunk.modifiedStart)).split('\n').length
        }))
      ].sort((a, b) => a.line - b.line || Number(a.staged) - Number(b.staged))
    } catch {
      return []
    }
  }, [headContent, indexContent, headExists, indexExists, diskExists, buffer])
  const current = selected === null ? undefined : changes[selected]
  const changesRef = useRef(changes)
  useEffect(() => {
    changesRef.current = changes
  }, [changes])
  useEffect(() => {
    if (!busyRef.current) {
      setSelected(null)
    }
  }, [
    snapshot?.headContent,
    snapshot?.indexContent,
    snapshot?.headExists,
    snapshot?.indexExists,
    snapshot?.diskExists
  ])
  useEffect(() => {
    if (!source || !enabled) {
      return
    }
    const mouse = source.onMouseDown((event) => {
      if (
        busyRef.current ||
        !event.event.leftButton ||
        !event.target.position ||
        (event.target.type !== editor.MouseTargetType.GUTTER_LINE_DECORATIONS &&
          event.target.type !== editor.MouseTargetType.GUTTER_GLYPH_MARGIN)
      ) {
        return
      }
      const line = event.target.position.lineNumber
      const staged = event.target.element?.classList.contains('git-inline-staged') ?? false
      const index = changesRef.current.findIndex(
        (change) =>
          change.staged === staged &&
          line >= Math.min(change.line, source.getModel()?.getLineCount() ?? 1) &&
          line <=
            Math.min(
              change.staged ? change.line : change.hunk.endLineNumber,
              source.getModel()?.getLineCount() ?? 1
            )
      )
      if (index !== -1) {
        setSelected(index)
        setError(null)
      }
    })
    const action = source.addAction({
      id: 'dorca.peekGitChange',
      label: translate('dorca.inlineGit.peek', 'Peek Git Change'),
      keybindings: [KeyMod.Alt | KeyCode.F7],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 2,
      run: () => {
        if (busyRef.current) {
          return
        }
        const line = source.getPosition()?.lineNumber ?? 1
        const index = changesRef.current.findIndex((change) => change.line >= line)
        if (changesRef.current.length) {
          setSelected(index === -1 ? 0 : index)
          setError(null)
        }
      }
    })
    return () => {
      mouse.dispose()
      action.dispose()
    }
  }, [source, enabled])
  useEffect(() => {
    if (!source || !enabled) {
      return
    }
    const decorations = source.createDecorationsCollection(
      changes.map((change) => ({
        range: new Range(
          Math.min(change.line, source.getModel()?.getLineCount() ?? 1),
          1,
          Math.min(
            change.staged ? change.line : change.hunk.endLineNumber,
            source.getModel()?.getLineCount() ?? 1
          ),
          1
        ),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: `git-inline-marker ${change.staged ? 'git-inline-staged' : ''} git-inline-${change.hunk.kind}`,
          linesDecorationsTooltip: change.staged
            ? 'Staged Git change — click to review'
            : 'Unstaged Git change — click to review',
          stickiness: editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      }))
    )
    return () => decorations.clear()
  }, [source, changes, enabled])
  useEffect(() => {
    if (!source || !current) {
      setZone(null)
      return
    }
    const height = Math.min(
      320,
      Math.max(
        160,
        64 +
          (current.hunk.originalText.split('\n').length +
            current.hunk.modifiedText.split('\n').length) *
            source.getOption(editor.EditorOption.lineHeight)
      )
    )
    const spacer = document.createElement('div')
    const domNode = document.createElement('div')
    domNode.className = 'git-inline-peek'
    domNode.style.height = `${height}px`
    source.getContainerDomNode().appendChild(domNode)
    const afterLineNumber = Math.min(current.line, source.getModel()?.getLineCount() ?? 1)
    const position = (): void => {
      domNode.style.top = `${
        source.getTopForLineNumber(afterLineNumber) +
        source.getOption(editor.EditorOption.lineHeight) -
        source.getScrollTop()
      }px`
    }
    const layout = (): void => {
      const info = source.getLayoutInfo()
      domNode.style.left = `${info.contentLeft}px`
      domNode.style.width = `${Math.max(0, info.width - info.contentLeft - info.verticalScrollbarWidth)}px`
      position()
    }
    layout()
    const subscription = source.onDidLayoutChange(layout)
    const scroll = source.onDidScrollChange(position)
    let id = ''
    source.changeViewZones((accessor) => {
      id = accessor.addZone({
        afterLineNumber,
        heightInPx: height,
        domNode: spacer
      })
    })
    setZone(domNode)
    source.revealLineNearTop(afterLineNumber)
    position()
    return () => {
      subscription.dispose()
      scroll.dispose()
      domNode.remove()
      if (source.getModel()) {
        source.changeViewZones((accessor) => accessor.removeZone(id))
      }
    }
  }, [source, current])
  const close = (): void => {
    setSelected(null)
    source?.focus()
  }
  const act = (revert: boolean): void => {
    if (!current || !source || !snapshot || !context || busyRef.current) {
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    void runInlineGitAction({
      source,
      change: current,
      snapshot,
      context,
      buffer,
      relativePath,
      revert
    })
      .then(async () => {
        await refresh()
        setSelected(null)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }
  if (!zone || !current || !snapshot) {
    return null
  }
  return createPortal(
    <InlineGitPeek
      hunk={current.hunk}
      staged={current.staged}
      language={source?.getModel()?.getLanguageId() ?? 'plaintext'}
      position={selected ?? 0}
      count={changes.length}
      busy={busy}
      unsaved={buffer !== snapshot.diskContent}
      error={error}
      onStage={() => void act(false)}
      onRevert={() => void act(true)}
      onMove={(direction) => {
        setSelected(((selected ?? 0) + direction + changes.length) % changes.length)
        setError(null)
      }}
      onClose={close}
    />,
    zone
  )
}
