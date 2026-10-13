#!/usr/bin/env bash
# Polished path: create a Remotion project wired to video.json, with the remocn
# pieces the template uses.
#
#   scripts/new-remotion.sh <dir>
#   scripts/render.sh <dir> draft                  # judge the cut (~3 min / minute of video)
#   scripts/render.sh <dir> final                  # the master (~11 min / minute of video)
#   cd <dir> && npm run dev                        # or preview and scrub in Remotion Studio
#
# Put recordings in <dir>/public/clips/ and describe the video in
# <dir>/src/video.json (same format scripts/assemble.mjs reads).
#
# Fast: the first run builds a base project (create-video, npm install, remocn
# components; about 2 minutes) into ~/.cache/ui-demo-video and every later run
# copies it (seconds; a copy-on-write clone on APFS). The cache is keyed on the
# component list below, so adding a component rebuilds it once. The template's
# own src/ is always copied fresh, so template edits never need a rebuild.
set -euo pipefail

DIR="${1:?Usage: new-remotion.sh <dir>}"
SKILL="$(cd "$(dirname "$0")/.." && pwd)"

# Every remocn piece the template imports. Keep in sync with template/src.
COMPONENTS=(backdrop stage zoom-blur soft-blur-in whip-pan push-through focus-pull word-push micro-scale-fade)

if [[ -e "$DIR" ]]; then
  echo "$DIR already exists; pick a new folder." >&2
  exit 1
fi

# The project holds the only copy of the recordings: never in a folder a
# restart empties (/tmp, macOS per-user temp, an agent's session scratchpad).
ABS="$(cd "$(dirname "$DIR")" && pwd)/$(basename "$DIR")"
if [[ "$ABS" =~ ^(/private)?/tmp/|^(/private)?/var/folders/|/scratchpad/ ]] && [[ "${ALLOW_TEMP:-}" != 1 ]]; then
  echo "$ABS is in a temporary folder that is emptied on restart." >&2
  echo "Use a folder that lasts, e.g. ~/Downloads/<name>-demo/video (or ALLOW_TEMP=1 for a throwaway)." >&2
  exit 1
fi

KEY="$(printf '%s ' "${COMPONENTS[@]}" | shasum | cut -c1-10)"
CACHE="${UI_DEMO_CACHE:-$HOME/.cache/ui-demo-video}/remotion-base-$KEY"

build_base() {
  local base="$1" parent name
  parent="$(dirname "$base")"
  name="$(basename "$base")"
  mkdir -p "$parent"
  rm -rf "$base.tmp"
  (
    cd "$parent"
    # create-video wants the folder name right after --yes.
    npx -y create-video@latest --yes --blank "$name.tmp"
    cd "$name.tmp"
    npm install --silent
    npx remotion add @remotion/transitions @remotion/media @remotion/google-fonts
    rm -f src/Composition.tsx
    cp "$SKILL"/template/remotion.config.ts "$SKILL"/template/components.json .
    node -e '
      const fs = require("fs");
      const t = JSON.parse(fs.readFileSync("tsconfig.json", "utf8"));
      Object.assign(t.compilerOptions, {
        baseUrl: ".",
        paths: { "@/*": ["./src/*"] },
        lib: ["es2020", "dom"],
        resolveJsonModule: true,
      });
      fs.writeFileSync("tsconfig.json", JSON.stringify(t, null, 2) + "\n");
    '
    # remocn components are copied into src/components/remocn (you own them).
    npx -y shadcn@latest add $(printf '@remocn/%s ' "${COMPONENTS[@]}") --yes
  )
  mv "$base.tmp" "$base"
}

if [[ ! -d "$CACHE" ]]; then
  echo "Building the base project once (about 2 minutes); later runs copy it."
  build_base "$CACHE"
fi

mkdir -p "$(dirname "$DIR")"
# -c: clone on APFS (instant, no extra disk); plain copy elsewhere.
cp -Rc "$CACHE" "$DIR" 2>/dev/null || cp -R "$CACHE" "$DIR"
cd "$DIR"
cp "$SKILL"/template/src/* src/
cp "$SKILL"/template/remotion.config.ts "$SKILL"/template/components.json .
mkdir -p public/clips public/brand
npx tsc --noEmit

echo
echo "Ready: $(pwd)"
echo "  1. Copy recordings into public/clips/ (and a logo into public/brand/)"
echo "  2. Edit src/video.json, then: node $SKILL/scripts/check-video.mjs src/video.json"
echo "  3. $SKILL/scripts/render.sh $(pwd) draft   then   ... final"
