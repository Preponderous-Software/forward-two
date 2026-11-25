#!/usr/bin/env bash
# Builds engine/bridge.cpp into web/engine/forward-two.{js,wasm} with the
# Strata web kit from a pinned Strata release (downloaded once, SHA-checked).
#   tools/build-engine.sh            # needs emsdk 6.0.11 active (or EMSDK=/path)
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STRATA_VERSION=0.10.0
STRATA_SHA256=bb86b974c7e0309db91625ba5ee157273704c77d93f4338c8a63ee625e3d56de
work="$root/.strata"
tarball="$work/strata-$STRATA_VERSION-wasm32-emscripten.tar.gz"
mkdir -p "$work"
if [ ! -f "$tarball" ]; then
  curl -fsSL -o "$tarball" "https://github.com/Preponderous-Software/strata/releases/download/v$STRATA_VERSION/strata-$STRATA_VERSION-wasm32-emscripten.tar.gz"
fi
echo "$STRATA_SHA256  $tarball" | sha256sum -c --quiet
[ -d "$work/kit" ] || tar -xzf "$tarball" -C "$work"
if ! command -v emcc >/dev/null; then
  : "${EMSDK:=/root/emsdk}"
  # shellcheck disable=SC1091
  EMSDK_QUIET=1 source "$EMSDK/emsdk_env.sh" >/dev/null
fi
exports=_f2_set_terrain,_f2_texture_create,_f2_texture_update,_f2_mesh_add,_f2_mesh_remove,_f2_mesh_transform,_f2_mesh_visible,_f2_items,_f2_points,_f2_lines,_f2_wide_lines,_f2_lights,_f2_labels,_f2_levels,_f2_clear,_f2_mesh_count,_f2_mesh_drop_copy,_f2_mesh_missing,_f2_mesh_refill
KIT_SOURCE="$root/engine/bridge.cpp" KIT_OUT="$root/web/engine" KIT_NAME=forward-two \
KIT_EXPORT_NAME=createForwardTwo KIT_EXPORTS="$exports" KIT_WORK="$work/build" \
STRATA_TARBALL="$tarball" STRATA_SHA256="$STRATA_SHA256" \
  bash "$work/kit/build-kit.sh"
