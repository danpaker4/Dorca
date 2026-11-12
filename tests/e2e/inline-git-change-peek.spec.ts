import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runProcess } from '@orca/process-host'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedElectronClient
} from './helpers/paired-electron-client'

test('inline Git peek stages one change and reverts through editor undo', async ({
  orcaPage,
  electronApp,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  await orcaPage.setViewportSize({ width: 1280, height: 900 })
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
  ).toBe(false)
  const fixture = createGoldenWorktree(testRepoPath, 'inline-peek')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const filePath = path.join(fixture.worktreePath, 'inline.txt')
  const git = async (...args: string[]): Promise<string> => {
    const result = await runProcess({ program: 'git', args, cwd: fixture.worktreePath })
    if (result.code !== 0) {
      throw new Error(result.stderr)
    }
    return result.stdout
  }
  await writeFile(filePath, 'one\ntwo\nthree\nfour\nfive\n')
  await git('add', 'inline.txt')
  await git('commit', '--quiet', '-m', 'inline baseline')
  await writeFile(filePath, 'ONE\ntwo\nthree\nfour\nfive\n')
  await git('add', 'inline.txt')
  await writeFile(filePath, 'ONE\ntwo\nTHREE\nfour\nFIVE\n')
  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate((filePath) => {
    const state = window.__store!.getState()
    return state.openFile({
      filePath,
      relativePath: 'inline.txt',
      worktreeId: state.activeWorktreeId!,
      language: 'plaintext',
      mode: 'edit'
    })
  }, filePath)
  const sourceText = orcaPage.locator('.monaco-editor').first().locator('.view-lines').first()
  const marker = orcaPage.locator('.git-inline-marker:not(.git-inline-staged)')
  await expect(marker.first()).toBeVisible({ timeout: 25000 })
  await marker.first().click()
  const peek = orcaPage.getByRole('region', { name: 'Inline Git change', exact: true })
  await expect(peek).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('inline-peek-dark.png') })
  await peek.getByRole('button', { name: 'Next change' }).click()
  await peek.getByRole('button', { name: 'Previous change' }).click()
  await peek.getByRole('button', { name: 'Stage', exact: true }).click()
  await expect.poll(() => git('show', ':inline.txt')).toBe('ONE\ntwo\nTHREE\nfour\nfive\n')
  expect(await readFile(filePath, 'utf8')).toBe('ONE\ntwo\nTHREE\nfour\nFIVE\n')
  await expect(peek).toHaveCount(0)
  await orcaPage.locator('.git-inline-staged').first().click()
  await peek.getByRole('button', { name: 'Unstage', exact: true }).click()
  await expect.poll(() => git('show', ':inline.txt')).toBe('one\ntwo\nTHREE\nfour\nfive\n')
  await expect(peek).toHaveCount(0)
  await marker.last().click()
  await peek.getByRole('button', { name: 'Revert', exact: true }).click()
  await expect(sourceText).toContainText('five')
  await orcaPage.keyboard.press('ControlOrMeta+z')
  await expect(sourceText).toContainText('FIVE')
  await orcaPage.keyboard.press('ControlOrMeta+End')
  await orcaPage.keyboard.type(' unsaved')
  await marker.first().click()
  await expect(peek.getByRole('button', { name: 'Stage', exact: true })).toBeDisabled()
  await peek.getByRole('button', { name: 'Close change' }).click()
  await orcaPage.keyboard.press('ControlOrMeta+z')
  await writeFile(filePath, 'ONE\ntwo\nTHREE\nfour\nAGENT\n')
  await expect(sourceText).toContainText('AGENT', { timeout: 25000 })
  await marker.first().click()
  await expect(peek).toBeVisible()
  await expect(peek.getByRole('button', { name: 'Stage', exact: true })).toBeEnabled({
    timeout: 25000
  })
  await orcaPage.screenshot({ path: testInfo.outputPath('inline-peek-agent-edit.png') })
  await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
  await peek.screenshot({ path: testInfo.outputPath('inline-peek-dark-closeup.png') })
  await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ theme: 'light' }))
  await peek.screenshot({ path: testInfo.outputPath('inline-peek-light-closeup.png') })
  await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))
  await orcaPage.setViewportSize({ width: 720, height: 800 })
  await peek.screenshot({ path: testInfo.outputPath('inline-peek-narrow.png') })
  await peek.getByRole('button', { name: 'Close change' }).click()
  await orcaPage.keyboard.press('Alt+F7')
  await expect(peek).toBeVisible()
  await orcaPage.keyboard.press('Escape')
  await expect(peek).toHaveCount(0)
  expect(
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible())
    )
  ).toBe(false)
})

test('paired Source editor stages hunks on its owning runtime', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  // Pairing starts a second isolated Electron app and waits for its runtime catalog.
  test.setTimeout(240000)
  const fixture = createGoldenWorktree(testRepoPath, 'paired-inline-peek')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const filePath = path.join(fixture.worktreePath, 'paired-inline.txt')
  const git = async (...args: string[]): Promise<string> => {
    const result = await runProcess({ program: 'git', args, cwd: fixture.worktreePath })
    if (result.code !== 0) {
      throw new Error(result.stderr)
    }
    return result.stdout
  }
  await writeFile(filePath, 'one\ntwo\nthree\n')
  await git('add', 'paired-inline.txt')
  await git('commit', '--quiet', '-m', 'paired inline baseline')
  await writeFile(filePath, 'ONE\ntwo\nTHREE\n')
  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  const client = await launchPairedElectronClient(
    await createRuntimeDesktopPairingOffer(orcaPage),
    testInfo,
    'Inline Git peek'
  )
  try {
    await client.page.setViewportSize({ width: 1280, height: 900 })
    await activateGoldenWorktree(
      client.page,
      testRepoPath,
      fixture.worktreePath,
      client.environmentId
    )
    const worktreeId = await client.page.evaluate(() => window.__store!.getState().activeWorktreeId)
    if (!worktreeId) {
      throw new Error('The paired runtime did not activate its workspace')
    }
    await client.page.evaluate(
      ({ filePath, worktreeId, environmentId }) => {
        const state = window.__store!.getState()
        state.setActiveWorktree(worktreeId, `runtime:${environmentId}`)
        return state.openFile({
          filePath,
          relativePath: 'paired-inline.txt',
          worktreeId,
          runtimeEnvironmentId: environmentId,
          language: 'plaintext',
          mode: 'edit'
        })
      },
      { filePath, worktreeId, environmentId: client.environmentId }
    )
    await client.page
      .locator('.git-inline-marker:not(.git-inline-staged)')
      .first()
      .click({ timeout: 30000 })
    const peek = client.page.getByRole('region', { name: 'Inline Git change', exact: true })
    await peek.getByRole('button', { name: 'Stage', exact: true }).click()
    await expect.poll(() => git('show', ':paired-inline.txt')).toBe('ONE\ntwo\nthree\n')
    expect(await readFile(filePath, 'utf8')).toBe('ONE\ntwo\nTHREE\n')
    expect(
      await client.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
  } finally {
    await client.dispose()
  }
})
