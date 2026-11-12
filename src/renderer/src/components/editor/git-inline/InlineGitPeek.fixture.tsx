import { useState } from 'react'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { getGitInlineHunks } from '../../../../../shared/git/diff/git-inline-hunks'
import { InlineGitPeek } from './InlineGitPeek'

const hunk = getGitInlineHunks(
  'const service = createProjectService(files, roots, {',
  'const options: CompilerOptions = {'
)[0]
const noop = (): void => {}

function CompactPeek(): React.JSX.Element {
  const [height, setHeight] = useState(160)
  return (
    <div style={{ height }}>
      <InlineGitPeek
        hunk={hunk}
        staged={false}
        language="typescript"
        position={1}
        count={7}
        busy={false}
        unsaved={false}
        error={null}
        onStage={noop}
        onRevert={noop}
        onMove={noop}
        onClose={noop}
        onHeightChange={setHeight}
      />
    </div>
  )
}

export const singleLine = defineFixture({ width: 1000, render: () => <CompactPeek /> })
