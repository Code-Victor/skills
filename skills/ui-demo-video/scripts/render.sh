#!/usr/bin/env bash
# Render a Remotion demo project (the optional renderer; demo.mjs renders without
# it), after checking its video.json.
#
#   scripts/render.sh <project> draft   # ~4x faster: half size, JPEG frames. For judging the cut.
#   scripts/render.sh <project> final   # 1080p master, PNG frames, CRF 16. Then deliver.mjs.
#   scripts/render.sh <project> final --scale=1.5   # extra args go to remotion (2880x1620 master)
#
# Iterate on drafts; render final once, when the cut is locked. Don't record
# clips while this runs: it takes every core and captures lose frames.
set -euo pipefail

DIR="${1:?Usage: render.sh <project> draft|final [remotion args]}"
MODE="${2:-draft}"
shift 2 || true
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
CORES="$(sysctl -n hw.ncpu 2>/dev/null || nproc)"
# Half the cores by default: a laptop stays usable (and cool) during a long
# render. Pass --concurrency=N to change it; it replaces this default.
JOBS="$(( CORES > 3 ? CORES / 2 : 1 ))"
for a in "$@"; do
  case "$a" in --concurrency=*) JOBS="${a#--concurrency=}" ;; esac
done
EXTRA=()
for a in "$@"; do
  case "$a" in --concurrency=*) ;; *) EXTRA+=("$a") ;; esac
done

node "$SKILL/scripts/check-video.mjs" "$DIR/src/video.json" --public "$DIR/public"

cd "$DIR"
mkdir -p out
case "$MODE" in
  draft)
    npx remotion render DemoVideo out/draft.mp4 --scale=0.5 --image-format=jpeg --jpeg-quality=80 \
      --x264-preset=veryfast --crf=23 --concurrency="$JOBS" ${EXTRA[@]+"${EXTRA[@]}"}
    echo "draft: $DIR/out/draft.mp4" ;;
  final)
    # bt709 with PNG frames: what browsers and players assume for HD, so colors
    # match the app instead of washing out.
    npx remotion render DemoVideo out/demo.mp4 --crf=16 --color-space=bt709 --concurrency="$JOBS" ${EXTRA[@]+"${EXTRA[@]}"}
    echo "final: $DIR/out/demo.mp4"
    echo "next: node $SKILL/scripts/deliver.mjs $DIR/out/demo.mp4 --spec $DIR/src/video.json  (PR copy, captions, poster, checks)" ;;
  *) echo "mode must be draft or final" >&2; exit 2 ;;
esac
