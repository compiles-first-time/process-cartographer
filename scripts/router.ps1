#!/usr/bin/env pwsh
# Start / stop / check the Loom LLM router (LiteLLM proxy).
# Usage: scripts\router.ps1 [start|stop|status|logs]
#
# Requires Docker. The proxy exposes an OpenAI-compatible endpoint at
# http://localhost:4000 with three model aliases: loom-haiku, loom-sonnet,
# loom-opus. See tools/litellm/config.yaml for provider mapping.

param([string]$Action = "start")

$ComposeFile = Join-Path $PSScriptRoot "..\tools\litellm\docker-compose.yml"
$ProxyPort   = $env:LITELLM_PORT ?? "4000"
$ProxyUrl    = "http://localhost:$ProxyPort"

function Assert-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "[loom router] Docker not found. Install Docker Desktop or set LITELLM_PORT and run LiteLLM directly: pip install litellm && litellm --config tools/litellm/config.yaml --port $ProxyPort"
    exit 1
  }
}

switch ($Action) {
  "start" {
    Assert-Docker
    Write-Host "[loom router] Starting LiteLLM proxy on port $ProxyPort..."
    docker compose -f $ComposeFile up -d
    if ($LASTEXITCODE -eq 0) {
      Write-Host ""
      Write-Host "[loom router] Ready at $ProxyUrl"
      Write-Host "[loom router] Models:  loom-haiku / loom-sonnet / loom-opus"
      Write-Host "[loom router] Docs:    $ProxyUrl/docs"
      Write-Host "[loom router] Health:  $ProxyUrl/health"
    }
  }
  "stop" {
    Assert-Docker
    Write-Host "[loom router] Stopping LiteLLM proxy..."
    docker compose -f $ComposeFile down
  }
  "status" {
    Assert-Docker
    docker compose -f $ComposeFile ps
  }
  "logs" {
    Assert-Docker
    docker compose -f $ComposeFile logs --follow litellm
  }
  default {
    Write-Error "Unknown action: $Action. Use start, stop, status, or logs."
    exit 1
  }
}
