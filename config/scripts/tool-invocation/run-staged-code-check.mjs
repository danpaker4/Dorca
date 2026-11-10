import { createRequire } from 'node:module'
import path from 'node:path'
import { runProcess } from '@orca/process-host'
import { resolveOxcCliInvocation } from './oxc-cli-invocation.mjs'

const [tool, ...args] = process.argv.slice(2)
let invocation
if (tool === 'oxlint' || tool === 'oxfmt') {
  invocation = resolveOxcCliInvocation(tool, tool)
} else if (tool === 'ast-grep') {
  const require = createRequire(import.meta.url)
  invocation = {
    command: path.join(
      path.dirname(require.resolve('@ast-grep/cli/package.json')),
      process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep'
    ),
    prefixArgs: []
  }
} else {
  throw new Error(`Unknown staged code check: ${tool}`)
}
const result = await runProcess({
  program: invocation.command,
  args: [...invocation.prefixArgs, ...args],
  cwd: process.cwd(),
  maxOutputBytes: 10 * 1024 * 1024
})
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exitCode = result.code ?? 1
