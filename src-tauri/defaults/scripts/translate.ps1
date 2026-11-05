[Console]::OutputEncoding = [Text.Encoding]::UTF8
Start-Process ("https://translate.google.com/?sl=auto&tl=en&text=" + [uri]::EscapeDataString($env:PLUCK_TEXT))
"Opened Google Translate"
