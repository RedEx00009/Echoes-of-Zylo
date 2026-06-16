<#
PowerShell helper: apply_commit_local.ps1
Usage (PowerShell):
  ./apply_commit_local.ps1            # creates a backup and attempts to commit
  ./apply_commit_local.ps1 -RunTests  # also runs node tests (if node installed)
  ./apply_commit_local.ps1 -CommitMessage "Mensaje personalizado"

Notes:
- This environment lacked `git` and `node`; run this script on your local machine.
- The script will create a backup named `systems-patch.modified.backup.js` in the same folder.
#>
param(
  [switch]$RunTests,
  [string]$CommitMessage = "Npc party: force battleMode and play combat_idle when detecting enemies / on join"
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Backup current file
$src = "systems-patch.js"
$backup = "systems-patch.modified.backup.js"
if (Test-Path $src) {
  Copy-Item -Path $src -Destination $backup -Force
  Write-Output "Backup created: $backup"
} else {
  Write-Output "Warning: $src not found in current folder. Ensure you run this from the repo root."
}

# Optionally run tests
if ($RunTests) {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Output "Running tests: node tests/npc-system.test.js"
    node tests/npc-system.test.js
  } else {
    Write-Output "Node.js not found. Install Node.js to run tests locally."
  }
}

# Commit changes
if (Get-Command git -ErrorAction SilentlyContinue) {
  git add $src
  git commit -m "$CommitMessage"
  if ($LASTEXITCODE -eq 0) { Write-Output "Git commit successful." } else { Write-Output "Git commit returned exit code $LASTEXITCODE." }
} else {
  Write-Output "Git not found. Run these commands locally to commit:"
  Write-Output "  git add $src"
  Write-Output "  git commit -m \"$CommitMessage\""
}

Write-Output "Done."