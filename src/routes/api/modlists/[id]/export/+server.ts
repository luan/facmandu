import { db } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';
import * as table from '$lib/server/db/schema';
import { userHasModlistAccess } from '$lib/server/db';
import type { RequestHandler } from './$types';

interface ReleaseInfo {
	version: string;
	download_url: string;
}

async function getReleaseDownloadPath(
	modName: string,
	version: string | null | undefined
): Promise<string | null> {
	try {
		const res = await fetch(`https://mods.factorio.com/api/mods/${modName}`);
		if (!res.ok) return null;
		const data = (await res.json()) as { releases: ReleaseInfo[] };
		if (!data?.releases?.length) return null;
		let release: ReleaseInfo | undefined;
		if (version) {
			release = data.releases.find((r) => r.version === version);
		}
		if (!release) {
			// fallback to latest
			release = data.releases[data.releases.length - 1];
		}
		return release?.download_url ?? null;
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async (event) => {
	// Require authentication
	if (!event.locals.session) {
		return new Response('Unauthorized', { status: 401 });
	}

	const modlistId = event.params.id as string;

	// Access control (owner or collaborator)
	const hasAccess = await userHasModlistAccess(event.locals.session.userId, modlistId);
	if (!hasAccess) {
		return new Response('Forbidden', { status: 403 });
	}

	// Fetch enabled mods for this modlist
	const mods = await db
		.select({ name: table.mod.name, version: table.mod.version })
		.from(table.mod)
		.where(and(eq(table.mod.modlist, modlistId), eq(table.mod.enabled, true)));

	const user = await db
		.select({
			factorioUsername: table.user.factorioUsername,
			factorioToken: table.user.factorioToken
		})
		.from(table.user)
		.where(eq(table.user.id, event.locals.session.userId))
		.get();
	if (!user) {
		return new Response('User does not have a factorio account set', { status: 422 });
	}

	// Build mod-list.json content (base + enabled mods)
	const modlistJson = JSON.stringify(
		{
			mods: [{ name: 'base', enabled: true }, ...mods.map((m) => ({ name: m.name, enabled: true }))]
		},
		null,
		2
	);

	// Build list with resolved download paths (using server-side proxy approach)
	const downloadUrls: string[] = [];
	for (const m of mods) {
		const path = await getReleaseDownloadPath(m.name, m.version);
		if (!path) continue;
		// Use server-side proxy endpoint instead of exposing credentials
		const url = `${event.url.origin}/api/modlists/${modlistId}/download/${encodeURIComponent(m.name)}/${encodeURIComponent(m.version || 'latest')}`;
		downloadUrls.push(url);
	}

	const downloadLines = downloadUrls.join('\n');

	// Assemble shell script that leverages aria2 for concurrent downloads with a built-in TUI progress display
	const script = `
#!/usr/bin/env bash
set -euo pipefail

# If aria2c is missing, try to install it using the best method available on the
# current platform. We cover the most common package managers on macOS, Linux
# (Debian/Ubuntu, Fedora/RHEL, Arch) and Windows (Git-Bash with Chocolatey or
# Winget). When none are available we bail out with a helpful message.

if ! command -v aria2c &>/dev/null; then
  os="$(uname -s)"
  echo "aria2c not found. Attempting to install for $os…" >&2

  install_ok=false

  case "$os" in
    Darwin)
      if command -v brew &>/dev/null; then
        brew install aria2 && install_ok=true
      fi
      ;;

    Linux)
      if command -v apt-get &>/dev/null; then
        sudo apt-get update && sudo apt-get install -y aria2 && install_ok=true
      elif command -v dnf &>/dev/null; then
        sudo dnf install -y aria2 && install_ok=true
      elif command -v pacman &>/dev/null; then
        sudo pacman -Sy --noconfirm aria2 && install_ok=true
      fi
      ;;

    MINGW*|MSYS*)
      # Git-Bash on Windows
      if command -v choco &>/dev/null; then
        choco install -y aria2 && install_ok=true
      elif command -v winget &>/dev/null; then
        winget install --id=aria2 -e --silent && install_ok=true
      fi
      ;;
  esac

  if ! $install_ok; then
    echo "Automatic installation failed. Please install 'aria2' manually and re-run this script." >&2
    exit 1
  fi
fi

# Create the Factorio mod-list.json file
cat > mod-list.json <<'EOF'
${modlistJson}
EOF

# Write the list of download URLs to a temporary file
cat > downloads.txt <<'URLS'
${downloadLines}
URLS

echo "Starting mod downloads (using aria2)..."
aria2c --enable-color=true \
       --console-log-level=error \
       --show-console-readout=true \
       --summary-interval=0 \
       --max-concurrent-downloads=8 \
       --continue=true \
       -i downloads.txt
`;

	return new Response(script, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-store'
		}
	});
};
