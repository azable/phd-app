#!/usr/bin/env bash
# Rebuild the embedded fonts (see src/lib/modes/sverlin/fonts/README.md) from nixpkgs' font
# packages and the dejavu-fonts-ttf package, with fontTools from nixpkgs.
set -euo pipefail
cd "$(dirname "$0")/../.."
source_of() { nix build --no-link --print-out-paths "nixpkgs#$1"; }
nix-shell -p 'python3.withPackages (p: [ p.fonttools p.brotli ])' --run "python3 scripts/fonts/subset.py \
  src/lib/modes/sverlin/fonts \
  inter=$(source_of inter) \
  source-serif=$(source_of source-serif) \
  jetbrains-mono=$(source_of jetbrains-mono) \
  atkinson=$(source_of atkinson-hyperlegible-next) \
  comic-neue=$(source_of comic-neue) \
  zilla-slab=$(source_of zilla-slab) \
  dejavu=$(dirname "$(readlink -f node_modules/dejavu-fonts-ttf/package.json)")"
