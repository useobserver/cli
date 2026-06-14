#!/bin/sh
# Observer CLI installer. Detects OS + architecture, downloads the matching
# binary from the latest GitHub Release, and installs it to a directory on PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/useobserver/cli/main/install.sh | sh
#
# Override the install directory:
#   OBSERVER_INSTALL_DIR=$HOME/.local/bin curl -fsSL .../install.sh | sh
#
# Windows: download observer-windows-x64.exe from the Releases page directly.
set -eu

REPO="useobserver/cli"
BIN="observer"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)

case "$os" in
  linux) os=linux ;;
  darwin) os=darwin ;;
  *) echo "Unsupported OS: $os. Download a binary from https://github.com/$REPO/releases" >&2; exit 1 ;;
esac

case "$arch" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "Unsupported architecture: $arch. Download a binary from https://github.com/$REPO/releases" >&2; exit 1 ;;
esac

asset="observer-${os}-${arch}"
url="https://github.com/${REPO}/releases/latest/download/${asset}"
dest="${OBSERVER_INSTALL_DIR:-/usr/local/bin}"

echo "Downloading ${asset}"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
# -f makes curl exit non-zero on HTTP errors (e.g. a 404 when no release exists
# yet), so `set -e` aborts before we install a half-written or error-page file.
curl -fSL --proto '=https' --tlsv1.2 "$url" -o "$tmp"
chmod +x "$tmp"

if [ -w "$dest" ]; then
  mv "$tmp" "$dest/$BIN"
elif command -v sudo >/dev/null 2>&1; then
  echo "Elevating to write $dest (set OBSERVER_INSTALL_DIR to install without sudo)"
  sudo mv "$tmp" "$dest/$BIN"
else
  echo "Cannot write $dest and sudo is unavailable. Set OBSERVER_INSTALL_DIR to a writable dir." >&2
  exit 1
fi
trap - EXIT

echo "Installed: $("$dest/$BIN" --version) -> $dest/$BIN"
