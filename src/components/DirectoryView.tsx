"use client";

import { useState } from "react";
import { buildTree, TreeNode, HiddenEntry } from "@/lib/fsUtils";

// ---- hook ----

export type FolderResult = {
  root: string;
  nodes: TreeNode[];
  filePaths: string[];
  hiddenEntries: HiddenEntry[];
  count: number;
};

export function useFolderViewer() {
  const [rootDir, setRootDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [result, setResult] = useState<FolderResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingHidden, setDeletingHidden] = useState(false);

  async function selectFolder() {
    try {
      const dir = await (window as any).showDirectoryPicker();
      setRootDir(dir);
      setLoading(true);
      const { nodes, filePaths, hiddenEntries, count } = await buildTree(dir);
      setResult({ root: dir.name, nodes, filePaths, hiddenEntries, count });
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function deleteHiddenFiles() {
    if (!rootDir || !result) return;
    setDeletingHidden(true);
    try {
      await Promise.all(result.hiddenEntries.map(({ parent, name }) => parent.removeEntry(name)));
      const { nodes, filePaths, hiddenEntries, count } = await buildTree(rootDir);
      setResult({ root: rootDir.name, nodes, filePaths, hiddenEntries, count });
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingHidden(false);
    }
  }

  function clear() {
    setResult(null);
    setRootDir(null);
  }

  return { loading, result, deletingHidden, selectFolder, deleteHiddenFiles, clear };
}

// ---- components ----

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const isOther = node.kind === "file" && !/\.(mp3|jpg|jpeg|png)$/i.test(node.name);

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
  const [open, setOpen] = useState(false);
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

type Props = {
  result: FolderResult;
  deletingHidden: boolean;
  onDeleteHidden: () => void;
};

export default function DirectoryView({ result, deletingHidden, onDeleteHidden }: Props) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);

  const otherFiles = result.filePaths.filter((p) => !/\.(mp3|jpg|jpeg|png)$/i.test(p));

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
              MP3・JPG・PNG以外のファイル ({otherFiles.length}件)
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

      <div className="bg-zinc-900 rounded-xl border border-red-700">
        <div className="flex items-center justify-between p-6 pb-3">
          <div
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={() => setHiddenOpen((o) => !o)}
          >
            <span className="text-red-500">{hiddenOpen ? "▾" : "▸"}</span>
            <span className="text-red-400 font-semibold text-sm">
              隠しファイル ({result.hiddenEntries.length}件)
            </span>
          </div>
          <button
            onClick={onDeleteHidden}
            disabled={deletingHidden || result.hiddenEntries.length === 0}
            className="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {deletingHidden ? "削除中..." : "一括削除"}
          </button>
        </div>
        {hiddenOpen && (
          <ul className="font-mono text-sm text-red-400 space-y-1 px-6 pb-6">
            {result.hiddenEntries.map((entry: HiddenEntry, i: number) => (
              <li key={i}>{entry.name}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="text-right text-zinc-400 text-sm font-mono">
        合計ファイル数: <span className="text-zinc-100 font-semibold">{result.count}</span>
      </div>
    </div>
  );
}
