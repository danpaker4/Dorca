import {
  useMonacoBlameDecorations,
  type BlameSelection as Selection
} from './use-monaco-blame-decorations'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createNonSecureContextUuid } from '../../../../../shared/identifiers/non-secure-context-uuid'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { getRuntimeGitBlame } from '@/runtime/source-control/git/runtime-git-blame-client'
import { getRuntimeGitCommitCompare } from '@/runtime/source-control/git/runtime-git-diff-client'
import { openAddToChatMenuAt } from '@/components/native-chat/selection-quotes/add-to-chat-point-menu'
import { formatNativeChatQuote } from '@/components/native-chat/selection-quotes/native-chat-quote-selection'
import type { GitBlameDetail } from '../../../../../shared/git/blame/git-blame'
import { useMonacoGitBlame } from './use-monaco-git-blame'
import { GitBlameCard } from './GitBlameCard'
import { GitBlameRevision } from './GitBlameRevision'
import { explainBlamePrompt } from './git-blame-presentation'
import './git-blame.css'

type MonacoGitBlameProps = {
  source: editor.IStandaloneCodeEditor | null
  fileId: string
  relativePath: string
  enabled: boolean
}

export function MonacoGitBlame(props: MonacoGitBlameProps): React.JSX.Element {
  const focusCard = useRef(false)
  const mode = useAppStore((state) => state.settings?.editorGitBlameMode ?? 'current-line')
  const data = useMonacoGitBlame(
    props.source,
    props.fileId,
    props.relativePath,
    props.enabled && mode !== 'off'
  )
  return (
    <MonacoGitBlameView
      {...props}
      data={data}
      mode={mode}
      focusCard={focusCard}
      key={JSON.stringify([
        props.fileId,
        props.relativePath,
        props.source?.getId(),
        data.context,
        data.version,
        data.snapshot?.head
      ])}
    />
  )
}

function MonacoGitBlameView({
  source,
  fileId,
  relativePath,
  enabled,
  mode,
  data,
  focusCard
}: MonacoGitBlameProps & {
  mode: 'off' | 'current-line' | 'file'
  data: ReturnType<typeof useMonacoGitBlame>
  focusCard: React.RefObject<boolean>
}): React.JSX.Element | null {
  const { snapshot, error, context, file } = data
  const [selection, setSelection] = useState<Selection | null>(null)
  const [detail, setDetail] = useState<GitBlameDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState<{
    detail: GitBlameDetail
    compare: boolean
    againstParent?: boolean
    buffer: string
  } | null>(null)
  const selected = useRef(selection)
  const snapshotRef = useRef(snapshot)
  const [channel] = useState(createNonSecureContextUuid)
  const sequence = useRef(0)
  const pinned = useRef(false)
  useEffect(() => {
    if (focusCard.current && snapshot) {
      pinned.current = true
    }
  }, [focusCard, snapshot])
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      selected.current = null
      clearTimeout(closeTimer.current)
    },
    []
  )
  useEffect(() => {
    selected.current = selection
  }, [selection])
  useEffect(() => {
    if (!selection || !focusCard.current) {
      return
    }
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>('[data-git-blame-card] button')
        ?.focus({ preventScroll: true })
      focusCard.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [selection, focusCard])
  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])
  const keepOpen = useCallback(() => clearTimeout(closeTimer.current), [])
  const closeSoon = useCallback(() => {
    if (pinned.current) {
      return
    }
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setSelection(null), 350)
  }, [])
  useEffect(() => {
    if (!selection) {
      if (!focusCard.current) {
        pinned.current = false
      }
      return
    }
    const outside = (event: PointerEvent): void => {
      if (
        event.target instanceof Element &&
        !event.target.closest('[data-git-blame-card], .git-blame-annotation')
      ) {
        pinned.current = false
        setSelection(null)
      }
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [selection, focusCard])
  useMonacoBlameDecorations({
    source,
    enabled,
    mode,
    relativePath,
    snapshot,
    snapshotRef,
    selected,
    pinned,
    focusCard,
    keepOpen,
    closeSoon,
    setSelection
  })
  useEffect(() => {
    setDetail(null)
    setDetailError(null)
    if (!selection || !context || !source) {
      return
    }
    const abort = new AbortController()
    const requestChannel = channel
    const requestSequence = sequence
    let live = true
    setBusy(true)
    void getRuntimeGitBlame(
      context,
      {
        channel: requestChannel,
        sequence: ++sequence.current,
        mode: 'detail',
        filePath: selection.target.filePath,
        line: selection.target.line,
        revision: selection.target.revision,
        bufferContent: source.getValue()
      },
      abort.signal
    )
      .then((result) => {
        if (live) {
          const value = result.detail
          setDetail(
            value && !value.attribution.commit
              ? {
                  ...value,
                  attribution: {
                    ...value.attribution,
                    timestamp: selection.target.initial.timestamp
                  }
                }
              : (value ?? null)
          )
        }
      })
      .catch((cause: unknown) => {
        if (live) {
          setDetailError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (live) {
          setBusy(false)
        }
      })
    return () => {
      live = false
      abort.abort()
      void getRuntimeGitBlame(context, {
        channel: requestChannel,
        sequence: ++requestSequence.current,
        mode: 'cancel',
        filePath: relativePath
      }).catch(() => {})
    }
  }, [selection, context, source, relativePath, channel])
  const openCommit = (commit: string): void => {
    if (!context || !detail || busy) {
      return
    }
    if (context.worktreeId.startsWith('folder:') && commit === detail.attribution.commit) {
      setRevision({ detail, compare: true, againstParent: true, buffer: '' })
      setSelection(null)
      return
    }
    const captured = selection
    const capturedModel = source?.getModel()
    const capturedVersion = capturedModel?.getAlternativeVersionId()
    setBusy(true)
    void getRuntimeGitCommitCompare(context, commit)
      .then((result) => {
        if (
          selected.current !== captured ||
          source?.getModel() !== capturedModel ||
          capturedModel?.getAlternativeVersionId() !== capturedVersion
        ) {
          return
        }
        if (result.summary.status !== 'ready') {
          setDetailError(result.summary.errorMessage ?? 'Commit comparison is unavailable.')
          return
        }
        useAppStore
          .getState()
          .openCommitAllDiffs(
            context.worktreeId,
            context.worktreePath,
            result.summary,
            result.entries,
            detail.attribution.summary,
            detail.message,
            { executionHostId: context.hostId, runtimeEnvironmentId: file?.runtimeEnvironmentId }
          )
        setSelection(null)
      })
      .catch((cause: unknown) => {
        if (selected.current === captured) {
          setDetailError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (selected.current === captured) {
          setBusy(false)
        }
      })
  }
  if (!enabled) {
    return null
  }
  return (
    <>
      {error && mode !== 'off' && (
        <span
          className="absolute bottom-1 right-2 max-w-full truncate bg-editor-surface px-2 text-xs text-muted-foreground"
          role="status"
        >
          {error}
        </span>
      )}
      {selection && (
        <HoverCard
          open
          onOpenChange={(open) => {
            if (!open) {
              closeSoon()
            }
          }}
        >
          <HoverCardTrigger asChild>
            <span
              className="pointer-events-none fixed size-px"
              style={{ left: selection.x, top: selection.y }}
            />
          </HoverCardTrigger>
          <HoverCardContent
            variant="git-blame"
            data-git-blame-card
            align="start"
            collisionBoundary={source?.getContainerDomNode()}
            collisionPadding={8}
            onPointerEnter={keepOpen}
            onPointerDownCapture={() => {
              pinned.current = true
              keepOpen()
            }}
            onPointerLeave={closeSoon}
            onFocusCapture={keepOpen}
            onBlurCapture={closeSoon}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSelection(null)
              }
            }}
          >
            <GitBlameCard
              line={detail?.attribution ?? selection.target.initial}
              detail={detail}
              busy={busy}
              error={detailError}
              canBack={selection.newer.length > 0}
              onClose={() => setSelection(null)}
              onCommit={(commit) => void openCommit(commit)}
              onCopy={(text) => {
                void window.api.ui
                  .writeClipboardText(text)
                  .catch((cause: unknown) => setDetailError(String(cause)))
              }}
              onPrevious={() => {
                if (!detail?.parent || detail.previousLine === null) {
                  return
                }
                setSelection({
                  ...selection,
                  newer: [...selection.newer, selection.target],
                  target: {
                    revision: detail.parent,
                    filePath: detail.previousPath,
                    line: detail.previousLine,
                    initial: detail.attribution
                  }
                })
              }}
              onNext={() => {
                const target = selection.newer.at(-1)
                if (target) {
                  setSelection({ ...selection, target, newer: selection.newer.slice(0, -1) })
                }
              }}
              onRevision={() => {
                if (detail) {
                  setRevision({ detail, compare: false, buffer: '' })
                  setSelection(null)
                }
              }}
              onCompare={() => {
                if (detail && source) {
                  setRevision({ detail, compare: true, buffer: source.getValue() })
                  setSelection(null)
                }
              }}
              onExplain={(event) => {
                if (!detail || !context) {
                  return
                }
                const box = event.currentTarget.getBoundingClientRect()
                openAddToChatMenuAt({
                  worktreeId: context.worktreeId,
                  quote: formatNativeChatQuote(explainBlamePrompt(detail)),
                  launchSource: 'native_chat',
                  x: box.left,
                  y: box.bottom
                })
                setSelection(null)
              }}
            />
          </HoverCardContent>
        </HoverCard>
      )}
      {revision && (
        <GitBlameRevision
          {...revision}
          fileId={fileId}
          filePath={file?.filePath ?? relativePath}
          worktreeId={file?.worktreeId}
          language={source?.getModel()?.getLanguageId() ?? 'plaintext'}
          onClose={() => setRevision(null)}
        />
      )}
    </>
  )
}
