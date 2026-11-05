[Console]::OutputEncoding = [Text.Encoding]::UTF8
$text = $env:PLUCK_TEXT
"$(($text -split '\s+' | Where-Object { $_ }).Count) words"
"$($text.Length) characters"
"$(($text -split "\n").Count) lines"
