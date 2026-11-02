import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describeDorcaMacInstaller } from './dorca-mac-assets.mjs'

if (process.platform !== 'darwin') {
  throw new Error('Verify Mac installers on a macOS runner')
}
const release = JSON.parse(readFileSync('config/dorca-release.json', 'utf8'))
const arch = process.arch
const dmg = resolve(`dist/dorca-macos-${arch}.dmg`)
const mount = join(process.env.RUNNER_TEMP, `dorca-installer-${arch}`)
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim()
run('hdiutil', ['verify', dmg])
run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg])
try {
  const bundle = join(mount, 'Dorca.app')
  const { extractFile } = await import('@electron/asar')
  const packaged = JSON.parse(
    extractFile(join(bundle, 'Contents/Resources/app.asar'), 'package.json').toString()
  )
  const bundleId = run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleIdentifier',
    join(bundle, 'Contents/Info.plist')
  ])
  const architecture = run('lipo', ['-archs', join(bundle, 'Contents/MacOS/Dorca')])
  if (
    packaged.version !== release.version ||
    packaged.productName !== 'Dorca' ||
    bundleId !== 'com.stablyai.dorca' ||
    architecture !== (arch === 'x64' ? 'x86_64' : 'arm64')
  ) {
    throw new Error('Mac installer app identity, version or architecture is incorrect')
  }
  run('codesign', ['--verify', '--deep', '--strict', bundle])
} finally {
  run('hdiutil', ['detach', mount])
}
const description = await describeDorcaMacInstaller(dmg, release.version, arch)
mkdirSync('.build/dorca-mac', { recursive: true })
writeFileSync(`.build/dorca-mac/${arch}.json`, `${JSON.stringify(description, null, 2)}\n`)
console.log(`Verified Dorca ${release.version} ${arch} DMG, bundle identity and ad-hoc signature.`)
