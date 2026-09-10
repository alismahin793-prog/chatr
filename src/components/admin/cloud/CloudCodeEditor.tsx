"use client";

import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";

const TS_EXTENSIONS = [javascript({ jsx: true, typescript: true })];
const JS_EXTENSIONS = [javascript({ jsx: true })];

function extensionsForPath(path: string): Extension[] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".mts") || lower.endsWith(".cts")) {
    return TS_EXTENSIONS;
  }
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return JS_EXTENSIONS;
  }
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return [json()];
  if (lower.endsWith(".css")) return [css()];
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return [markdown()];
  if (lower.endsWith(".sql")) return [sql()];
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return [javascript()];
  }
  return [];
}

interface CloudCodeEditorProps {
  path: string;
  content: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

/**
 * Real code editor for the Cloud files view. Syntax highlighting is driven by
 * the file extension; no content is ever sent anywhere except the workspace
 * write endpoint on save.
 */
export default function CloudCodeEditor({ path, content, onChange, readOnly }: CloudCodeEditorProps) {
  const extensions = useMemo(() => extensionsForPath(path), [path]);
  return (
    <CodeMirror
      value={content}
      onChange={onChange}
      extensions={extensions}
      theme={oneDark}
      readOnly={readOnly}
      height="100%"
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: !readOnly,
        highlightSelectionMatches: true,
      }}
      className="h-full text-[13px]"
      style={{ height: "100%" }}
    />
  );
}