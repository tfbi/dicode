import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('windows portable workflow', () => {
  function readWorkflow() {
    return readFileSync('.github/workflows/build-windows-portable.yml', 'utf8')
  }

  test('builds the portable app on a native Windows runner', () => {
    const workflow = readWorkflow()

    expect(workflow).toContain('runs-on: windows-latest')
    expect(workflow).toContain('uses: actions/checkout@v7')
    expect(workflow).toContain('uses: actions/setup-node@v6')
    expect(workflow).toContain('working-directory: adapters')
    expect(workflow).toContain('Install adapter dependencies')
    expect(workflow).toContain('SIDECAR_TARGET_TRIPLE: x86_64-pc-windows-msvc')
    expect(workflow).toContain('node ./node_modules/electron-builder/out/cli/cli.js --win dir --x64 --publish never')
    expect(workflow).toContain('bun run test:package-smoke --platform windows --package-kind dir --artifacts-dir desktop/build-artifacts/electron')
  })

  test('uploads a Dicode portable zip artifact', () => {
    const workflow = readWorkflow()

    expect(workflow).toContain('$packageName = "Dicode-$version-win-x64-portable"')
    expect(workflow).toContain("Copy-Item -Path 'desktop/build-artifacts/electron/win-unpacked/*'")
    expect(workflow).toContain('Compress-Archive -Path $stagingDir -DestinationPath $zipPath -Force')
    expect(workflow).toContain('uses: actions/upload-artifact@v7')
    expect(workflow).toContain('name: Dicode-${{ steps.version.outputs.value }}-win-x64-portable')
  })
})
