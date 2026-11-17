import type { editor } from 'monaco-editor'
import { MonacoGitBlame } from './MonacoGitBlame'

export function MonacoDiffGitBlame({
  fileId,
  originalEditor,
  modifiedEditor,
  relativePath,
  originalRelativePath = relativePath,
  originalRevision,
  modifiedRevision,
  originalContent,
  modifiedContent,
  sideBySide
}: {
  fileId: string
  originalEditor: editor.IStandaloneCodeEditor | null
  modifiedEditor: editor.IStandaloneCodeEditor | null
  relativePath: string
  originalRelativePath?: string
  originalRevision?: string
  modifiedRevision?: string
  originalContent: string
  modifiedContent: string
  sideBySide: boolean
}): React.JSX.Element {
  return (
    <>
      <MonacoGitBlame
        source={originalEditor}
        fileId={fileId}
        relativePath={originalRelativePath}
        revision={originalRevision}
        enabled={sideBySide && originalContent.length > 0}
      />
      <MonacoGitBlame
        source={modifiedEditor}
        fileId={fileId}
        relativePath={relativePath}
        revision={modifiedRevision}
        enabled={modifiedContent.length > 0}
      />
    </>
  )
}
