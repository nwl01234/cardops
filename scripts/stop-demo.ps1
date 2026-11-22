$ErrorActionPreference = 'SilentlyContinue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$normalizedRoot = $root.ToLowerInvariant()
$normalizedRootPosix = $normalizedRoot.Replace('\', '/')
$stateFile = Join-Path $root '.data\demo-pids.json'

function Stop-ProcessTree([int]$processId) {
    if ($processId -le 0) { return }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
    if (-not $process) { return }

    Write-Host "[CardOps] Stopping PID $processId ($($process.Name))"
    & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
}

$stopped = 0

# Precise path: the runner writes the PIDs of npm wrappers it started.
if (Test-Path $stateFile) {
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    $launcher = Get-Process -Id $state.launcher -ErrorAction SilentlyContinue

    # Only trust child PIDs while the launcher is still alive. A stale file
    # must never kill an unrelated process that reused the PID.
    if ($launcher) {
        # The watchdog is intentionally not killed here: the cleaner may have
        # been spawned by it, and killing its process tree would kill this
        # cleaner too. The final fallback stops the watchdog after PostgreSQL.
        foreach ($processId in @($state.api, $state.web, $state.notifications, $state.scan, $state.documents, $state.worker, $state.redis, $state.nats, $state.launcher)) {
            if ($null -ne $processId) {
                Stop-ProcessTree ([int]$processId)
                $stopped++
            }
        }
    }

    Remove-Item $stateFile -Force
}

# Fallback for a stale checkout: only demo processes that clearly belong to
# this repository. Exclude tests/typecheck runs (vitest/tsc) so stop-demo does
# not kill a developer's verification process.
$targets = Get-CimInstance Win32_Process | Where-Object {
    $cmd = $_.CommandLine
    if (-not $cmd -or $_.Name -notin @('node.exe', 'postgres.exe', 'redis-server.exe', 'nats-server.exe')) { return $false }
    $lower = $cmd.ToLowerInvariant()
    if (-not ($lower.Contains($normalizedRoot) -or $lower.Contains($normalizedRootPosix))) { return $false }
    if ($lower.Contains('vitest') -or $lower.Contains('tsc --noemit')) { return $false }
    return $lower.Contains('scripts\dev.mjs') -or
        $lower.Contains('scripts\watchdog.mjs') -or
        $lower.Contains('tsx') -or
        $lower.Contains('vite')
}

foreach ($target in $targets) {
    Stop-ProcessTree ([int]$target.ProcessId)
    $stopped++
}

# embedded-postgres may outlive a force-killed launcher. Do not touch the
# separate postgres-test cluster used by `npm test`. Command lines may use
# either Windows or POSIX separators.
$pgWin = "$normalizedRoot\.data\postgres"
$pgPosix = "$($normalizedRoot.Replace('\', '/'))/.data/postgres"
Get-CimInstance Win32_Process |
    Where-Object {
        if ($_.Name -ne 'postgres.exe' -or -not $_.CommandLine) { return $false }
        $cmd = $_.CommandLine.ToLowerInvariant()
        $isData = $cmd.Contains($pgWin) -or $cmd.Contains($pgPosix)
        $isTest = $cmd.Contains("$pgWin-test") -or $cmd.Contains("$pgPosix-test")
        return $isData -and -not $isTest
    } |
    ForEach-Object {
        Write-Host "[CardOps] Stopping PostgreSQL PID $($_.ProcessId)"
        Stop-ProcessTree ([int]$_.ProcessId)
        $stopped++
    }

# Infra processes are launched from the project bin directory but may not have
# the checkout path in their command line (Redis uses a config file).
Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -in @('redis-server.exe', 'nats-server.exe') -and
        $_.ExecutablePath -and
        $_.ExecutablePath.ToLowerInvariant().Contains("$normalizedRoot\.data\bin")
    } |
    ForEach-Object {
        Write-Host "[CardOps] Stopping infra PID $($_.ProcessId) ($($_.Name))"
        Stop-ProcessTree ([int]$_.ProcessId)
        $stopped++
    }

if ($stopped -eq 0) {
    Write-Host '[CardOps] No project processes are running.'
} else {
    Write-Host "[CardOps] Stopped project processes."
}
exit 0
