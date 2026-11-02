const base = require('./electron-builder.config.cjs')
const release = require('./dorca-release.json')

if (base.forceCodeSigning) {
  throw new Error('Unsigned Dorca Mac builds must not enable signed Orca release channels')
}

module.exports = {
  ...base,
  forceCodeSigning: false,
  extraMetadata: { name: 'dorca', productName: 'Dorca', version: release.version },
  mac: {
    ...base.mac,
    // An ad-hoc signature seals the bundle without an Apple certificate or notarization.
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
    artifactName: 'dorca-macos-${arch}.${ext}',
    target: ['dmg']
  },
  publish: { ...base.publish, publishAutoUpdate: false }
}
