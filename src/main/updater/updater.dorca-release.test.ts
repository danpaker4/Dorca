import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from './testing/updater-test-module-loader'
import { updaterMainWindow } from './testing/updater-test-main-window'

const { appMock, autoUpdaterMock, fetchNewerReleaseTagsMock, moduleFactories, resetUpdaterMocks } =
  await vi.hoisted(async () =>
    (await import('./testing/updater-test-harness')).createUpdaterMocks()
  )

vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('../ipc/pty/kill-all', () => moduleFactories.ptyKillAll())
vi.mock('./linux-package/linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./releases/updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./nudges/nudge-campaign', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./releases/updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('../local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('../local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

warmUpdaterModule()

describe('Dorca prebuilt updates', () => {
  beforeEach(resetUpdaterMocks)
  const originalPlatform = process.platform
  afterEach(() => Object.defineProperty(process, 'platform', { value: originalPlatform }))

  it('shows the Mac update offer but opens its release page without native download or installation', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    appMock.getName.mockReturnValue('Dorca')
    fetchNewerReleaseTagsMock.mockResolvedValue(['v2.0.1'])
    const { shell } = await import('electron')
    const updater = await loadUpdaterModule()
    updater.setupAutoUpdater(updaterMainWindow(vi.fn()), { getLastUpdateCheckAt: () => Date.now() })
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    updater.checkForUpdatesFromMenu()
    await vi.waitFor(() => expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce())
    autoUpdaterMock.emit('checking-for-update')
    autoUpdaterMock.emit('update-available', { version: '2.0.1' })
    await vi.waitFor(() => expect(updater.getUpdateStatus().state).toBe('available'))
    updater.downloadUpdate()
    await vi.waitFor(() =>
      expect(shell.openExternal).toHaveBeenCalledWith(
        'https://github.com/danpaker4/Dorca/releases/tag/v2.0.1'
      )
    )
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    updater.quitAndInstall()
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled()
    expect(appMock.quit).not.toHaveBeenCalled()
    expect(updater.getUpdateStatus().state).toBe('available')
  })

  it('pins the Dorca release and sends Download to electron-updater without a local source build', async () => {
    autoUpdaterMock.checkForUpdates.mockResolvedValue(undefined)
    autoUpdaterMock.downloadUpdate.mockResolvedValue([])
    fetchNewerReleaseTagsMock.mockResolvedValue(['v2.0.1'])
    const updater = await loadUpdaterModule()
    updater.setupAutoUpdater(updaterMainWindow(vi.fn()), { getLastUpdateCheckAt: () => Date.now() })
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://github.com/danpaker4/Dorca/releases/latest/download'
    })
    updater.checkForUpdatesFromMenu()
    await vi.waitFor(() => expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledOnce())
    autoUpdaterMock.emit('checking-for-update')
    autoUpdaterMock.emit('update-available', { version: '2.0.1' })
    await vi.waitFor(() => expect(updater.getUpdateStatus().state).toBe('available'))
    expect(autoUpdaterMock.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://github.com/danpaker4/Dorca/releases/download/v2.0.1'
    })
    updater.downloadUpdate()
    await vi.waitFor(() => expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledOnce())
    autoUpdaterMock.emit('update-downloaded', { version: '2.0.1' })
    expect(updater.getUpdateStatus()).toMatchObject({ state: 'downloaded', version: '2.0.1' })
  })
})
