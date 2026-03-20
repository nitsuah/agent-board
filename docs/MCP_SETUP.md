# Model Context Protocol (MCP) Setup Guide

This document lists the MCPs needed for your agent ecosystem and how to install them.

## Overview

MCPs extend Claude's capabilities by providing tools and resources for specific tasks. Install them based on your needs.

## Required MCPs

### 1. **GitHub MCP** (Already configured)
- **Purpose**: Version control, PR management, issue tracking
- **Status**: ✓ Already installed
- **Resource**: GitHub integration for safe code management
- **Location**: Install via Claude Desktop settings

### 2. **Docker MCP** (Recommended)
- **Purpose**: Manage Docker containers and images
- **GitHub**: https://github.com/modelcontextprotocol/servers/tree/main/src/docker
- **Install**:
  ```bash
  npm install -g @modelcontextprotocol/server-docker
  ```
- **Config in Claude Desktop**: Add to `claude_desktop_config.json`

### 3. **Filesystem MCP** (Recommended)
- **Purpose**: Safe file system operations
- **GitHub**: https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem
- **Install**:
  ```bash
  npm install -g @modelcontextprotocol/server-filesystem
  ```
- **Features**: Read/write files, list directories

### 4. **Git MCP** (Recommended)
- **Purpose**: Direct git operations
- **GitHub**: https://github.com/modelcontextprotocol/servers/tree/main/src/git
- **Install**:
  ```bash
  npm install -g @modelcontextprotocol/server-git
- **Features**: Commit, branch, merge operations

### 5. **Web Browse MCP** (Optional)
- **Purpose**: Browse and fetch web content
- **GitHub**: https://github.com/modelcontextprotocol/servers/tree/main/src/web
- **Install**:
  ```bash
  npm install -g @modelcontextprotocol/server-web
  ```
- **Features**: Fetch URLs, search web

### 6. **Bash/Shell MCP** (Recommended)
- **Purpose**: Execute shell commands safely
- **GitHub**: https://github.com/modelcontextprotocol/servers/tree/main/src/bash
- **Install**:
  ```bash
  npm install -g @modelcontextprotocol/server-bash
  ```
- **Features**: Execute commands with safety restrictions

## Installation Steps

### Option 1: Manual Installation (Recommended for Windows)

1. **Download from NPM**:
   ```powershell
   npm install -g @modelcontextprotocol/server-github
   npm install -g @modelcontextprotocol/server-docker
   npm install -g @modelcontextprotocol/server-filesystem
   npm install -g @modelcontextprotocol/server-git
   npm install -g @modelcontextprotocol/server-bash
   ```

2. **Configure in Claude Desktop**:
   - Open Claude Desktop settings
   - Go to "Developer" → "MCP Servers"
   - Add new servers with their installed paths

3. **Test Installation**:
   ```powershell
   npm list -g @modelcontextprotocol/*
   ```

### Option 2: Via Claude Desktop UI

1. Open Claude Desktop
2. Settings → Developer
3. Click "Add MCP Server"
4. Enter server details:
   - Name: `server-docker`
   - Command: `npx @modelcontextprotocol/server-docker`

## Configuration

### Claude Desktop Config Location
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Example**:
  ```json
  {
    "mcpServers": {
      "github": {
        "command": "npx",
        "args": ["@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_TOKEN": "your-token-here"
        }
      },
      "docker": {
        "command": "npx",
        "args": ["@modelcontextprotocol/server-docker"]
      },
      "filesystem": {
        "command": "npx",
        "args": ["@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"]
      }
    }
  }
  ```

## GitHub Token Setup

For GitHub MCP to work with your repos:

1. Generate PAT: https://github.com/settings/tokens
2. Create token with:
   - `repo` (full control)
   - `workflow` (for CI/CD)
   - `gist`
3. Set `GITHUB_TOKEN` environment variable or add to config

## Docker Hub Integration

To reduce API costs and context usage:

1. **Docker Hub Login**:
   ```bash
   docker login
   ```

2. **Pre-pull Images**:
   ```bash
   # Already set up:
   docker pull ollama/ollama:latest
   docker pull nemoclaw:latest
   
   # Other useful images:
   docker pull ghcr.io/modelcontextprotocol/server-docker:latest
   ```

3. **Docker Compose with Hub**:
   ```yaml
   services:
     local_llm:
       image: ollama/ollama:latest  # From Docker Hub
     agent-dashboard:
       image: your-username/agent-dashboard:latest  # Push to Hub when ready
   ```

## Recommended Setup

For your use case, install these in order:

1. ✓ **GitHub MCP** - Already have it
2. **Docker MCP** - Manage containers
3. **Filesystem MCP** - Safe file operations
4. **Bash MCP** - Execute commands
5. **Git MCP** - Direct git ops
6. **Web Browse** - Optional, if needed

## Testing MCPs

Once installed, test in Claude:

```
User: "List all Docker containers"
Claude: Uses docker MCP to show running containers

User: "Create a new file in agent-dashboard/src"
Claude: Uses filesystem MCP to write the file

User: "Commit my changes with message 'feat: add feature'"
Claude: Uses git MCP to commit
```

## Troubleshooting

### MCP Not Loading
1. Check Claude Desktop logs: `%APPDATA%\Claude\logs\`
2. Verify command exists: `which server-docker` or `Get-Command server-docker`
3. Test directly: `npx @modelcontextprotocol/server-docker`

### Permission Issues
- Windows: Run Claude Desktop as Administrator
- Check PATH includes npm bin directory

### Token Issues
- Verify `GITHUB_TOKEN` is set: `echo $env:GITHUB_TOKEN`
- Check token has correct scopes
- Regenerate if needed

## Cost Optimization

By using Docker Hub and local MCPs:
- ✓ Reduce API calls (use local Docker)
- ✓ Reduce context usage (MCP summaries are concise)
- ✓ Better performance (direct execution)
- ✓ No cloud dependency (everything local)

## Next Steps

1. Install the recommended MCPs above manually
2. Test each one with Claude
3. Update this document as you add more MCPs
4. Push to git for team access

## Resources

- [MCP Documentation](https://github.com/modelcontextprotocol)
- [Available Servers](https://github.com/modelcontextprotocol/servers)
- [Claude Desktop Docs](https://support.anthropic.com/en/articles/8360641-claude-desktop)
