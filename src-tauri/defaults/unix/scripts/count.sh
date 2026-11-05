# Counts words, characters and lines.
echo "$(wc -w <<<"$PLUCK_TEXT" | tr -d ' ') words"
echo "$(printf %s "$PLUCK_TEXT" | wc -m | tr -d ' ') characters"
echo "$(wc -l <<<"$PLUCK_TEXT" | tr -d ' ') lines"
