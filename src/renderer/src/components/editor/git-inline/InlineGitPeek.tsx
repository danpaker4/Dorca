import { useEffect, useRef, useState } from 'react'
import { editor } from 'monaco-editor'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMonacoTheme } from '@/hooks/use-monaco-theme'
import { useEditorTypography } from '@/hooks/use-editor-typography'
import { monacoTypographyOptions } from '@/lib/editor/appearance/editor-typography'
import { useTranslate } from '@/i18n/use-translate'
import type { GitInlineHunk } from '../../../../../shared/git/diff/git-inline-hunks'

export function InlineGitPeek({
  hunk,
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
  onClose
}: {
  hunk: GitInlineHunk
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
  useEffect(() => {
    section.current?.focus({ preventScroll: true })
  }, [])
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
      minimap: { enabled: false },
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      ignoreTrimWhitespace: false,
      diffCodeLens: false,
      renderIndicators: true,
      folding: false,
      lineNumbers: 'off',
      glyphMargin: false,
      stickyScroll: { enabled: false },
      accessibilitySupport: 'on',
      ariaLabel: staged
        ? t('dorca.inlineGit.stagedChange', 'Staged Git change')
        : t('dorca.inlineGit.unstagedChange', 'Unstaged Git change')
    })
    const original = editor.createModel(hunk.originalText, language)
    const modified = editor.createModel(hunk.modifiedText, language)
    diff.setModel({ original, modified })
    return () => {
      diff.dispose()
      original.dispose()
      modified.dispose()
    }
  }, [hunk, language, theme, typography, t, staged])
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
      <div ref={container} className="min-h-0 flex-1" />
    </section>
  )
}
