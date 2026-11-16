// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { afterEach, expect, it, vi } from 'vitest'
import { useMonacoBlameDecorations } from './use-monaco-blame-decorations'
import type { GitBlameSnapshot } from '../../../../../shared/git/blame/git-blame'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))

const disposals: (() => void)[] = []
afterEach(() => {
  cleanup()
  for (const dispose of disposals.splice(0).toReversed()) {
    dispose()
  }
  vi.restoreAllMocks()
})

it('shows blame for selected lines and updates when only the selection anchor changes', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Monaco only reads font metrics here.
    {
      measureText: (text: string) => ({ width: text.length * 8 }),
      clearRect() {},
      fillRect() {}
    } as unknown as CanvasRenderingContext2D
  )
  const container = document.createElement('div')
  document.body.appendChild(container)
  disposals.push(() => container.remove())
  const model = monaco.editor.createModel('first\nsecond\nthird\nfourth', 'plaintext')
  disposals.push(() => model.dispose())
  const source = monaco.editor.create(container, {
    model,
    dimension: { width: 1000, height: 300 },
    minimap: { enabled: false },
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    occurrencesHighlight: 'off',
    selectionHighlight: false
  })
  disposals.push(() => source.dispose())
  const snapshot: GitBlameSnapshot = {
    head: 'a'.repeat(40),
    lines: ['Alpha', 'Beta', 'Gamma', 'Delta'].map((author, index) => ({
      line: index + 1,
      originalLine: index + 1,
      commit: 'a'.repeat(40),
      author,
      email: '',
      timestamp: 0,
      summary: 'Change',
      path: 'file.txt'
    }))
  }
  renderHook(() =>
    useMonacoBlameDecorations({
      source,
      enabled: true,
      mode: 'current-line',
      relativePath: 'file.txt',
      snapshot,
      snapshotRef: { current: snapshot },
      selected: { current: null },
      pinned: { current: false },
      focusCard: { current: false },
      keepOpen() {},
      closeSoon() {},
      setSelection() {}
    })
  )
  const authors = (): string[] =>
    [...container.querySelectorAll('.git-blame-annotation')].map(
      (node) => node.textContent!.split(',')[0]
    )
  expect(authors()).toEqual(['Alpha'])
  act(() => source.setSelection(new monaco.Selection(1, 1, 3, 5)))
  expect(authors()).toEqual(['Alpha', 'Beta', 'Gamma'])
  act(() => source.setSelection(new monaco.Selection(2, 1, 3, 5)))
  expect(authors()).toEqual(['Beta', 'Gamma'])
  act(() => source.setSelection(new monaco.Selection(3, 1, 1, 1)))
  expect(authors()).toEqual(['Alpha', 'Beta'])
  act(() =>
    source.setSelections([new monaco.Selection(2, 1, 2, 1), new monaco.Selection(4, 1, 4, 1)])
  )
  expect(authors()).toEqual(['Beta', 'Delta'])
  act(() => source.setPosition({ lineNumber: 3, column: 1 }))
  expect(authors()).toEqual(['Gamma'])
})
