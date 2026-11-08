// A rich text field on Tiptap that reads and writes Markdown, with a formatting toolbar in Halon markup.
// Tiptap is headless, so the toolbar and look come from Halon, and its Markdown extension keeps the stored text plain for agents, search and sync.

import { CodeBlock } from "@tiptap/extension-code-block";
import { Markdown } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "../dom.ts";
import { as_code_block } from "../markdown_text.ts";

// ── Toolbar ──────────────────────────────────────────────────────────────────

interface Format {
  label: string;
  glyph: ReactNode;
  keys?: string;
  active: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const FORMATS: Format[] = [
  { label: "Bold", glyph: <b>B</b>, keys: "Ctrl+B", active: (editor) => editor.isActive("bold"), run: (editor) => editor.chain().focus().toggleBold().run() },
  { label: "Italic", glyph: <i>I</i>, keys: "Ctrl+I", active: (editor) => editor.isActive("italic"), run: (editor) => editor.chain().focus().toggleItalic().run() },
  { label: "Strikethrough", glyph: <s>S</s>, keys: "Ctrl+Shift+S", active: (editor) => editor.isActive("strike"), run: (editor) => editor.chain().focus().toggleStrike().run() },
  { label: "Inline code", glyph: "`", keys: "Ctrl+E", active: (editor) => editor.isActive("code"), run: (editor) => editor.chain().focus().toggleCode().run() },
  { label: "Heading", glyph: "H", active: (editor) => editor.isActive("heading"), run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "Bulleted list", glyph: "•", active: (editor) => editor.isActive("bulletList"), run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", glyph: "1.", active: (editor) => editor.isActive("orderedList"), run: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { label: "Checklist", glyph: "☑", active: (editor) => editor.isActive("taskList"), run: (editor) => editor.chain().focus().toggleTaskList().run() },
  { label: "Quote", glyph: "❝", active: (editor) => editor.isActive("blockquote"), run: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { label: "Code block", glyph: "{}", active: (editor) => editor.isActive("codeBlock"), run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
];

function Toolbar({ editor }: { editor: Editor }) {
  const pressed = useEditorState({ editor, selector: ({ editor }) => FORMATS.map((format) => format.active(editor)) });

  return (
    <div className="rich-text-toolbar" role="toolbar" aria-label="Formatting">
      {FORMATS.map((format, index) => (
        <button
          key={format.label}
          type="button"
          className="icon"
          aria-label={format.label}
          aria-pressed={pressed[index]}
          title={format.keys ? `${format.label} (${format.keys})` : format.label}
          // Keeps the selection in the text while the button is clicked.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => format.run(editor)}
        >
          {format.glyph}
        </button>
      ))}
    </div>
  );
}

// ── Code blocks ──────────────────────────────────────────────────────────────

// Tiptap always fences code with three backticks, which backticks inside the code would close early.
const FencedCodeBlock = CodeBlock.extend({
  renderMarkdown: (node, helpers) => as_code_block(node.content ? helpers.renderChildren(node.content) : "", node.attrs?.language ?? ""),
});

// ── Field ────────────────────────────────────────────────────────────────────

interface RichTextProps {
  // The text as Markdown.
  value: string;
  on_change: (markdown: string) => void;
  // Runs when focus leaves the text, such as to save it.
  on_blur?: () => void;
  // Names the text for screen readers.
  label: string;
  placeholder?: string;
  autofocus?: boolean;
  class_name?: string;
}

// The trailing blank lines Tiptap adds go, so an emptied field is an empty string.
const markdown_of = (editor: Editor, content: ProseMirrorNode): string => editor.markdown!.serialize(content.toJSON()).trimEnd();

// Only typing calls on_change, so showing a note never rewrites how its Markdown is spelled.
export function RichText({ value, on_change, on_blur, label, placeholder, autofocus = false, class_name }: RichTextProps) {
  const callbacks = useRef({ on_change, on_blur });
  callbacks.current = { on_change, on_blur };
  const last_markdown = useRef(value);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        link: { openOnClick: true, autolink: true, protocols: ["http", "https"], isAllowedUri: (url) => /^https?:\/\//.test(url), HTMLAttributes: { target: "_blank", rel: "noreferrer" } },
      }),
      FencedCodeBlock,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    contentType: "markdown",
    autofocus: autofocus ? "end" : false,
    editorProps: { attributes: { class: "markdown rich-text-body", role: "textbox", "aria-multiline": "true", "aria-label": label } },
    onUpdate: ({ editor, transaction }) => {
      const markdown = markdown_of(editor, transaction.doc);
      // A tidy-up Tiptap makes by itself, such as a line after a final code block, leaves the Markdown alone and is not typing.
      if (markdown === markdown_of(editor, transaction.before)) return;
      last_markdown.current = markdown;
      callbacks.current.on_change(markdown);
    },
    onBlur: () => callbacks.current.on_blur?.(),
  });

  // A value from outside, such as another item picked, replaces the text without counting as typing.
  useEffect(() => {
    if (value === last_markdown.current) return;
    last_markdown.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  return (
    <div className={cx("rich-text", class_name)}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="rich-text-frame" />
    </div>
  );
}
