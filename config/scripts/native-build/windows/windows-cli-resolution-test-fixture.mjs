import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runProcessSync } from '@orca/process-host'

export function verifyWindowsCliResolution(binary, executableName) {
  const root = mkdtempSync(join(tmpdir(), 'dorca launcher resolution '))
  try {
    const launcher = join(root, 'resources', 'bin', 'orca.exe')
    const entry = join(root, 'resources', 'app.asar.unpacked', 'out', 'cli', 'index.js')
    mkdirSync(dirname(launcher), { recursive: true })
    mkdirSync(dirname(entry), { recursive: true })
    copyFileSync(binary, launcher)
    copyFileSync(process.execPath, join(root, executableName))
    const decoy = executableName === 'Dorca.exe' ? 'Orca.exe' : 'Dorca.exe'
    writeFileSync(join(root, decoy), 'must not launch another application')
    writeFileSync(
      entry,
      `
if (process.argv[2] === 'fail') process.exit(23)
console.log(JSON.stringify({
  executable: require('node:path').basename(process.execPath),
  argv: process.argv.slice(2),
  userData: process.env.ORCA_USER_DATA_PATH,
  packaged: process.env.ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER
}))
`
    )
    const body = 'first line\n\nsecond "quoted" line & %PATH%'
    const result = runProcessSync({
      program: launcher,
      args: ['orchestration', 'send', '--body', body],
      env: { ...process.env, ORCA_USER_DATA_PATH: 'inherited-profile' }
    })
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      executable: executableName,
      argv: ['orchestration', 'send', '--body', body],
      userData: 'inherited-profile',
      packaged: '1'
    })
    assert.equal(runProcessSync({ program: launcher, args: ['fail'] }).code, 23)
    rmSync(join(root, executableName))
    const missing = runProcessSync({ program: launcher, args: ['--help'] })
    assert.equal(missing.code, 1)
    assert.match(
      missing.stderr,
      new RegExp(`Unable to locate ${executableName.replace('.', '\\.')}`)
    )
    writeFileSync(
      join(dirname(launcher), 'orca-launcher.cfg'),
      `node=${process.execPath}\ncli=${entry}\nuser-data=${root}\n`
    )
    const server = runProcessSync({
      program: launcher,
      args: ['server', body],
      env: { ...process.env, ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER: '1' }
    })
    assert.equal(server.code, 0, server.stderr)
    assert.deepEqual(JSON.parse(server.stdout), {
      executable: 'node.exe',
      argv: ['server', body],
      userData: root
    })
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
