# Uppercases the text.
awk '{ printf "%s%s", (NR > 1 ? "\n" : ""), toupper($0) }' <<<"$PLUCK_TEXT"
