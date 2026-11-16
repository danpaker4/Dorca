import { useTranslate } from '@/i18n/use-translate'
import { useEffect, useState } from 'react'
import { editor } from 'monaco-editor'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet'
import { useMonacoTheme } from '@/hooks/use-monaco-theme'
import { useEditorTypography } from '@/hooks/use-editor-typography'
import { monacoTypographyOptions } from '@/lib/editor/appearance/editor-typography'
import { monaco } from '@/lib/editor/monaco/monaco-setup'
import { registerDiffEditorLanguageNavigation } from '../diff/monaco-view/diff-editor-language-navigation'
import { registerEditorInstanceForTsWorkspace } from '../monaco-ts-workspace-intelligence'
import type { GitBlameDetail } from '../../../../../shared/git/blame/git-blame'

export function GitBlameRevision({
  detail,
  buffer,
  language,
  compare,
  againstParent = false,
  fileId,
  filePath,
  worktreeId,
  onClose
}: {
  detail: GitBlameDetail
  buffer: string
  language: string
  compare: boolean
  againstParent?: boolean
  fileId: string
  filePath: string
  worktreeId?: string
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const theme = useMonacoTheme()
  const typography = useEditorTypography()
  useEffect(() => {
    if (!container) {
      return
    }
    const options: editor.IStandaloneEditorConstructionOptions = {
      ...monacoTypographyOptions(typography),
      theme,
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false
    }
    const original = editor.createModel(
      againstParent || (compare && !detail.attribution.commit)
        ? detail.originalContent
        : detail.modifiedContent,
      language
    )
    const modified = compare
      ? editor.createModel(againstParent ? detail.modifiedContent : buffer, language)
      : undefined
    if (modified) {
      const instance = editor.createDiffEditor(container, {
        ...options,
        renderSideBySide: false,
        originalEditable: false,
        ignoreTrimWhitespace: false
      })
      instance.setModel({ original, modified })
      const navigation = registerDiffEditorLanguageNavigation(instance, monaco, {
        fileId,
        filePath,
        worktreeId,
        modifiedIsHistorical: againstParent,
        trackHistory: false
      })
      return () => {
        navigation()
        instance.dispose()
        original.dispose()
        modified.dispose()
      }
    }
    const instance = editor.create(container, options)
    instance.setModel(original)
    const navigation = registerEditorInstanceForTsWorkspace(instance, monaco, {
      fileId,
      filePath,
      worktreeId,
      historical: true,
      trackHistory: false
    })
    instance.revealLineInCenter(detail.attribution.originalLine)
    return () => {
      navigation()
      instance.dispose()
      original.dispose()
    }
  }, [
    container,
    detail,
    buffer,
    compare,
    againstParent,
    language,
    theme,
    typography,
    fileId,
    filePath,
    worktreeId
  ])
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <SheetContent className="w-full sm:max-w-5xl">
        <SheetHeader>
          <SheetTitle>
            {detail.attribution.commit?.slice(0, 8) ?? t('dorca.blame.head', 'HEAD')} ·{' '}
            {detail.attribution.path}
          </SheetTitle>
          <SheetDescription>
            {compare && !againstParent
              ? t('dorca.blame.workingComparison', 'Comparison with current working tree buffer')
              : detail.message}
          </SheetDescription>
        </SheetHeader>
        <p className="px-4 py-1 text-xs text-muted-foreground">
          {t(
            'dorca.blame.revisionNavigation',
            'Historical definitions are unavailable. Working-tree comparisons support Go to Definition on the modified side.'
          )}
        </p>
        <div className="min-h-0 flex-1" ref={setContainer} />
      </SheetContent>
    </Sheet>
  )
}
