#!/usr/bin/perl -p
# Mask ONLY Astro server-island per-request tokens.
s/data-island-id="[^"]*"/data-island-id="MASK"/g;
s/replaceServerIsland\('[^']*'/replaceServerIsland('MASK'/g;
s{(/_server-islands/[A-Za-z0-9_-]+\?)e=[^&"' ]*(&(?:amp;)?)p=[^&"' ]*(&(?:amp;)?)s=[^&"' ]*}{$1e=MASK$2p=MASK$3s=MASK}g;
