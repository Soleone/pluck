[Console]::OutputEncoding = [Text.Encoding]::UTF8
Start-Process ("https://duckduckgo.com/?q=" + [uri]::EscapeDataString($env:PLUCK_TEXT))
"Searching for: $env:PLUCK_TEXT"
