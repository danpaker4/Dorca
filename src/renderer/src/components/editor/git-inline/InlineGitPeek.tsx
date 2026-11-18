import { useEffect, useRef, useState } from 'react'
import { createNonSecureContextUuid } from '../../../../../shared/identifiers/non-secure-context-uuid'
import { editor, Uri, Range } from 'monaco-editor'
import { monaco } from '@/lib/editor/monaco/monaco-setup'
import { registerDiffEditorLanguageNavigation } from '../diff/monaco-view/diff-editor-language-navigation'
import { installIndependentDiffEditorWheelScroll } from '../diff/monaco-view/diff-editor-horizontal-wheel-scroll'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMonacoTheme } from '@/lib/editor/appearance/use-monaco-theme'
import { useEditorTypography } from '@/lib/editor/appearance/use-editor-typography'
import { monacoTypographyOptions } from '@/lib/editor/appearance/editor-typography'
import { useTranslate } from '@/i18n/use-translate'
import type { GitInlineHunk } from '../../../../../shared/git/diff/git-inline-hunks'

export function InlineGitPeek({
  hunk,
  originalContent,
  modifiedContent,
  fileId,
  filePath,
  worktreeId,
  staged,
  language,
  position,
  count,
  busy,
  unsaved,
  error,
  onStage,
  onRevert,
  onMove,
  onClose,
  onHeightChange
}: {
  hunk: GitInlineHunk
  originalContent: string
  modifiedContent: string
  fileId: string
  filePath: string
  worktreeId?: string
  staged: boolean
  language: string
  position: number
  count: number
  busy: boolean
  unsaved: boolean
  error: string | null
  onStage: () => void
  onRevert: () => void
  onMove: (direction: number) => void
  onClose: () => void
  onHeightChange?: (height: number) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [showProgress, setShowProgress] = useState(false)
  useEffect(() => {
    if (!busy) {
      return
    }
    const timer = window.setTimeout(() => setShowProgress(true), 200)
    return () => {
      window.clearTimeout(timer)
      setShowProgress(false)
    }
  }, [busy])
  const container = useRef<HTMLDivElement>(null)
  const section = useRef<HTMLElement>(null)
  const diffRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const hunkRef = useRef(hunk)
  useEffect(() => {
    hunkRef.current = hunk
  }, [hunk])
  useEffect(() => {
    section.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const node = section.current
    if (!node) {
      return
    }
    // Nested Monaco input must not also move the surrounding file editor.
    const stop = (event: Event): void => {
      event.stopPropagation()
      if (event instanceof KeyboardEvent && event.type === 'keydown' && event.key === 'Escape') {
        onClose()
      }
    }
    const events = ['keydown', 'keyup', 'keypress', 'wheel', 'mousedown', 'mouseup', 'contextmenu']
    events.forEach((name) => node.addEventListener(name, stop))
    return () => events.forEach((name) => node.removeEventListener(name, stop))
  }, [onClose])
  const theme = useMonacoTheme()
  const typography = useEditorTypography()
  useEffect(() => {
    if (!container.current) {
      return
    }
    const diff = editor.createDiffEditor(container.current, {
      ...monacoTypographyOptions(typography),
      theme,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: false,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      scrollbar: { vertical: 'auto', horizontal: 'auto', alwaysConsumeMouseWheel: true },
      minimap: { enabled: false },
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      ignoreTrimWhitespace: false,
      diffCodeLens: false,
      renderIndicators: true,
      folding: false,
      lineNumbers: 'on',
      glyphMargin: false,
      stickyScroll: { enabled: false },
      accessibilitySupport: 'on',
      ariaLabel: staged
        ? t('dorca.inlineGit.stagedChange', 'Staged Git change')
        : t('dorca.inlineGit.unstagedChange', 'Unstaged Git change')
    })
    const identity = createNonSecureContextUuid()
    const original = editor.createModel(
      originalContent,
      language,
      Uri.file(filePath).with({ scheme: 'dorca-git-peek', query: `${identity}:original` })
    )
    const modified = editor.createModel(
      modifiedContent,
      language,
      Uri.file(filePath).with({ scheme: 'dorca-git-peek', query: `${identity}:modified` })
    )
    diff.setModel({ original, modified })
    const wheel = installIndependentDiffEditorWheelScroll(diff)
    diffRef.current = diff
    const navigation = registerDiffEditorLanguageNavigation(diff, monaco, {
      fileId,
      filePath,
      worktreeId,
      modifiedIsHistorical: staged,
      trackHistory: false
    })
    const reveal = (): void =>
      diff
        .getModifiedEditor()
        .revealLineInCenter(Math.min(hunkRef.current.lineNumber, modified.getLineCount()))
    const resize = (): void => {
      if (!section.current || !container.current) {
        return
      }
      const chrome = section.current.offsetHeight - container.current.offsetHeight
      onHeightChange?.(Math.min(320, chrome + diff.getModifiedEditor().getContentHeight()))
    }
    const contentSize = diff.getModifiedEditor().onDidContentSizeChange(resize)
    let initialReveal = true
    const updated = diff.onDidUpdateDiff(() => {
      resize()
      if (initialReveal) {
        initialReveal = false
        reveal()
      }
    })
    const observer = new ResizeObserver(resize)
    observer.observe(section.current!)
    resize()
    return () => {
      observer.disconnect()
      contentSize.dispose()
      updated.dispose()
      navigation()
      wheel()
      diffRef.current = null
      diff.dispose()
      original.dispose()
      modified.dispose()
    }
  }, [
    originalContent,
    modifiedContent,
    fileId,
    filePath,
    worktreeId,
    language,
    theme,
    typography,
    t,
    staged,
    onHeightChange
  ])
  useEffect(() => {
    const diff = diffRef.current
    if (!diff) {
      return
    }
    const modified = diff.getModifiedEditor()
    const count = modified.getModel()?.getLineCount() ?? 1
    modified.revealLineInCenter(Math.min(hunk.lineNumber, count))
    const marker = modified.createDecorationsCollection([
      {
        range: new Range(
          Math.min(hunk.lineNumber, count),
          1,
          Math.min(hunk.endLineNumber, count),
          1
        ),
        options: { isWholeLine: true, className: 'git-inline-current-change' }
      }
    ])
    return () => marker.clear()
  }, [hunk])
  return (
    <section
      ref={section}
      tabIndex={-1}
      className="flex h-full flex-col font-sans border-y border-border bg-card text-card-foreground"
      aria-label={t('dorca.inlineGit.region', 'Inline Git change')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1 text-xs">
        <span className="mr-auto flex items-center gap-1">
          {showProgress && <LoadingSpinner className="size-3" />}
          {staged
            ? t('dorca.inlineGit.staged', 'Staged')
            : t('dorca.inlineGit.unstaged', 'Unstaged')}{' '}
          · {position + 1} / {count}
        </span>
        <Button size="xs" variant="ghost" disabled={busy || unsaved} onClick={onStage}>
          {staged ? t('dorca.inlineGit.unstage', 'Unstage') : t('dorca.inlineGit.stage', 'Stage')}
        </Button>
        {!staged && (
          <Button size="xs" variant="ghost" disabled={busy} onClick={onRevert}>
            {t('dorca.inlineGit.revert', 'Revert')}
          </Button>
        )}
        {(
          [
            [t('dorca.inlineGit.previous', 'Previous change'), ArrowUp, () => onMove(-1)],
            [t('dorca.inlineGit.next', 'Next change'), ArrowDown, () => onMove(1)],
            [t('dorca.inlineGit.close', 'Close change'), X, onClose]
          ] as const
        ).map(([label, Icon, action]) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={label}
                disabled={busy && Icon !== X}
                onClick={action}
              >
                <Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {label}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      {unsaved && (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {t(
            'dorca.inlineGit.saveFirst',
            'Save this file before staging or unstaging. Revert can be undone in the editor.'
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <p className="px-2 py-1 text-xs text-muted-foreground">
        {staged
          ? t(
              'dorca.inlineGit.stagedNavigation',
              'Historical definitions are unavailable in the staged comparison.'
            )
          : t(
              'dorca.inlineGit.definitionNotice',
              'Go to Definition is available on the working-tree side. Historical definitions are unavailable.'
            )}
      </p>
      <div ref={container} className="min-h-0 flex-1" />
    </section>
  )
}
