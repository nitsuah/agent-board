# Agent Dashboard

A lightweight local web-based dashboard for interacting with multiple LLM models and managing agent sessions. Build, test, and run Claude agents with full control over model selection and safety features.

## Features

- 🤖 **Multi-Model Support** - Switch between Mistral, Qwen, and other Ollama models
- 💬 **Agent Sessions** - TMux-like session management for long-running conversations
- 🛡️ **Safety Controls** - Optional NemoClaw integration for privacy and security
- 🌐 **Web-Based UI** - Simple, responsive interface
- ⚡ **Local-First** - Everything runs locally on your machine
- 🔄 **Model Switching** - Change models mid-conversation within a session

## Prerequisites

- Docker Desktop running
- `local_llm` container running on port 8080 (Ollama with Mistral)
- `nemoclaw` container running on port 8081 (optional, for safety features)
- Node.js 18+

## Quick Start

### 1. Install Dependencies

```bash
cd agent-dashboard
npm install
```

### 2. Configuration

Edit `.env.local` if your services are on different ports:

```env
LOCAL_LLM_URL=http://localhost:8080
NEMOCLAW_URL=http://localhost:8081
PORT=3000
```

### 3. Add Models to Ollama

Pull additional models into your local_llm container:

```bash
# Already have Mistral
docker exec local_llm ollama pull mistral

# Add Qwen
docker exec local_llm ollama pull qwen

# Other options
docker exec local_llm ollama pull neural-chat
docker exec local_llm ollama pull llama2
```

### 4. Start the Dashboard

```bash
# Development mode
npm run dev

# Open http://localhost:3000 in your browser
```

### 5. Build for Production

```bash
npm run build
npm run preview
```

## Usage

### Creating a Session

1. Select a model from the left sidebar
2. Click "New Session"
3. Start typing messages

### Switching Models

- Select a different model in the sidebar
- Current model will switch for the active session
- Conversation history remains intact

### Safe Mode (NemoClaw)

- Check "Use NemoClaw (Safe Mode)" before sending messages
- Messages route through NemoClaw's OpenShell security layer
- Ensures privacy and policy-based guardrails

## API Endpoints

### Models
- `GET /api/models` - List available models
- `GET /api/health` - Health check

### Sessions
- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:id` - Get session details
- `DELETE /api/sessions/:id` - Delete session

### Messages
- `POST /api/sessions/:id/message` - Send message and get response

### Model Control
- `PUT /api/sessions/:id/model` - Switch model in session

## Architecture

```
agent-dashboard/
├── server.js              # Express backend
├── src/
│   ├── App.jsx           # Main React component
│   ├── App.css           # Styling
│   └── main.jsx          # Entry point
├── index.html            # HTML template
├── vite.config.js        # Vite configuration
├── package.json          # Dependencies
└── dist/                 # Built frontend (after build)
```

## Development with Worktrees

For safe changes with git worktrees:

```bash
# Create a feature branch
git worktree add ../agent-dashboard-feature feature/new-feature

# Make your changes in the worktree
cd ../agent-dashboard-feature
npm install
npm run dev

# Commit and push
git add .
git commit -m "Add new feature"
git push origin feature/new-feature

# Clean up worktree
cd ..
git worktree remove agent-dashboard-feature
```

## Troubleshooting

### Models not loading
- Check `http://localhost:8080/api/tags` to verify Ollama is running
- Ensure models are pulled: `docker exec local_llm ollama list`

### Connection errors
- Verify Docker containers: `docker ps`
- Check port availability: `netstat -an | grep 3000`

### NemoClaw not working
- Verify container: `docker logs nemoclaw`
- Check it's running: `docker ps | grep nemoclaw`

## Safety & Security

- All communication is local (no external APIs unless configured)
- NemoClaw provides OpenShell security layer when enabled
- Sandbox isolation for agent execution
- Capability restrictions (--cap-drop=all)
- Read-only filesystem options available

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

MIT
