# Agent & Self-Host

This build of Copilot has no Copilot Plus subscription: every feature runs with your own provider API keys. The **Agent** settings tab holds the autonomous agent, memory system, document processor, and **Self-Host Mode** — the integrations that use your own backends and API keys instead of a cloud service.

---

## Autonomous Agent

The autonomous agent reasons step-by-step and decides which tools to use on its own. It runs in regular **Chat** mode — see [Agent Mode and Tools](agent-mode-and-tools.md) for details.

- **Enable**: **Settings → Copilot → Agent → Enable Autonomous Agent**
- Toggle it per-conversation with the **Agent** button next to the chat input

---

## Memory System

The memory system lets Copilot remember things across conversations, so you don't have to repeat yourself.

### Recent Conversations

Copilot can reference your recent conversation history to provide more contextually relevant responses. This is separate from the current chat window — it's a summary of what you've been working on.

- **Enable**: **Settings → Copilot → Agent → Reference Recent Conversation** (on by default)
- **How many**: **Settings → Copilot → Agent → Max Recent Conversations** — default 30, range 10–50
- All history is stored locally in your vault (no data leaves your machine for this feature)

### Saved Memories

You can ask Copilot to explicitly remember specific facts about you:

```
@memory remember that I'm preparing for JLPT N3 and prefer bullet-point summaries
```

Copilot saves this to a memory file in your vault and references it in future conversations.

- **Enable**: **Settings → Copilot → Agent → Reference Saved Memories** (on by default)
- **Memory folder**: **Settings → Copilot → Agent → Memory Folder Name** — default: `copilot/memory`
- **Update memory tool**: The AI can add, update, or remove memories when you ask

---

## Document Processor

When Copilot processes PDFs and other non-markdown files (in Projects mode), it converts them to markdown for the AI to read. Text extraction for non-markdown files requires the Miyo integration below; PDFs can also be passed directly to vision models as multimodal context.

You can optionally save the converted markdown to a folder in your vault:

- **Setting**: **Settings → Copilot → Agent → Store converted markdown at**
- Leave empty to skip saving (conversion still happens, it just isn't persisted)

---

## Self-Host Mode

### What Is Self-Host Mode?

Self-Host Mode lets you use your own infrastructure for web search, YouTube transcripts, retrieval, and document parsing. It is a plain local toggle — no license or online validation.

### What Self-Host Mode Enables

- Custom web search via Firecrawl or Perplexity Sonar
- YouTube transcript extraction via Supadata
- Miyo desktop app for local PDF parsing, semantic search, and more
- A self-hosted retrieval backend (configure its URL in settings)

### Enabling Self-Host Mode

1. Go to **Settings → Copilot → Agent**
2. Under **Self-Host Mode**, toggle **Enable Self-Host Mode**
3. Toggle **Enable Miyo** to use the Miyo desktop app for local search, PDF parsing, and context.
4. _(Optional)_ Set **Remote Miyo Server URL** only if Miyo is running on a remote machine. Leave blank to use automatic local service discovery.

### Web Search in Self-Host Mode

Choose your web search provider:

- **Firecrawl** — A web crawling and scraping API. Get a key at firecrawl.dev. Enter it in **Settings → Copilot → Agent → Firecrawl API Key**.
- **Perplexity Sonar** — An AI-powered search API. Get a key at perplexity.ai. Enter it in **Settings → Copilot → Agent → Perplexity API Key**.

Without a configured key, the `webSearch` tool returns an error explaining what is missing.

### YouTube Transcription in Self-Host Mode

Use your own Supadata API key for YouTube transcript extraction:

- Get a key at supadata.ai
- Enter it in **Settings → Copilot → Agent → Supadata API Key**

The same key powers the **Download YouTube Script** command and automatic YouTube-URL transcripts in chat.

---

## Miyo Desktop App

Miyo is a companion desktop app from the same developer that enhances Copilot with local, offline capabilities:

### What Miyo Provides

- **Local semantic search** — Fast vector search without embedding API calls
- **PDF parsing** — Converts PDFs to markdown locally (no cloud OCR)
- **Context hub** — Manages your indexed documents locally
- **Custom server URL** — Run Miyo on any machine (local or server)

### Setting Up Miyo

1. Download and install the Miyo desktop app
2. Start the Miyo server
3. In Copilot, go to **Settings → Copilot → Agent → Enable Miyo**
4. Miyo automatically connects to the local server (or use a custom URL in **Remote Miyo Server URL**)
5. Index your vault — Copilot will use Miyo to generate and store embeddings locally

### Custom Miyo Server URL

If Miyo is running on a different machine (e.g., a home server), enter its address:

```
http://192.168.1.10:8742
```

Leave empty to use automatic local discovery.

---

## Related

- [Agent Mode and Tools](agent-mode-and-tools.md) — Using the autonomous agent
- [Vault Search and Indexing](vault-search-and-indexing.md) — How Miyo enhances semantic search
- [Getting Started](getting-started.md) — First-time setup
