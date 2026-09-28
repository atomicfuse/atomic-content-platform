#!/bin/bash
BUILD=$1
OUTR=/Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/docs/test-results/grid-real-parity
for s in coffeeactually dogslabs gadgetskoala hiddenstorydaily; do
 for pg in home article; do
  for SIDE in base branch; do
    [ $SIDE = base ] && PORT=8788 || PORT=8790
    D=$OUTR/$SIDE/$BUILD/$s/pages/islands-$pg; mkdir -p $D; rm -f $D/*
    i=0
    grep -o "fetch('/_server-islands/[^']*'" $OUTR/$SIDE/$BUILD/$s/pages/$pg.body | sed "s/fetch('//; s/'$//" | while read u; do
      i=$((i+1)); curl -s -H "Referer: http://localhost:$PORT/?_atl_site=$s" "http://localhost:$PORT$u&_atl_site=$s" > $D/$(printf %02d $i)-$(echo $u | sed 's#/_server-islands/##; s#?.*##').html
    done
  done
  B=$OUTR/base/$BUILD/$s/pages/islands-$pg; R=$OUTR/branch/$BUILD/$s/pages/islands-$pg
  if diff -r -q $B $R >/dev/null; then echo "$BUILD $s $pg islands IDENTICAL ($(ls $B | wc -l | tr -d ' ') responses, $(cat $B/* | wc -c | tr -d ' ')B)"; else echo "$BUILD $s $pg islands DIFFERENT"; diff -r $B $R | head -10; fi
 done
done
