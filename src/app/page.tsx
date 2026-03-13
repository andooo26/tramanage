"use client";

import { useState } from "react";

async function buildLines(dir: FileSystemDirectoryHandle, prefix = "") {
  const entries: [string, FileSystemHandle][] = [];
  for await (const entry of dir) entries.push(entry);
  entries.sort(([a], [b]) => a.localeCompare(b));

  const lines: string[] = [];
  let count = 0;

  for (let i = 0; i < entries.length; i++) {
    const [name, handle] = entries[i];
    const isLast = i === entries.length - 1;
    const conn = isLast ? "└── " : "├── ";
    const next = prefix + (isLast ? "    " : "│   ");

    if (handle.kind === "directory") {
      lines.push(prefix + conn + name + "/");
      const sub = await buildLines(handle as FileSystemDirectoryHandle, next);
      lines.push(...sub.lines);
      count += sub.count;
    } else {
      lines.push(prefix + conn + name);
      count++;
    }
  }

  return { lines, count };
}

export default function Home() {
  const [result, setResult] = useState<{ root: string; lines: string[]; count: number } | null>(null);
  const [loading, setLoading] = useState(false);

  async function selectFolder() {
    try {
      const dir = await (window as any).showDirectoryPicker();
      setLoading(true);
      const { lines, count } = await buildLines(dir);
      setResult({ root: dir.name, lines, count });
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center py-16 px-6">
      <h1 className="text-3xl font-bold mb-8 tracking-widest">tramanage</h1>

      <button
        onClick={selectFolder}
        disabled={loading}
        className="mb-10 px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium transition-colors"
      >
        {loading ? "Loading" : "フォルダを選択"}
      </button>

      {result && !loading && (
        <div className="w-full max-w-3xl">
          <pre className="bg-zinc-900 rounded-xl p-6 overflow-x-auto border border-zinc-800 text-sm leading-6">
            <span className="text-blue-400">{result.root}/</span>{"\n"}
            {result.lines.map((line, i) => {
              const isNonMp3File = !line.endsWith("/") && !/\.(mp3|jpg|jpeg)$/i.test(line);
              return (
                <span key={i} className={isNonMp3File ? "text-yellow-400" : ""}>{line}{"\n"}</span>
              );
            })}
          </pre>
          <div className="mt-4 text-right text-zinc-400 text-sm font-mono">
            合計ファイル数: <span className="text-zinc-100 font-semibold">{result.count}</span>
          </div>
        </div>
      )}
    </div>
  );
}
