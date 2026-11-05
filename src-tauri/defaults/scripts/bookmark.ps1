[Console]::OutputEncoding = [Text.Encoding]::UTF8
$text = $env:PLUCK_TEXT -replace "\r?\n", " "
$entry = "- $(Get-Date -Format 'yyyy-MM-dd HH:mm') [$env:PLUCK_APP] $env:PLUCK_TITLE`n  $text"
Add-Content -Path bookmarks.md -Value $entry -Encoding UTF8
"Saved to bookmarks.md in the config folder"
