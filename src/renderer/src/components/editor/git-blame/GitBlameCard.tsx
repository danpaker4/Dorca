import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { useTranslate, useIntlLocale } from '@/i18n/use-translate'
import type { GitBlameDetail, GitBlameLine } from '../../../../../shared/git/blame/git-blame'
import { blameAge, blameAvatar } from './git-blame-presentation'

export function GitBlameCard({
  line,
  detail,
  busy,
  error,
  canBack,
  onPrevious,
  onNext,
  onCommit,
  onCopy,
  onOpenChanges,
  onExplain,
  onClose
}: {
  line: GitBlameLine
  detail: GitBlameDetail | null
  busy: boolean
  error: string | null
  canBack: boolean
  onPrevious: () => void
  onNext: () => void
  onCommit: (commit: string) => void
  onCopy: (value: string) => void
  onOpenChanges: () => void
  onExplain: (event: React.MouseEvent<HTMLButtonElement>) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const locale = useIntlLocale()
  const avatar = blameAvatar(line.email)
  return (
    <section
      className="space-y-2 text-xs"
      aria-label={t('dorca.blame.details', 'Git blame details')}
    >
      <div className="flex items-start gap-2">
        {avatar ? (
          <img src={avatar} alt="" referrerPolicy="no-referrer" className="size-6 rounded-full" />
        ) : (
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            {line.author.slice(0, 1)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">
            {line.author}{' '}
            {line.email && (
              <span className="font-normal text-muted-foreground">{`<${line.email}>`}</span>
            )}
          </p>
          <p className="text-muted-foreground">
            {blameAge(line.timestamp, locale)}
            {line.timestamp !== null && (
              <>
                {' '}
                ·{' '}
                <time dateTime={new Date(line.timestamp).toISOString()}>
                  {new Date(line.timestamp).toLocaleString(locale)}
                </time>
              </>
            )}
          </p>
        </div>
        <Button variant="ghost" size="xs" onClick={onClose}>
          {t('dorca.blame.close', 'Close')}
        </Button>
      </div>
      <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words scrollbar-sleek">
        {detail?.message ?? line.summary}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {line.commit ? (
          <Button
            variant="link"
            size="xs"
            disabled={busy || !detail}
            onClick={() => onCommit(line.commit!)}
          >
            {line.commit.slice(0, 8)}
          </Button>
        ) : (
          <span className="font-mono text-muted-foreground">
            {t('dorca.blame.workingTree', 'Working Tree')}
          </span>
        )}
        {line.commit && (
          <Button variant="ghost" size="xs" onClick={() => onCopy(line.commit!)}>
            {t('dorca.blame.copyHash', 'Copy hash')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          disabled={!detail || busy}
          onClick={() => detail && onCopy(detail.message)}
        >
          {t('dorca.blame.copyMessage', 'Copy message')}
        </Button>
        <Button variant="ghost" size="xs" disabled={!detail || busy} onClick={onExplain}>
          {t('dorca.blame.explain', 'Explain')}
        </Button>
      </div>
      {busy && <LoadingSpinner className="size-4" />}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {detail && (
        <>
          <p className="break-all text-muted-foreground">
            {line.path}:{line.originalLine}
          </p>
          <div
            className="max-h-48 overflow-auto rounded-md border border-border font-mono scrollbar-sleek"
            aria-label={t('dorca.blame.diff', 'Change preview')}
          >
            {detail.original && (
              <pre className="git-blame-removed px-2 py-1 whitespace-pre">
                {detail.original
                  .replace(/\n$/, '')
                  .split('\n')
                  .map((text) => `− ${text}`)
                  .join('\n')}
              </pre>
            )}
            {detail.modified && (
              <pre className="git-blame-added px-2 py-1 whitespace-pre">
                {detail.modified
                  .replace(/\n$/, '')
                  .split('\n')
                  .map((text) => `+ ${text}`)
                  .join('\n')}
              </pre>
            )}
            {!detail.original && !detail.modified && (
              <p className="p-2 text-muted-foreground">
                {t('dorca.blame.noChange', 'No changed lines at this position.')}
              </p>
            )}
          </div>
          {detail.parent && (
            <p className="flex items-center gap-1 text-muted-foreground">
              {t('dorca.blame.parent', 'Parent')}:{' '}
              <Button
                variant="link"
                size="xs"
                disabled={busy || !detail.originalContent || detail.previousLine === null}
                onClick={onPrevious}
              >
                {detail.parent.slice(0, 8)}
              </Button>
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-1 border-t border-border pt-1">
        <Button
          variant="ghost"
          size="xs"
          disabled={
            busy || !detail?.parent || !detail.originalContent || detail.previousLine === null
          }
          onClick={onPrevious}
        >
          {t('dorca.blame.previous', 'Previous line revision')}
        </Button>
        <Button variant="ghost" size="xs" disabled={busy || !canBack} onClick={onNext}>
          {t('dorca.blame.next', 'Next line revision')}
        </Button>
        <Button variant="ghost" size="xs" disabled={busy || !detail} onClick={onOpenChanges}>
          {t('dorca.blame.openChanges', 'Open Changes')}
        </Button>
      </div>
    </section>
  )
}
