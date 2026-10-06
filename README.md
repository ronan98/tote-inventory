# Home Inventory

A self-hosted inventory for household storage totes. Scan a tote's QR label to see its contents photo, keep a searchable item list, and track things taken out so they are easy to put back.

- Mobile-friendly tote pages, photo uploads, search, and activity history.
- Printable QR labels, including fixed-size PDFs for Avery 15264 / 5164 / 8164 sheets.
- Taken-out items in one place, with a return-to-tote action.
- Optional local AI suggestions from uploaded photos. You review what gets added.
- SQLite records and photos stored on your own server, with downloadable and scheduled backups.

There is no tote-count limit, trial, or paid AI service required. The app does not include accounts or authentication: use it on a trusted home network. Anyone who can reach it can view and edit the inventory. Do not expose its port to the internet without an authentication proxy or a private VPN.

## Get running

Install [Docker Engine with the Compose plugin](https://docs.docker.com/engine/install/) on Linux, or [Docker Desktop](https://docs.docker.com/desktop/) on Windows/macOS with **Linux containers**. Check that `docker compose version` works. No host installation of Node.js, Python, or a database is needed.

The clean-install workflow has been tested on Debian Linux with x86-64 hardware. Other host architectures have not been verified. Leave memory available for the initial source build as well as the running services; the app's default runtime limit is 1 GB.

1. Download this repository using **Code → Download ZIP** and extract it, or clone it. Open a terminal in the extracted project directory.
2. Copy the example configuration:

   ```sh
   cp .env.example .env
   ```

   In Windows PowerShell, use `Copy-Item .env.example .env`.

3. Edit `.env`. The one required setting is the address your phone will use:

   ```dotenv
   APP_ORIGIN=http://192.168.1.50:8080
   ```

   Replace the example IP with your server's **LAN IP**. Keep `:8080` unless you also change `HTTP_PORT`. Reserve that IP in your router so printed QR codes keep working. Do not use `localhost` as the address for phones.

4. Build and start:

   ```sh
   docker compose up -d --build
   docker compose ps
   ```

   The first build downloads dependencies and may take several minutes. Open your configured address from a phone on the same network. Allow the chosen port through the server's local firewall if needed.

Add a tote, upload a top-down photo, and add items. Open **Labels** to print selected totes, or **More → Print all tote labels**. For Avery sheets, use **Open print PDF**, then print on US Letter paper at Actual size / 100%, one page per sheet. Test alignment on plain paper first.

## Optional local AI

AI is off by default. To enable it, uncomment these two lines in `.env`:

```dotenv
COMPOSE_PROFILES=ai
AI_URL=http://ollama:11434
```

Then start the additional services and download the default vision model:

```sh
docker compose up -d --build
docker compose exec ollama ollama pull qwen3-vl:2b-instruct-q4_K_M
```

The model download is roughly 1.9 GB. The default AI service has a 4 GB memory limit and uses two CPU cores; leave additional memory available for the app, Docker, and the operating system. CPU analysis can take several minutes. Images stay in the local app/Ollama network; there is no metered AI API or subscription.

Upload a photo after the model is ready. Photos are analyzed **one at a time**, and suggestions can be edited, accepted, or dismissed. Enabling AI does not automatically analyze photos uploaded while it was disabled. Use the tote's analysis action for those photos, or retry an analysis that ran before the model finished downloading. See [AI configuration](docs/CONFIGURATION.md#local-ai) for model changes and troubleshooting.

## Keep your data

The default installation uses Docker named volumes for inventory/photos, backups, and AI models. Rebuilding or recreating containers preserves these volumes. Keep the same Compose project name when updating. See [Docker's volume documentation](https://docs.docker.com/engine/storage/volumes/) for how container and volume lifetimes differ.

Before an update, use **More → Download a backup** and save the ZIP somewhere other than this server. Replace the source with the newer release, retain your `.env` and any private Compose override, then run:

```sh
docker compose up -d --build
```

The database is migrated automatically when necessary. Keep the backup and previous source/image version until the update is verified; a database migrated by a newer release may not work with an older one.

To stop without deleting data:

```sh
docker compose stop
```

**Do not use `docker compose down -v` or prune the inventory volumes unless you intend to erase their contents.** Daily backups are kept on the same Docker host, so copy backups elsewhere for protection against disk failure. Details and restore instructions are in [Backup and restore](docs/BACKUP-RESTORE.md).

## Configuration and troubleshooting

See [Configuration](docs/CONFIGURATION.md) for port changes, HTTPS through an existing reverse proxy, multiple installations, and all supported settings.

```sh
docker compose ps
docker compose logs --tail=100 app backups
```

If AI is enabled:

```sh
docker compose logs --tail=100 ai-worker ollama
```

If a QR opens the wrong address, check `APP_ORIGIN`, restart with `docker compose up -d --build`, and reprint the labels. If the site works on the server but not on a phone, check the LAN address, firewall, and whether the phone is on an isolated guest network.

## Development

The app uses Next.js, React, TypeScript, SQLite, and Sharp. Docker handles the production build and native dependencies. For local development, use the Node.js version in `Dockerfile` and run `npm ci`, `npm run dev`, `npm test`, and `npm run typecheck`. Application data defaults to `./data`; use a separate `INVENTORY_DATA_DIR` for test/development data.

## Third-party components

Dependencies and bundled fonts retain their own licenses. See [Third-party notices](THIRD-PARTY-NOTICES.md); the full Noto font license is included with the fonts. Optional AI model weights are downloaded separately.
