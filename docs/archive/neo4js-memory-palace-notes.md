# 3D Memory Palace — Design Notes (raw)

> **Archived 2026-09-02.** Raw brainstorm notes (originally one unformatted paragraph,
> reformatted here for readability) behind the "3D Memory Palace context" line in
> `ROADMAP.md`. Summarized into a proper writeup under `ROADMAP.md`'s 2027 Q3 section;
> kept here as the fuller detail behind that summary, not as an active/current doc.
> Section 5 ("Operational Foundations") describes work that has since actually shipped
> (persistence, command interface, task queue/webhooks, resource monitoring — see
> `ROADMAP.md` 2026 Q2) and is superseded.

## 1. Core Architecture (The Brain)

- **Neo4j Agent Memory Tiering**: Store agent data across a three-tiered context
  architecture to prevent context window dilution:
  - Short-term memory: actively tracking current chat/session state.
  - Long-term memory: extracting persistent entities, preferences, and semantic
    relationships.
  - Reasoning memory: retaining tool usage audit trails and multi-hop decision traces.
- **GraphQL API Gateway**: Expose the Neo4j graph using a GraphQL type-definition
  library so the AI agent and the frontend can query complex relationship deep-dives
  with clean, high-performance payloads.
- **Bidirectional Context Engineering**: Implement an agent wrapper framework (such as
  Mem0 or Neo4j Agent Memory) that automatically injects relevant graph context before
  an AI run and writes new nodes/edges after the run.

## 2. Visual Code Memory & Workspace Annotation

- **Dynamic Visual File Structure**: Represent the code workspace as an interactive
  file-tree graph where folders and files are structural nodes linked by dependency
  edges (`IMPORTS`, `DEPENDS_ON`).
- **Live File Annotations**: Allow the AI agent or the user to append unstructured
  text, tasks, and system notes directly onto file/code nodes as persistent
  properties.
- **Cross-Session Persistence**: Ensure all code changes, session summaries, and agent
  discoveries persist seamlessly in Neo4j across multiple days or browser refreshes,
  effectively creating a permanent "Memory Palace" workspace.

## 3. Frontend Experience (The 3D Liminal Interface)

- **3D Spatial Environment**: Render the knowledge graph in an interactive 3D WebGL
  viewport using `3d-force-graph` or Neo4j NVL. The interface should mimic an infinite
  dark void (liminal space) where data clusters hang like constellation patterns.
- **Camera Navigation**: Provide fluid, immersive navigation — orbit rotation,
  cinematic node-focus tracking, fly-through zooming, drag-and-drop node physics.
- **Visual Cueing & Filtering**: Dynamic node styling (size relative to access
  frequency, neon glow relative to recency) to visually distinguish active contextual
  focuses from older, archived memories.

## 4. AI Agent Integration (The Agentic Mind)

- **Context-Aware Prompting**: A middleware layer that constructs AI prompts by
  intelligently selecting and summarizing relevant graph context based on the current
  task or query.
- **Memory-Driven Reasoning**: Enable the agent to perform multi-hop reasoning by
  traversing graph relationships, connecting disparate pieces of information for
  complex problem-solving.
- **Tool Usage Auditing**: Automatically log all external tool interactions (APIs
  called, files modified) as nodes in the graph, creating a transparent audit trail of
  the agent's decision-making process.

## 5. Operational Foundations (superseded — shipped 2026 Q2)

- Persistence & state management for agent history, logs, and state snapshots.
- Command interface for starting, stopping, and restarting agent instances.
- Task queue & webhook visibility/routing.
- Heartbeat + resource monitoring.
