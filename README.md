# Alshival Bot

Alshival is an AI agent stack with an admin panel, platform connectors, shared agent configuration, MCP-style local tools, and guild-specific knowledge.

The first supported platform is Discord. The bot listens for normal messages that mention `alshival`, keeps channel chat history, and responds through the central agent response endpoint. GitHub repositories can be attached as guild knowledge sources, cloned locally, embedded into ChromaDB, and searched by the agent.

## Project Layout

```text
.
├── admin/                  # Next.js admin panel and API routes
├── backend/                # Agent backend, Discord runtime, reminders, platform manager
├── mcp/                    # Local MCP-style tool server
├── platform/               # Platform-specific runtime data
│   └── Discord/Guilds/     # Discord guild-specific cloned sources/config
├── chroma/                 # Local ChromaDB persisted data
├── assets/                 # App assets, including logo images
├── bot.db                  # Local SQLite runtime database
├── .env.example            # Environment variable template
└── start.sh                # Starts the full local stack
```

## Stack

- Admin: Next.js, React, TypeScript
- Backend: Node.js, TypeScript, `discord.js`
- Database: local SQLite at `./bot.db`
- Vector DB: ChromaDB in Docker
- Embeddings: `nomic-ai/nomic-embed-text-v1.5`
- Tools: local HTTP MCP-style server in `mcp/server.py`
- Platforms: Discord now, with structure for additional platforms later

## Features

- Configure Discord global settings and bot token
- Start and stop the Discord bot from the admin panel
- View Discord guilds and manage guild-specific settings
- Override default agent provider/model per Discord guild
- Store chat history per Discord channel
- Clear stored guild/channel chat history
- Add GitHub repos as guild knowledge sources
- Clone and delete guild-specific repo sources under `platform/Discord/Guilds/<guild-id>/`
- Embed Markdown files into per-guild Chroma collections
- Search guild knowledge with `discord_guild_kb`
- Search cloned codebases when the agent needs deeper repo context
- Configure OpenAI and Anthropic API keys
- Configure default Agent provider/model
- Configure GitHub access, PATs, and SSH keys
- MCP admin page for local tools
- GIF search tool through Tenor
- Reminder tools with a once-per-minute reminder delivery job

## Requirements

- Node.js 20+ recommended
- npm
- Python 3
- Docker
- Git
- `rg` / ripgrep for code search tools

On Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y git docker.io python3 ripgrep
```

Install Node using your preferred method. The Raspberry Pi deployment currently uses nvm with Node `v24.15.0`.

## Setup

Install dependencies:

```bash
cd backend
npm ci

cd ../admin
npm ci
```

Create local environment config:

```bash
cd ..
cp .env.example .env
```

Edit `.env` as needed:

```env
ADMIN_PORT=3000
ADMIN_HOST=127.0.0.1
BACKEND_HOST=127.0.0.1
BACKEND_PORT=4000
MCP_HOST=127.0.0.1
MCP_PORT=4100
CHROMA_HOST=127.0.0.1
CHROMA_PORT=8000
```

For LAN or remote access to the admin panel, set:

```env
ADMIN_HOST=0.0.0.0
```

## Running Locally

Start the full stack:

```bash
./start.sh
```

This starts:

- ChromaDB Docker container
- MCP tool server
- backend server
- Next.js admin panel

Default URLs:

```text
Admin:   http://127.0.0.1:3000
Backend: http://127.0.0.1:4000
MCP:     http://127.0.0.1:4100
Chroma:  http://127.0.0.1:8000
```

If a port is already in use, update `.env` and restart `./start.sh`.

## Admin Panel

The admin panel includes:

- General
  - Language Models
- Agent
- MCP
- Platforms
  - Discord
    - Global Settings
    - Guilds
  - GitHub
    - Global Settings

Use the admin panel to configure credentials, provider/model settings, Discord bot state, GitHub access, MCP tools, and guild knowledge.

## Discord Setup

Create a Discord application and bot in the Discord Developer Portal.

Required OAuth2 scopes:

```text
bot
```

Useful bot permissions:

```text
View Channels
Send Messages
Read Message History
Embed Links
Attach Files
```

The bot responds when a message contains:

```text
alshival
```

It does not require slash commands or prefix commands.

## GitHub Knowledge Sources

GitHub sources are configured per Discord guild.

When a repo is added as a guild knowledge source:

1. The repo is cloned under `platform/Discord/Guilds/<guild-id>/`.
2. Markdown files are embedded into the guild's Chroma collection.
3. The agent can search the collection with `discord_guild_kb`.
4. The agent can search the cloned codebase for deeper implementation details.

When a source is removed, the corresponding local clone is deleted.

For private repos, configure GitHub access in the GitHub platform settings. A PAT with read-only repository access is enough for cloning and listing repos.

## Agent Settings

Default agent settings are configured under `Agent`.

Each Discord guild can override:

- provider
- model ID

Model names are entered directly, for example:

```text
gpt-5.5
```

The app verifies model availability when saving.

## MCP Tools

The local MCP-style server runs from:

```text
mcp/server.py
```

Current tools include:

- GIF search
- Discord guild knowledge search
- Codebase search
- Reminders

Tool configuration is available in the admin panel under `MCP`.

## Runtime Data

Runtime files are intentionally local and should not be committed:

```text
bot.db
bot.db-shm
bot.db-wal
chroma/
platform/
admin/node_modules/
backend/node_modules/
admin/.next/
```

SQLite uses WAL mode, so if copying `bot.db` manually, checkpoint it first:

```bash
sqlite3 bot.db 'PRAGMA wal_checkpoint(FULL);'
```

Then copy `bot.db` after the checkpoint completes.

## Raspberry Pi Deployment

The current Raspberry Pi target is available through:

```bash
ssh RaspberryPi-16gb-2
```

The app is deployed at:

```text
/home/data-team/alshival-bot
```

The systemd service is:

```text
alshival.service
```

Useful service commands:

```bash
sudo systemctl status alshival
sudo systemctl restart alshival
sudo systemctl stop alshival
sudo journalctl -u alshival -f
```

The service runs:

```bash
/home/data-team/alshival-bot/start.sh
```

It sources nvm before starting so Node is available to systemd.

To access the admin panel through an SSH tunnel:

```bash
ssh -L 3004:127.0.0.1:3004 RaspberryPi-16gb-2
```

Then open:

```text
http://127.0.0.1:3004
```

## Updating The Raspberry Pi

From the Pi:

```bash
cd /home/data-team/alshival-bot
git pull

cd backend
npm ci

cd ../admin
npm ci

sudo systemctl restart alshival
```

If runtime state changed locally and needs to be copied to the Pi:

```bash
sqlite3 bot.db 'PRAGMA wal_checkpoint(FULL);'
rsync -az --delete .env bot.db chroma platform RaspberryPi-16gb-2:~/alshival-bot/
```

## Development Commands

Backend:

```bash
cd backend
npm run start
npm run typecheck
```

Admin:

```bash
cd admin
npm run dev
npm run build
npm run lint
```

Full stack:

```bash
./start.sh
```
