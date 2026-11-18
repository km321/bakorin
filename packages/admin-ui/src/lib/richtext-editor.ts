/**
 * The rich text editor, loaded on demand the first time a richtext field opens so
 * the rest of the admin stays small. Tiptap (ProseMirror) with the tags the server
 * allowlist keeps: headings, bold, italic, underline, strike, links, lists,
 * blockquotes, inline code, code blocks, horizontal rules, and images by address.
 */
import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";

export type { Editor };

export function createRichTextEditor(options: {
  element: HTMLElement;
  html: string;
  label: string;
  describedBy?: string;
  onUpdate: (html: string) => void;
  onTransaction: () => void;
}): Editor {
  const editor = new Editor({
    element: options.element,
    content: options.html,
    // The admin's Content-Security-Policy blocks inline styles; the editor CSS is in app.css.
    injectCSS: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["http", "https", "mailto", "tel"],
          HTMLAttributes: { rel: null, target: null },
        },
      }),
      Image.configure({ inline: false, allowBase64: false }),
    ],
    editorProps: {
      attributes: {
        class: "rte-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": options.label,
        ...(options.describedBy ? { "aria-describedby": options.describedBy } : {}),
      },
    },
    onUpdate: ({ editor: current }) => options.onUpdate(current.isEmpty ? "" : current.getHTML()),
    onTransaction: () => options.onTransaction(),
  });
  return editor;
}
