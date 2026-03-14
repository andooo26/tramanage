"use client";

import { useState } from "react";

type HiddenEntry = { parent: FileSystemDirectoryHandle; name: string };

type TreeNode = {
  name: string;
  kind: "file" | "directory";
  path: string;
  children: TreeNode[];
};

// 選択ディレクトリのツリー構造を構築
async function buildTree(dir: FileSystemDirectoryHandle, dirPath = "") {
  const entries: [string, FileSystemHandle][] = [];
  for await (const entry of dir) entries.push(entry);
  entries.sort(([a], [b]) => a.localeCompare(b));

  const nodes: TreeNode[] = [];
  const filePaths: string[] = [];
  const hiddenEntries: HiddenEntry[] = [];
  let count = 0;

  for (const [name, handle] of entries) {
    const path = dirPath ? `${dirPath}/${name}` : name;
    if (handle.kind === "directory") {
      const sub = await buildTree(handle as FileSystemDirectoryHandle, path);
      nodes.push({ name, kind: "directory", path, children: sub.nodes });
      filePaths.push(...sub.filePaths);
      hiddenEntries.push(...sub.hiddenEntries);
      count += sub.count;
    } else {
      nodes.push({ name, kind: "file", path, children: [] });
      filePaths.push(path);
      count++;
      if (name.startsWith(".")) hiddenEntries.push({ parent: dir, name });
    }
  }

  return { nodes, filePaths, hiddenEntries, count };
}

// 除外拡張子
function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  // 1階層目まで標準で展開しておく
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

// ツリー表示のコンポーネント
function RootTree({ root, nodes }: { root: string; nodes: TreeNode[] }) {
  // 読込時はツリーを閉じる
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

// 差分リストのコンポーネント
function DiffList({ label, paths, color }: { label: string; paths: string[]; color: "green" | "red" }) {
  const [open, setOpen] = useState(false);
  const styles = {
    green: { border: "border-green-700", text: "text-green-400", arrow: "text-green-500" },
    red:   { border: "border-red-700",   text: "text-red-400",   arrow: "text-red-500"   },
  }[color];

  return (
    <div className={`bg-zinc-900 rounded-xl border ${styles.border}`}>
      <div
        className="flex items-center gap-2 p-6 pb-3 cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.arrow}>{open ? "▾" : "▸"}</span>
        <span className={`${styles.text} font-semibold text-sm`}>{label} ({paths.length}件)</span>
      </div>
      {open && (
        <ul className={`font-mono text-sm ${styles.text} space-y-1 px-6 pb-6`}>
          {paths.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
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
    hiddenEntries: HiddenEntry[];
    count: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingHidden, setDeletingHidden] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);

  const [diffResult, setDiffResult] = useState<{
    rootA: string;
    rootB: string;
    onlyA: string[];
    onlyB: string[];
    common: number;
  } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  async function selectFolder() {
    setDiffResult(null);
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

  // 隠しファイルを削除する関数
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

  // 2つのディレクトリを比較する関数
  async function selectAndDiff() {
    setResult(null);
    try {
      const dirA = await (window as any).showDirectoryPicker();
      const dirB = await (window as any).showDirectoryPicker();
      setDiffLoading(true);
      const [resA, resB] = await Promise.all([buildTree(dirA), buildTree(dirB)]);
      const setB = new Set(resB.filePaths);
      const setA = new Set(resA.filePaths);
      const onlyA = resA.filePaths.filter((p) => !setB.has(p));
      const onlyB = resB.filePaths.filter((p) => !setA.has(p));
      const common = resA.filePaths.filter((p) => setB.has(p)).length;
      setDiffResult({ rootA: dirA.name, rootB: dirB.name, onlyA, onlyB, common });
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
    } finally {
      setDiffLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center py-16 px-6">
      <h1 className="text-3xl font-bold mb-8 tracking-widest">tramanage</h1>

      <div className="flex gap-4 mb-10">
        <button
          onClick={selectFolder}
          disabled={loading || diffLoading}
          className="px-6 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium transition-colors"
        >
          {loading ? "Loading..." : "フォルダを選択"}
        </button>
        <button
          onClick={selectAndDiff}
          disabled={loading || diffLoading}
          className="px-6 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium transition-colors"
        >
          {diffLoading ? "比較中..." : "差分を比較"}
        </button>
      </div>

      {result && !loading && (() => {
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
            <div className="bg-zinc-900 rounded-xl p-6 border border-red-700">
              <div className="flex items-center justify-between">
                <div className="text-red-400 font-semibold text-sm">隠しファイル ({result.hiddenEntries.length}件)</div>
                <button
                  onClick={deleteHiddenFiles}
                  disabled={deletingHidden || result.hiddenEntries.length === 0}
                  className="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {deletingHidden ? "削除中..." : "一括削除"}
                </button>
              </div>
            </div>
            <div className="text-right text-zinc-400 text-sm font-mono">
              合計ファイル数: <span className="text-zinc-100 font-semibold">{result.count}</span>
            </div>
          </div>
        );
      })()}

      {diffResult && !diffLoading && (
        <div className="w-full max-w-3xl space-y-6">
          <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-700 font-mono text-sm text-zinc-400">
            <span className="text-green-400">{diffResult.rootA}/</span>
            <span className="mx-2">と</span>
            <span className="text-red-400">{diffResult.rootB}/</span>
            <span className="ml-4">共通: <span className="text-zinc-100 font-semibold">{diffResult.common}</span>件</span>
          </div>
          {diffResult.onlyA.length > 0 && (
            <DiffList label={`${diffResult.rootA} にのみ存在`} paths={diffResult.onlyA} color="green" />
          )}
          {diffResult.onlyB.length > 0 && (
            <DiffList label={`${diffResult.rootB} にのみ存在`} paths={diffResult.onlyB} color="red" />
          )}
          {diffResult.onlyA.length === 0 && diffResult.onlyB.length === 0 && (
            <div className="text-center text-zinc-400 text-sm">差分はありません</div>
          )}
        </div>
      )}
    </div>
  );
}
