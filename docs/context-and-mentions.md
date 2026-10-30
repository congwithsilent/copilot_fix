# Context and Mentions

Copilot uses **context** to give the AI information about your notes, selected text, web content, and more. You can control exactly what context the AI sees using automatic context, @-mentions, and manual commands.

---

## Automatic Context

### Active Note

By default, the content of your currently open note is automatically included in every message you send. This means you can ask things like:

- "Summarize this note"
- "What are the action items here?"
- "Add a conclusion section"

To disable automatic note context: **Settings → Copilot → Basic → Auto-add active note to context** (toggle off).

### Active Web Tab (Desktop Only)

If you have the Copilot Web Viewer open alongside your notes, the content of the currently active web tab is automatically included as context (labeled `{activeWebTab}`). This lets you ask the AI to help you work with web content.

### Selected Text

If you highlight text in a note and then type in the chat, the selected text is automatically included as context. This is useful for asking about or transforming a specific part of a note.

You can enable/disable automatic selection adding in **Settings → Copilot → Basic → Auto-add selection to context**.

### Images in Markdown

If your note contains images (e.g., `![[screenshot.png]]`), and you're using a model with **Vision** capability, those images are automatically included in the context. Copilot will pass the image data to the AI so it can see and describe the image.

To control this behavior: **Settings → Copilot → Basic → Pass markdown images to AI**.

---

## @-Mentions

Type `@` in the chat input to mention and include specific items as context.

### @note — Include a Specific Note

Type `@` followed by the note title to add a note to context:

```
@My Meeting Notes tell me what was decided in this meeting
```

The note's full content is included in the request.

### @folder — Include a Folder of Notes

Type `@` followed by a folder name to include all notes in that folder:

```
@Projects/ what tasks are still open?
```

### @tags — Include Notes by Tag

Use `#` after `@` to include all notes with a specific tag:

```
@#work/project summarize the status of the work project
```

### @URL — Include a Web Page

Paste a URL or type `@https://...` to fetch and include a web page's content:

```
@https://example.com/article summarize this article
```

General URL content extraction is not available in this build. YouTube URLs are handled specially — Copilot fetches the video transcript automatically when a Supadata API key is configured (Settings → Agent).

### Tool Mentions

These special @-mentions explicitly trigger tools in Chat (agent) and Projects mode:

| Mention                | What it does                                     |
| ---------------------- | ------------------------------------------------ |
| `@vault`               | Search your vault notes for relevant information |
| `@websearch` or `@web` | Search the internet                              |
| `@composer`            | Create or edit a note                            |
| `@memory`              | Access or update your memory                     |

Example:

```
@vault what did I write about machine learning last month?
@websearch what are the latest changes to the Python packaging ecosystem?
```

---

## Adding Context Manually

### Add Selection to Chat Context

Use the command palette: **Add selection to chat context**

Highlights the selected text and adds it to the chat as context without sending a message. Useful when you want to build up context before sending.

### Add Web Selection to Chat Context

Use the command palette: **Add web selection to chat context**

Works similarly but captures selected text from the Web Viewer. Available on desktop only.

### Adding a PDF as Context

Attached PDFs are rendered locally into page images for vision models. Each PDF in the composer has **From** and **To** fields: both endpoints are included and use physical page positions starting at 1, regardless of printed page labels. **Current ±1** selects the open reader's page and its available neighbours; **All pages** selects the entire document. If the reader position is unavailable, the initial selection starts at page 1. Check the displayed range before sending.

Only selected pages are sent, using ordinary image inputs rather than PDF file inputs. Individual rendered pages are cached under `.copilot/pdf-page-cache`, so overlapping ranges reuse images. Changing the PDF or render profile invalidates cached images. Local caching saves rendering work; submitted images still consume provider input tokens, and provider prompt-cache discounts depend on the API. Reducing the page range is what directly reduces image input. A vision-capable model is required.

Saved chats keep the selected page ranges; regeneration reloads those pages from the current local PDF. This is a reference to the file, not an archived copy of the document.

Click the **Context** button above the chat input to attach a PDF file, then select the page range above the composer before sending. Explicit PDF attachments use page images; PDFs embedded inside Markdown notes still use the configured text-parsing backend.

### Adding an Image as Context

Drag an image directly into the chat input box, or click the **image button** in the bottom-right corner of the chat input. The image is sent to the AI if your selected model supports **Vision** capability.

---

## Context Indicators

When context items are added to your message, Copilot shows small pills or badges in the context tray above the chat input. This helps you confirm exactly what the AI will see. The first two items remain visible; select **more** to expand the rest, then **Less** to collapse them again.

---

## Context Behavior by Mode

| Context Type    | Chat             | Vault QA     | Projects     |
| --------------- | ---------------- | ------------ | ------------ |
| Active note     | Yes (auto)       | Yes (auto)   | Yes (auto)   |
| Selected text   | Yes (auto)       | Yes (auto)   | Yes (auto)   |
| @note / @folder | Yes              | Yes          | Yes          |
| @URL processing | YouTube only     | YouTube only | YouTube only |
| @vault search   | Yes (explicit)   | Auto         | Auto         |
| @websearch      | With Agent/pills | No           | Yes          |
| Images (vision) | Yes              | Yes          | Yes          |
| Active web tab  | Desktop only     | Desktop only | Desktop only |

---

## Related

- [Chat Interface](chat-interface.md) — How the chat panel works
- [Agent Mode and Tools](agent-mode-and-tools.md) — More on @vault and @websearch
- [Vault Search and Indexing](vault-search-and-indexing.md) — How vault search works
