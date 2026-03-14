"use client";

import { useState } from "react";

type DsStoreEntry = { parent: FileSystemDirectoryHandle; name: string };

type TreeNode = {
  name: string;
  kind: "file" | "directory";
  path: string;
  children: TreeNode[];
};

async function buildTree(dir: FileSystemDirectoryHandle, dirPath = "") {
  const entries: [string, FileSystemHandle][] = [];
  for await (const entry of dir) entries.push(entry);
  entries.sort(([a], [b]) => a.localeCompare(b));

  const nodes: TreeNode[] = [];
  const filePaths: string[] = [];
  const dsStoreEntries: DsStoreEntry[] = [];
  let count = 0;

  for (const [name, handle] of entries) {
    const path = dirPath ? `${dirPath}/${name}` : name;
    if (handle.kind === "directory") {
      const sub = await buildTree(handle as FileSystemDirectoryHandle, path);
      nodes.push({ name, kind: "directory", path, children: sub.nodes });
      filePaths.push(...sub.filePaths);
      dsStoreEntries.push(...sub.dsStoreEntries);
      count += sub.count;
    } else {
      nodes.push({ name, kind: "file", path, children: [] });
      filePaths.push(path);
      count++;
      if (name === ".DS_Store") dsStoreEntries.push({ parent: dir, name });
    }
  }

  return { nodes, filePaths, dsStoreEntries, count };
}

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(true);
  const isOther = node.kind === "file" && !/\.(mp3|jpg|jpeg)$/i.test(node.name);

  return (
    <div>
      <div
        style={{ paddingLeft: `${depth * 16}px` }}
        className={`flex items-center gap-1 font-mono text-sm leading-6 select-none ${
          node.kind === "directory" ? "cursor-pointer hover:text-zinc-300" : ""
        } ${isOther ? "text-yellow-400" : ""}`}
        onClick={node.kind === "directory" ? () => setOpen((o) => !o) : undefined}
      >
        <span className="text-zinc-500 w-4 shrink-0 text-center">
          {node.kind === "directory" ? (open ? "▾" : "▸") : ""}
        </span>
        <span>{node.name}{node.kind === "directory" ? "/" : ""}</span>
      </div>
      {node.kind === "directory" && open && (
        <div>
          {node.children.map((child, i) => (
            <TreeItem key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function RootTree({ root, nodes }: { root: string; nodes: TreeNode[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-700">
      <div
        className="flex items-center gap-1 font-mono text-sm text-blue-400 leading-6 select-none cursor-pointer hover:text-blue-300 p-6 pb-3"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-zinc-500 w-4 shrink-0 text-center">{open ? "▾" : "▸"}</span>
        <span>{root}/</span>
      </div>
      {open && (
        <div className="px-6 pb-6 overflow-x-auto">
          {nodes.map((node, i) => (
            <TreeItem key={i} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [rootDir, setRootDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [result, setResult] = useState<{
    root: string;
    nodes: TreeNode[];
    filePaths: string[];
    dsStoreEntries: DsStoreEntry[];
    count: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [otherOpen, setOtherOpen] = useState(true);

  async function selectFolder() {
    try {
      const dir = await (window as any).showDirectoryPicker();
      setRootDir(dir);
      setLoading(true);
      const { nodes, filePaths, dsStoreEntries, count } = await buildTree(dir);
      setResult({ root: dir.name, nodes, filePaths, dsStoreEntries, count });
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function deleteDsStores() {
    if (!rootDir || !result) return;
    setDeleting(true);
    try {
      await Promise.all(result.dsStoreEntries.map(({ parent, name }) => parent.removeEntry(name)));
      const { nodes, filePaths, dsStoreEntries, count } = await buildTree(rootDir);
      setResult({ root: rootDir.name, nodes, filePaths, dsStoreEntries, count });
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(false);
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

      {result && !loading && (() => {
        const otherFiles = result.filePaths.filter((p) => !/\.(mp3|jpg|jpeg)$/i.test(p));
        return (
          <div className="w-full max-w-3xl space-y-6">
            <RootTree root={result.root} nodes={result.nodes} />
            {otherFiles.length > 0 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-700">
                <div
                  className="flex items-center gap-2 p-6 pb-3 cursor-pointer select-none"
                  onClick={() => setOtherOpen((o) => !o)}
                >
                  <span className="text-yellow-500">{otherOpen ? "▾" : "▸"}</span>
                  <span className="text-yellow-400 font-semibold text-sm">
                    MP3・JPG以外のファイル ({otherFiles.length}件)
                  </span>
                </div>
                {otherOpen && (
                  <ul className="font-mono text-sm text-yellow-400 space-y-1 px-6 pb-6">
                    {otherFiles.map((path, i) => (
                      <li key={i}>{path}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {result.dsStoreEntries.length > 0 && (
              <div className="bg-zinc-900 rounded-xl p-6 border border-red-700">
                <div className="flex items-center justify-between">
                  <div className="text-red-400 font-semibold text-sm">.DS_Store ({result.dsStoreEntries.length}件)</div>
                  <button
                    onClick={deleteDsStores}
                    disabled={deleting}
                    className="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    {deleting ? "削除中..." : "一括削除"}
                  </button>
                </div>
              </div>
            )}
            <div className="text-right text-zinc-400 text-sm font-mono">
              合計ファイル数: <span className="text-zinc-100 font-semibold">{result.count}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
