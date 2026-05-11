Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
docker compose -f (Join-Path $root "deploy/docker-compose.yml") up -d

