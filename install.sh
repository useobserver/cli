#!/bin/sh
# Observer CLI installer. Detects OS + architecture, downloads the matching
# binary from the latest GitHub Release, and installs it to a directory on PATH.
#
# Default usage (installs to a writable dir on your PATH, no sudo needed):
#   curl -fsSL https://raw.githubusercontent.com/useobserver/cli/main/install.sh | sh
#
# Override the install directory. The variable goes on `sh`, not `curl`, because
# the script runs under `sh` -- putting it on `curl` has no effect:
#   curl -fsSL .../install.sh | OBSERVER_INSTALL_DIR="$HOME/.local/bin" sh
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

on_path() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Pick the install directory. An explicit OBSERVER_INSTALL_DIR always wins.
# Otherwise prefer a directory that is already on PATH AND writable without sudo,
# so `observer` works immediately and we never prompt for a password. The
# candidates are ordered by preference; /usr/local/bin is last because it does
# not exist by default on Apple Silicon macOS (Homebrew lives in /opt/homebrew),
# which is what made the old unconditional `/usr/local/bin` default fail with
# "No such file or directory".
dest="${OBSERVER_INSTALL_DIR:-}"
if [ -z "$dest" ]; then
  for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do
    if on_path "$d" && [ -d "$d" ] && [ -w "$d" ]; then
      dest="$d"
      break
    fi
  done
fi
# Nothing writable on PATH: fall back to ~/.local/bin (created below). We warn
# about PATH at the end if it is not already there.
[ -n "$dest" ] || dest="$HOME/.local/bin"

echo "Downloading ${asset}"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
# -f makes curl exit non-zero on HTTP errors (e.g. a 404 when no release exists
# yet), so `set -e` aborts before we install a half-written or error-page file.
curl -fSL --proto '=https' --tlsv1.2 "$url" -o "$tmp"
chmod +x "$tmp"

# Ensure the destination exists before moving into it. The old script moved into
# a possibly-missing directory and failed with "No such file or directory".
if ! mkdir -p "$dest" 2>/dev/null; then
  if command -v sudo >/dev/null 2>&1; then
    echo "Elevating to create $dest (set OBSERVER_INSTALL_DIR to a user dir to skip sudo)"
    sudo mkdir -p "$dest"
  else
    echo "Cannot create $dest and sudo is unavailable. Set OBSERVER_INSTALL_DIR to a writable dir." >&2
    exit 1
  fi
fi

if [ -w "$dest" ]; then
  mv "$tmp" "$dest/$BIN"
elif command -v sudo >/dev/null 2>&1; then
  echo "Elevating to write $dest (set OBSERVER_INSTALL_DIR to a user dir to skip sudo)"
  sudo mv "$tmp" "$dest/$BIN"
else
  echo "Cannot write $dest and sudo is unavailable. Set OBSERVER_INSTALL_DIR to a writable dir." >&2
  exit 1
fi
trap - EXIT

echo "Installed: $("$dest/$BIN" --version) -> $dest/$BIN"

# If the install dir is not on PATH, the freshly installed binary would appear
# "command not found". Tell the user exactly how to fix it.
if ! on_path "$dest"; then
  echo
  echo "NOTE: $dest is not on your PATH. Add it (zsh):"
  echo "  echo 'export PATH=\"$dest:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
  echo "For bash, use ~/.bashrc instead of ~/.zshrc."
fi
