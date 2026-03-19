"use client";

import Header from "@/components/Header";

import { useRef, useState } from "react";

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
  for await (const entry of dir as any) entries.push(entry);
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

// 変換対象
const AUDIO_FORMATS = /\.(flac|wav|aiff|aif|wma|ogg|m4a|opus|aac|alac|ape|dsf|dff)$/i;

type AudioFileEntry = {
  relPath: string;
  fileHandle: FileSystemFileHandle;
};

async function collectAudioFiles(
  dir: FileSystemDirectoryHandle,
  relPath = ""
): Promise<AudioFileEntry[]> {
  const results: AudioFileEntry[] = [];
  for await (const [name, handle] of dir as any) {
    const path = relPath ? `${relPath}/${name}` : name;
    if (handle.kind === "directory") {
      if (name === "converted") continue;
      const sub = await collectAudioFiles(handle as FileSystemDirectoryHandle, path);
      results.push(...sub);
    } else if (AUDIO_FORMATS.test(name)) {
      results.push({ relPath: path, fileHandle: handle as FileSystemFileHandle });
    }
  }
  return results;
}

async function getOrCreateDir(
  root: FileSystemDirectoryHandle,
  pathParts: string[]
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of pathParts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

type ConvertState = {
  status: "loading-ffmpeg" | "scanning" | "converting" | "done" | "error";
  current: number;
  total: number;
  currentFile: string;
  errors: string[];
};

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
  const [hiddenOpen, setHiddenOpen] = useState(false);

  const [diffResult, setDiffResult] = useState<{
    rootA: string;
    rootB: string;
    onlyA: string[];
    onlyB: string[];
    common: number;
  } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const [convertState, setConvertState] = useState<ConvertState | null>(null);
  const ffmpegRef = useRef<import("@ffmpeg/ffmpeg").FFmpeg | null>(null);

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

  // 変換を実行する関数
  async function convertAudio() {
    setResult(null);
    setDiffResult(null);
    try {
      const dir = await (window as any).showDirectoryPicker();

      if (!ffmpegRef.current) {
        setConvertState({ status: "loading-ffmpeg", current: 0, total: 0, currentFile: "", errors: [] });
        const { FFmpeg } = await import("@ffmpeg/ffmpeg");
        const { toBlobURL } = await import("@ffmpeg/util");
        const ffmpeg = new FFmpeg();
        await ffmpeg.load({
          coreURL: await toBlobURL("/ffmpeg/ffmpeg-core.js", "text/javascript"),
          wasmURL: await toBlobURL("/ffmpeg/ffmpeg-core.wasm", "application/wasm"),
        });
        ffmpegRef.current = ffmpeg;
      }

      setConvertState({ status: "scanning", current: 0, total: 0, currentFile: "", errors: [] });
      const audioFiles = await collectAudioFiles(dir);

      if (audioFiles.length === 0) {
        setConvertState({ status: "done", current: 0, total: 0, currentFile: "", errors: ["変換対象の音源ファイルが見つかりませんでした"] });
        return;
      }

      const ffmpeg = ffmpegRef.current!;
      const errors: string[] = [];

      for (let i = 0; i < audioFiles.length; i++) {
        const { relPath, fileHandle } = audioFiles[i];
        setConvertState({ status: "converting", current: i + 1, total: audioFiles.length, currentFile: relPath, errors: [...errors] });

        try {
          const file = await fileHandle.getFile();
          const inputData = new Uint8Array(await file.arrayBuffer());
          const ext = relPath.substring(relPath.lastIndexOf("."));
          const inputName = `input${ext}`;
          const outputName = relPath.substring(relPath.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "") + ".mp3";

          await ffmpeg.writeFile(inputName, inputData);
          await ffmpeg.exec(["-i", inputName, "-b:a", "320k", "-map_metadata", "0", outputName]);
          const outputData = await ffmpeg.readFile(outputName) as Uint8Array;
          await ffmpeg.deleteFile(inputName);
          await ffmpeg.deleteFile(outputName);

          // converted/ + 元の相対パスでディレクトリを作成
          const relDir = relPath.includes("/") ? relPath.substring(0, relPath.lastIndexOf("/")) : "";
          const pathParts = relDir ? ["converted", ...relDir.split("/")] : ["converted"];
          const outDir = await getOrCreateDir(dir, pathParts);

          const outHandle = await outDir.getFileHandle(outputName, { create: true });
          const writable = await outHandle.createWritable();
          await writable.write(outputData as unknown as ArrayBuffer);
          await writable.close();
        } catch (err) {
          console.error(`Failed to convert ${relPath}:`, err);
          errors.push(relPath);
        }
      }

      setConvertState({ status: "done", current: audioFiles.length, total: audioFiles.length, currentFile: "", errors });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setConvertState(null);
      } else {
        console.error(e);
        setConvertState((prev) => prev ? { ...prev, status: "error" } : null);
      }
    }
  }

  const isConverting = convertState !== null && convertState.status !== "done" && convertState.status !== "error";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center pt-24 pb-16 px-6">
      <Header />

      <div className="flex gap-4 mb-10 flex-wrap justify-center">
        <button
          onClick={selectFolder}
          disabled={loading || diffLoading || isConverting}
          className="px-6 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium transition-colors"
        >
          {loading ? "Loading..." : "フォルダを選択"}
        </button>
        <button
          onClick={selectAndDiff}
          disabled={loading || diffLoading || isConverting}
          className="px-6 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium transition-colors"
        >
          {diffLoading ? "比較中..." : "差分を比較"}
        </button>
        <button
          onClick={convertAudio}
          disabled={loading || diffLoading || isConverting}
          className="px-6 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium transition-colors"
        >
          {isConverting ? "変換中..." : "音源を変換"}
        </button>
      </div>

      {convertState && (
        <div className="w-full max-w-3xl mb-8">
          <div className="bg-zinc-900 rounded-xl border border-indigo-700 p-6 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-indigo-400 font-semibold text-sm">
                {convertState.status === "loading-ffmpeg" && "ffmpeg を読み込み中..."}
                {convertState.status === "scanning" && "ファイルをスキャン中..."}
                {convertState.status === "converting" && `変換中 (${convertState.current} / ${convertState.total})`}
                {convertState.status === "done" && `完了 — ${convertState.total} ファイル変換`}
                {convertState.status === "error" && "エラーが発生しました"}
              </span>
            </div>
            {convertState.status === "converting" && (
              <>
                <div className="w-full bg-zinc-800 rounded-full h-2">
                  <div
                    className="bg-indigo-500 h-2 rounded-full transition-all"
                    style={{ width: `${(convertState.current / convertState.total) * 100}%` }}
                  />
                </div>
                <p className="font-mono text-xs text-zinc-400 truncate">{convertState.currentFile}</p>
              </>
            )}
            {convertState.status === "done" && convertState.errors.length > 0 && (
              <div>
                <p className="text-red-400 text-sm font-semibold mb-1">失敗したファイル ({convertState.errors.length}件)</p>
                <ul className="font-mono text-xs text-red-400 space-y-0.5 max-h-40 overflow-y-auto">
                  {convertState.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
            {convertState.status === "done" && convertState.errors.length === 0 && convertState.total > 0 && (
              <p className="text-green-400 text-sm">すべてのファイルを converted/ に保存しました</p>
            )}
          </div>
        </div>
      )}

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
            <div className="bg-zinc-900 rounded-xl border border-red-700">
              <div className="flex items-center justify-between p-6 pb-3">
                <div
                  className="flex items-center gap-2 cursor-pointer select-none"
                  onClick={() => setHiddenOpen((o) => !o)}
                >
                  <span className="text-red-500">{hiddenOpen ? "▾" : "▸"}</span>
                  <span className="text-red-400 font-semibold text-sm">隠しファイル ({result.hiddenEntries.length}件)</span>
                </div>
                <button
                  onClick={deleteHiddenFiles}
                  disabled={deletingHidden || result.hiddenEntries.length === 0}
                  className="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {deletingHidden ? "削除中..." : "一括削除"}
                </button>
              </div>
              {hiddenOpen && (
                <ul className="font-mono text-sm text-red-400 space-y-1 px-6 pb-6">
                  {result.hiddenEntries.map((entry, i) => (
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
