#!/usr/bin/env sh
# Build the helper for every platform into dist/ and print each file's sha256.
# The GitHub workflow runs exactly this; so can you (Go from tailnet/go.mod):
#   cd tailnet && sh build.sh
# The builds are reproducible (no cgo, -trimpath, no VCS stamp), so the
# checksums printed here are the ones tailnet/release.json pins.
set -eu
cd "$(dirname "$0")"
rm -rf dist && mkdir dist
for target in windows/amd64 windows/arm64 darwin/amd64 darwin/arm64 linux/amd64 linux/arm64; do
  os=${target%/*}; arch=${target#*/}; ext=""
  [ "$os" = windows ] && ext=".exe"
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -buildvcs=false -ldflags "-s -w" \
    -o "dist/ledgr-tailnet-$os-$arch$ext" .
done
cd dist && sha256sum ledgr-tailnet-* | tee SHA256SUMS
