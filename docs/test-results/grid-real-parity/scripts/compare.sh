#!/bin/bash
# usage: compare.sh <build>
BUILD=$1
S=/private/tmp/claude-501/-Users-asafcohen-Desktop-ATL-Content-Network-atomic-content-platform/94dc5c20-769e-473a-a764-deede9b35ec3/scratchpad
OUTR=/Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/docs/test-results/grid-real-parity
cd $OUTR
for s in coffeeactually dogslabs gadgetskoala hiddenstorydaily; do
  B=base/$BUILD/$s/pages; R=branch/$BUILD/$s/pages
  cmp -s $B/_status.txt $R/_status.txt || echo "STATUS-DIFF $BUILD $s"
  for f in $(cd $B && ls *.body); do
    n=${f%.body}
    if cmp -s $B/$f $R/$f; then echo "$BUILD $s $n IDENTICAL ($(wc -c < $B/$f | tr -d ' ')B)"; continue; fi
    perl -p $S/mask.pl < $B/$f > $B/$n.masked; perl -p $S/mask.pl < $R/$f > $R/$n.masked
    if cmp -s $B/$n.masked $R/$n.masked; then
      echo "$BUILD $s $n IDENTICAL-after-masking ($(grep -o 'MASK' $B/$n.masked | wc -l | tr -d ' ') masks)"
    else
      echo "$BUILD $s $n DIFFERENT"; diff <(tr '>' '\n' < $B/$n.masked) <(tr '>' '\n' < $R/$n.masked) | head -20
    fi
  done
  # CSS
  if cmp -s $B/css/_list.txt $R/css/_list.txt; then
    for c in $(cat $B/css/_list.txt); do b=$(basename $c); cmp -s $B/css/$b $R/css/$b && echo "$BUILD $s css $b BYTE-IDENTICAL ($(wc -c < $B/css/$b | tr -d ' ')B)" || echo "$BUILD $s css $b CONTENT-DIFF"; done
  else
    echo "$BUILD $s CSS-NAMES-DIFF"; diff $B/css/_list.txt $R/css/_list.txt
  fi
done
