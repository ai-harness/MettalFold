#!/bin/bash
# Runs ON THE BOX. Reads wanted file names (one per line, stdin; output of tools/pending-files.sh on each Mac)
# and prints "name<TAB>newest box path" for each, plus the sibling .csv of every .xlsx. Missing: "NOT FOUND".
while read -r n; do [ -z "$n" ] && continue
  for m in "$n" $( [[ "$n" == *.xlsx ]] && echo "${n%.xlsx}.csv" ); do
    p=$(find /workspace -type f -name "$m" -not -path '*/node_modules/*' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
    [ -z "$p" ] && [ "$m" != "$n" ] && continue; echo -e "$m\t${p:-NOT FOUND}"
  done
done
