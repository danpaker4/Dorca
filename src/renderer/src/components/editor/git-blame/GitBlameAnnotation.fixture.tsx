import { defineFixture } from '../../../component-fixtures/component-fixture'

export const currentLine = defineFixture({
  width: 1100,
  render: () => (
    <div className="flex bg-editor-surface px-2 py-1 font-mono text-sm text-foreground">
      <code className="shrink-0">const authorizationHandler = ZAuthServiceClient.client();</code>
      <span className="git-blame-annotation min-w-0">
        galbkos, 4 months ago • feat(core): add authz service client to monorepo utils
      </span>
    </div>
  )
})
