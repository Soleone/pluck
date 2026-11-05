# Opens Google Translate on the text.
urlencode() {
  local LC_ALL=C s=$1 c
  while [ -n "$s" ]; do
    c=${s:0:1} s=${s:1}
    case $c in [a-zA-Z0-9.~_-]) printf %s "$c" ;; *) printf %%%02X "'$c" ;; esac
  done
}
open=$(command -v xdg-open || echo open)
"$open" "https://translate.google.com/?sl=auto&tl=en&text=$(urlencode "$PLUCK_TEXT")" >/dev/null 2>&1 &
echo "Opened Google Translate"
