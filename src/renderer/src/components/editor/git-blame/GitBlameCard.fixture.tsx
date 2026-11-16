import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { GitBlameDetail } from '../../../../../shared/git/blame/git-blame'
import { GitBlameCard } from './GitBlameCard'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'

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
const committedDetail: GitBlameDetail = {
  ...detail,
  attribution: {
    ...detail.attribution,
    author: 'Dan Paker',
    email: 'dan@example.test',
    commit: '2f9114d5'.padEnd(40, '0'),
    timestamp: 1784034052000,
    path: 'apps/pollerz/src/bootstrap/infrastructure/infrastructure.ts',
    line: 20,
    originalLine: 20,
    summary: 'feat(poller-orchestrator): implement poller registry and publisher wiring'
  },
  message:
    'feat(poller-orchestrator): implement poller registry and publisher wiring\n\nIntroduced shared live and snapshot functionality for consistent poller telemetry publishing.\nDeveloped the PollersOrchestrator class to manage the lifecycle of all pollers and their dependencies.',
  committer: 'Dan Paker <dan@example.test>',
  committedAt: 1784034052000,
  original: 'const persistenceInfrastructure = this.config.environment.mainDb === "MONGO"\n',
  modified: 'const persistenceInfrastructure = this.createPersistenceInfrastructure();\n',
  originalContent: 'before\n',
  modifiedContent: 'after\n'
}

function CardContent({ value = detail }: { value?: GitBlameDetail }): React.JSX.Element {
  return (
    <GitBlameCard
      line={value.attribution}
      detail={value}
      busy={false}
      error={null}
      canBack={false}
      onPrevious={noop}
      onNext={noop}
      onCommit={noop}
      onCopy={noop}
      onOpenChanges={noop}
      onExplain={noop}
      onClose={noop}
    />
  )
}

function Card(): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-popover p-3 text-popover-foreground">
      <CardContent />
    </div>
  )
}
function Popup({ sidebar = false }: { sidebar?: boolean }): React.JSX.Element {
  return (
    <div className="flex h-144 bg-background text-foreground">
      <div className="relative min-w-0 flex-1 bg-editor-surface p-4">
        <code className="font-mono text-xs">
          private createMainInfra = (): SystemInfrastructure =&gt; {'{'}
        </code>
        <div className="absolute top-12 right-8">
          <HoverCard open>
            <HoverCardTrigger asChild>
              <span className="font-mono text-xs text-muted-foreground">
                Dan Paker, 4 months ago
              </span>
            </HoverCardTrigger>
            <HoverCardContent variant="git-blame" align="start" collisionPadding={8}>
              <CardContent value={committedDetail} />
            </HoverCardContent>
          </HoverCard>
        </div>
      </div>
      {sidebar && (
        <aside className="w-64 shrink-0 border-l border-border p-4 text-sm text-muted-foreground">
          Changes
        </aside>
      )}
    </div>
  )
}

export const workingTree = defineFixture({ width: 800, render: () => <Card /> })
export const narrow = defineFixture({ width: 320, render: () => <Card /> })
export const sidebarOverlap = defineFixture({ width: 1280, render: () => <Popup sidebar /> })
export const narrowPopup = defineFixture({ width: 360, render: () => <Popup /> })
