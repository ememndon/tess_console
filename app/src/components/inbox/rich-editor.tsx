"use client";

import { useEffect, useRef } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link2, Strikethrough, RemoveFormatting } from "lucide-react";
import { cn } from "@/lib/utils";

// A lightweight rich-text compose editor: a contentEditable surface plus a small
// formatting toolbar. It stays uncontrolled (so the caret never jumps) and reports
// both the HTML and the plain-text fallback up on every edit. `resetKey` lets the
// parent reload `initialHtml` — bump it when loading a draft or clearing the form.
// (execCommand is deprecated but is the pragmatic, universally-supported way to do
// inline formatting without pulling in a heavy editor dependency.)

type Cmd = { icon: typeof Bold; cmd: string; arg?: string; title: string };
const COMMANDS: Cmd[] = [
  { icon: Bold, cmd: "bold", title: "Bold" },
  { icon: Italic, cmd: "italic", title: "Italic" },
  { icon: Underline, cmd: "underline", title: "Underline" },
  { icon: Strikethrough, cmd: "strikeThrough", title: "Strikethrough" },
  { icon: List, cmd: "insertUnorderedList", title: "Bulleted list" },
  { icon: ListOrdered, cmd: "insertOrderedList", title: "Numbered list" },
];

export function RichEditor({
  initialHtml,
  onChange,
  placeholder,
  resetKey,
  className,
}: {
  initialHtml: string;
  onChange: (html: string, text: string) => void;
  placeholder?: string;
  resetKey?: string | number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml || "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  function emit() {
    const el = ref.current;
    if (el) onChange(el.innerHTML, el.innerText);
  }
  function exec(cmd: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  }
  function addLink() {
    const url = window.prompt("Link URL", "https://");
    if (url) exec("createLink", url);
  }

  return (
    <div className={cn("flex flex-col rounded-md border bg-background", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
        {COMMANDS.map((c) => (
          <button
            key={c.cmd}
            type="button"
            title={c.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(c.cmd, c.arg)}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <c.icon className="size-4" />
          </button>
        ))}
        <button type="button" title="Insert link" onMouseDown={(e) => e.preventDefault()} onClick={addLink} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Link2 className="size-4" />
        </button>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <button type="button" title="Clear formatting" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("removeFormat")} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <RemoveFormatting className="size-4" />
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        className="tess-rich min-h-40 max-h-[28rem] overflow-y-auto px-3 py-2 text-sm leading-relaxed outline-none [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
