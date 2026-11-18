import { useEffect, useRef, useState } from "preact/hooks";
import type { Editor } from "../lib/richtext-editor.ts";
import { fieldLabel } from "../lib/label.ts";

interface Props {
  name: string;
  value: unknown;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: string | null) => void;
}

type Prompt = { kind: "link"; url: string } | { kind: "image"; url: string; alt: string } | null;

interface ToolButton {
  label: string;
  text: string;
  active?: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
  className?: string;
}

const GROUPS: ToolButton[][] = [
  [
    { label: "Paragraph", text: "P", active: (e) => e.isActive("paragraph"), run: (e) => e.chain().focus().setParagraph().run() },
    { label: "Heading 2", text: "H2", active: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Heading 3", text: "H3", active: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  ],
  [
    { label: "Bold", text: "B", className: "rte-bold", active: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
    { label: "Italic", text: "I", className: "rte-italic", active: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
    { label: "Underline", text: "U", className: "rte-underline", active: (e) => e.isActive("underline"), run: (e) => e.chain().focus().toggleUnderline().run() },
    { label: "Strikethrough", text: "S", className: "rte-strike", active: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run() },
    { label: "Inline code", text: "</>", className: "rte-mono", active: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() },
  ],
  [
    { label: "Bulleted list", text: "\u2022 List", active: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", text: "1. List", active: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
    { label: "Quote", text: "\u201C Quote", active: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
    { label: "Code block", text: "{ } Code", className: "rte-mono", active: (e) => e.isActive("codeBlock"), run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { label: "Divider", text: "HR", run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
];

/**
 * The richtext field in the record editor. The server cleans whatever is saved
 * against its allowlist, so the editor is a convenience, not a security boundary.
 */
export function RichTextField({ name, value, invalid, describedBy, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const [, setTick] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const html = typeof value === "string" ? value : "";

  useEffect(() => {
    let cancelled = false;
    void import("../lib/richtext-editor.ts")
      .then(({ createRichTextEditor }) => {
        if (cancelled || !host.current) return;
        editorRef.current = createRichTextEditor({
          element: host.current,
          html,
          label: fieldLabel(name),
          describedBy,
          onUpdate: (next) => changeRef.current(next === "" ? null : next),
          onTransaction: () => setTick((n) => n + 1),
        });
        setTick((n) => n + 1);
      })
      .catch(() => setLoadError("The editor could not load. Reload the page to try again."));
    return () => {
      cancelled = true;
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, []);

  // A new record opened in the same drawer: load its HTML.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && !editor.isFocused && html !== (editor.isEmpty ? "" : editor.getHTML())) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [html]);

  const editor = editorRef.current;

  function openLink() {
    if (!editor) return;
    setPrompt({ kind: "link", url: String(editor.getAttributes("link").href ?? "") });
  }

  function applyPrompt(event: Event) {
    event.preventDefault();
    if (!editor || !prompt) return;
    const url = prompt.url.trim();
    if (prompt.kind === "link") {
      if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
      else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    } else if (url !== "") {
      editor.chain().focus().setImage({ src: url, alt: prompt.alt.trim() }).run();
    }
    setPrompt(null);
  }

  return (
    <div class={invalid ? "rte has-error" : "rte"} data-field={name}>
      <div class="rte-toolbar" role="toolbar" aria-label={`${fieldLabel(name)} formatting`}>
        {GROUPS.map((group, index) => (
          <div class="rte-group" key={index}>
            {group.map((tool) => {
              const active = editor && tool.active ? tool.active(editor) : false;
              return (
                <button
                  key={tool.label}
                  type="button"
                  class={`rte-btn${tool.className ? ` ${tool.className}` : ""}${active ? " active" : ""}`}
                  title={tool.label}
                  aria-label={tool.label}
                  aria-pressed={tool.active ? active : undefined}
                  disabled={!editor}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => editor && tool.run(editor)}
                >
                  {tool.text}
                </button>
              );
            })}
          </div>
        ))}
        <div class="rte-group">
          <button
            type="button"
            class={`rte-btn${editor?.isActive("link") ? " active" : ""}`}
            title="Link"
            aria-label="Link"
            aria-pressed={Boolean(editor?.isActive("link"))}
            disabled={!editor}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openLink}
          >
            Link
          </button>
          <button
            type="button"
            class="rte-btn"
            title="Image from an address"
            aria-label="Image"
            disabled={!editor}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPrompt({ kind: "image", url: "", alt: "" })}
          >
            Image
          </button>
        </div>
        <div class="rte-group rte-history">
          <button type="button" class="rte-btn" title="Undo" aria-label="Undo" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>
            Undo
          </button>
          <button type="button" class="rte-btn" title="Redo" aria-label="Redo" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>
            Redo
          </button>
        </div>
      </div>
      {prompt ? (
        <div class="rte-prompt" role="group" aria-label={prompt.kind === "link" ? "Link" : "Image"}>
          <input
            type="url"
            aria-label={prompt.kind === "link" ? "Link address" : "Image address"}
            placeholder={prompt.kind === "link" ? "https://example.com/page" : "https://example.com/photo.jpg"}
            value={prompt.url}
            autoFocus
            onInput={(event) => setPrompt({ ...prompt, url: (event.target as HTMLInputElement).value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setPrompt(null);
              }
              if (event.key === "Enter") applyPrompt(event);
            }}
          />
          {prompt.kind === "image" ? (
            <input
              type="text"
              aria-label="Image description"
              placeholder="Describe the image"
              value={prompt.alt}
              onInput={(event) => setPrompt({ ...prompt, alt: (event.target as HTMLInputElement).value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyPrompt(event);
              }}
            />
          ) : null}
          <button class="btn small" type="button" onClick={applyPrompt}>
            {prompt.kind === "link" && prompt.url.trim() === "" ? "Remove link" : "Apply"}
          </button>
          <button class="btn secondary small" type="button" onClick={() => setPrompt(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      {loadError ? <p class="field-error">{loadError}</p> : null}
      <div ref={host} class="rte-host" id={name} />
    </div>
  );
}
