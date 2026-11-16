import type { editor } from 'monaco-editor'
import type { EditorTypography } from '../../../../../../shared/editor/editor-typography'
import { monacoTypographyOptions } from '@/lib/editor/appearance/editor-typography'
import { PLUGIN_SYNTAX_EDITOR_OPTIONS } from '@/lib/monaco-languages/plugin-syntax-editor-options'
import { monacoFindOptions } from '../../monaco/monaco-find-options'
import { buildEditorUnicodeHighlightOptions } from '../../monaco/editor-unicode-highlight-options'
import { buildDiffEditorWordWrapOptions } from './diff-editor-word-wrap-options'
import { buildDiffEditorWhitespaceOptions } from './diff-editor-whitespace-options'
import { buildDiffEditorHideUnchangedOptions } from './diff-editor-hide-unchanged-options'
import { diffEditorScrollbarOptions } from './diff-editor-scrollbar-options'

export function buildDiffEditorOptions({
  language,
  editable,
  sideBySide,
  diffTypography,
  diffWordWrap,
  diffShowWhitespace,
  diffCollapseUnchangedRegions
}: {
  language: string
  editable?: boolean
  sideBySide: boolean
  diffTypography: EditorTypography
  diffWordWrap?: boolean
  diffShowWhitespace?: boolean
  diffCollapseUnchangedRegions?: boolean
}): editor.IDiffEditorConstructionOptions {
  return {
    dropIntoEditor: { enabled: false },
    readOnly: !editable,
    originalEditable: false,
    renderSideBySide: sideBySide,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    ...PLUGIN_SYNTAX_EDITOR_OPTIONS,
    ...monacoTypographyOptions(diffTypography),
    lineNumbers: 'on',
    ...buildDiffEditorWordWrapOptions(diffWordWrap),
    ...buildDiffEditorWhitespaceOptions(diffShowWhitespace),
    ...buildDiffEditorHideUnchangedOptions(diffCollapseUnchangedRegions),
    automaticLayout: true,
    renderOverviewRuler: true,
    scrollbar: diffEditorScrollbarOptions,
    padding: { top: 0 },
    find: monacoFindOptions,
    unicodeHighlight: buildEditorUnicodeHighlightOptions(language)
  }
}
