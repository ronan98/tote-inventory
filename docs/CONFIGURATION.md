# Configuration

Copy `.env.example` to `.env` in the directory containing `compose.yaml`. Edit the file before first startup. Docker Compose reads it automatically; you do not need to export its settings in your shell.

After changes, run `docker compose up -d --build` to recreate affected services. `docker compose restart` alone does not apply new environment values. You can check the resolved configuration with `docker compose config`.

## Required address

`APP_ORIGIN` is the base address used in QR codes and allowed for browser mutations. It must be an HTTP or HTTPS origin with a hostname/IP and an optional port, without a URL path, query, or credentials.

```dotenv
APP_ORIGIN=http://192.168.1.50:8080
```

Use the address phones actually open, including the protocol and any nonstandard port. A phone interprets `localhost` as itself. A stable LAN IP, usually reserved through the router, is the simplest option. A local hostname works only if every scanning device can resolve it.

Changing this address does not change tote identities, but QR codes already printed still contain the old address. Reprint them, or maintain a redirect from the old address.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `APP_ORIGIN` | Required | Stable address opened by phones and embedded in QR codes. |
| `HTTP_PORT` | `8080` | Host port published by the app. Include it in `APP_ORIGIN` for HTTP. |
| `HTTP_BIND_ADDRESS` | `0.0.0.0` | Host interface to listen on; all interfaces by default. |
| `APP_TMP_SIZE` | `512m` | RAM-backed temporary storage for uploads and UI ZIP exports. The app also has a 1 GB container memory limit. Use scheduled backups for large inventories. |
| `COMPOSE_PROFILES` | Unset | Set to `ai` to start Ollama and the AI worker. |
| `AI_URL` | Unset | Set to `http://ollama:11434` to enable suggestions in the app. |
| `AI_MODEL` | `qwen3-vl:2b-instruct-q4_K_M` | Local vision model; download the same name into Ollama. |
| `AI_MEMORY_LIMIT` | `4g` | Ollama container memory and memory/swap ceiling. |
| `AI_CPU_LIMIT` | `2` | Ollama container CPU limit. |
| `BACKUP_RETENTION` | `7` | Keep the newest 1–7 completed scheduled archives. |
| `BACKUP_INTERVAL_SECONDS` | `86400` | Time between successful scheduled backups; 3600–604800 seconds. |
| `BACKUP_STARTUP_DELAY_SECONDS` | `300` | Wait before the first scheduled backup; 0–86400 seconds. |
| `COMPOSE_PROJECT_NAME` | `home-inventory` | Names the Compose installation, including its volumes and network. |
| `IMAGE_REF` | `home-inventory:local` | Image name/tag for source builds or a trusted prebuilt image. |
| `IMAGE_PULL_POLICY` | `build` | Build from source by default; use `missing` with a trusted prebuilt image. |

The root Compose file sets `INVENTORY_DATA_DIR=/data` and `BACKUP_DIR=/backups` inside containers. These are mounted volumes, not host directory settings. Styling, the application name, and label text are not configurable environment settings.

## Existing HTTPS reverse proxy

HTTP on a trusted LAN is the simplest setup. HTTPS can use an existing reverse proxy and a certificate trusted by the scanning devices. For example:

```dotenv
APP_ORIGIN=https://inventory.example.com
HTTP_PORT=8080
HTTP_BIND_ADDRESS=127.0.0.1
```

A reverse proxy running directly on the same server can forward to `http://127.0.0.1:8080`. Preserve the original `Host` header and pass the original protocol as `X-Forwarded-Proto: https`. The browser must open exactly the configured `APP_ORIGIN`. Configure the proxy's upload limit high enough for your contents photos.

For a reverse proxy in another container, `127.0.0.1` refers to that proxy's own container. Connect it to the inventory Docker network and forward to `http://app:3000`, or use an appropriate host address instead. Network/proxy configuration is managed separately from this Compose file.

The HTTPS hostname must resolve on each phone to a reachable server address. For access without installing a private certificate on every phone, use a certificate issued by a publicly trusted authority. DNS-based certificate validation can issue a certificate for a domain without exposing this app publicly.

The app has no built-in authentication. HTTPS encrypts the connection but does not control who can view or edit. Keep it on a trusted LAN, or put authentication/a private VPN in front of it. The repository does not configure your router, DNS provider, certificate account, or reverse proxy.

## Local AI

Uncomment both `COMPOSE_PROFILES=ai` and `AI_URL=http://ollama:11434`, then follow the model download in [README](../README.md#optional-local-ai). Compose profiles enable the extra services; `AI_URL` enables photo analysis in the app. Both are needed for the bundled setup.

The AI worker processes one photo at a time. The default configuration uses CPU inference, limits Ollama to one loaded model/request, and unloads the model after analysis. Suggestions require human review before becoming inventory items.

To use another **local vision model**, set `AI_MODEL` and download that exact name:

```sh
docker compose exec ollama ollama pull your-model-name
docker compose up -d --build
```

The default command in README uses a literal model name because `.env` values are not automatically shell variables. Replace `your-model-name` with the value you chose. Larger models may need higher resource limits and may exceed the five-minute analysis timeout. Model compatibility with structured vision responses varies.

`AI_URL` is restricted to HTTP URLs with the local hosts `ollama`, `localhost`, `127.0.0.1`, or `[::1]`, without credentials. It is not a general remote or paid AI API setting. Inside Docker, use the bundled `ollama` hostname; `localhost` would point to the app/worker container itself. Ollama is not published on a host port.

If suggestions fail, check:

```sh
docker compose exec ollama ollama list
docker compose logs --tail=100 ai-worker ollama
```

Confirm the configured model is downloaded and the host has enough available memory. Use the retry/analysis action on the tote after resolving the problem. Existing photos are not automatically queued when AI is first enabled.

To disable AI, comment out `COMPOSE_PROFILES` and `AI_URL`, stop its services, then recreate the app:

```sh
docker compose --profile ai stop ai-worker ollama
docker compose up -d --build
```

The model volume remains for a future restart. Manual item entry continues to work.

## Multiple installations

Set a unique `COMPOSE_PROJECT_NAME`, `HTTP_PORT`, and matching `APP_ORIGIN` for each installation **before first startup**. For example, another installation might use `home-inventory-workshop` and port `8081`.

Keep the project name stable afterwards. Changing it creates a different set of named volumes and makes the app appear empty; it does not transfer the original inventory. Back up and restore when deliberately moving data between installations.
