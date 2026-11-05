# Appends the text, with where it came from, to bookmarks.md in the config folder.
printf -- '- %s [%s] %s\n  %s\n' "$(date '+%Y-%m-%d %H:%M')" "$PLUCK_APP" "$PLUCK_TITLE" "$(tr '\n' ' ' <<<"$PLUCK_TEXT")" >>bookmarks.md
echo "Saved to bookmarks.md in the config folder"
