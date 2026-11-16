import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { GitBlameDetail } from '../../../../../shared/git/blame/git-blame'
import { GitBlameCard } from './GitBlameCard'
import './git-blame.css'

const noop = (): void => {}
const detail: GitBlameDetail = {
  attribution: {
    author: 'You',
    email: '',
    timestamp: null,
    commit: null,
    line: 31,
    originalLine: 31,
    path: 'src/server.ts',
    summary: 'Uncommitted changes'
  },
  message: 'Uncommitted changes',
  committer: 'You',
  committedAt: null,
  parent: 'a'.repeat(40),
  original: 'const { mode } = request.body;\n',
  modified: 'isActive: await enablementAdapter.isEnabled(pollerId),\n',
  originalContent: '',
  modifiedContent: '',
  previousPath: 'src/server.ts',
  previousLine: 31
}
function Card(): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-popover p-3 text-popover-foreground">
      <GitBlameCard
        line={detail.attribution}
        detail={detail}
        busy={false}
        error={null}
        canBack={false}
        onPrevious={noop}
        onNext={noop}
        onCommit={noop}
        onCopy={noop}
        onRevision={noop}
        onCompare={noop}
        onExplain={noop}
        onClose={noop}
      />
    </div>
  )
}
export const workingTree = defineFixture({ width: 480, render: () => <Card /> })
export const narrow = defineFixture({ width: 320, render: () => <Card /> })
