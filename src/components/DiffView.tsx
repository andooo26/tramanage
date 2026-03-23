"use client";

import { useState } from "react";
import { buildTree, getOrCreateDir } from "@/lib/fsUtils";

// ---- hook ----

export type DiffResult = {
  rootA: string;
  rootB: string;
  dirA: FileSystemDirectoryHandle;
  dirB: FileSystemDirectoryHandle;
  onlyA: string[];
  onlyB: string[];
  common: number;
};

async function copyFiles(
  paths: string[],
  srcDir: FileSystemDirectoryHandle,
  destDir: FileSystemDirectoryHandle
) {
  for (const relPath of paths) {
    const parts = relPath.split("/");
    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);

    // ソースファイルを取得
    let srcHandle: FileSystemDirectoryHandle = srcDir;
    for (const part of dirParts) {
      srcHandle = await srcHandle.getDirectoryHandle(part);
    }
    const srcFile = await srcHandle.getFileHandle(fileName);
    const file = await srcFile.getFile();

    // コピー先ディレクトリを作成
    const destSubDir = dirParts.length > 0
      ? await getOrCreateDir(destDir, dirParts)
      : destDir;

    // ファイルを書き込む
    const destFile = await destSubDir.getFileHandle(fileName, { create: true });
    const writable = await (destFile as any).createWritable();
    await writable.write(file);
    await writable.close();
  }
}

async function runDiff(
  dirA: FileSystemDirectoryHandle,
  dirB: FileSystemDirectoryHandle
): Promise<DiffResult> {
  const [resA, resB] = await Promise.all([buildTree(dirA), buildTree(dirB)]);
  const isImage = (p: string) => /\.(jpe?g|png)$/i.test(p);
  const setB = new Set(resB.filePaths.filter((p) => !isImage(p)));
  const setA = new Set(resA.filePaths.filter((p) => !isImage(p)));
  const onlyA = [...setA].filter((p) => !setB.has(p));
  const onlyB = [...setB].filter((p) => !setA.has(p));
  const common = [...setA].filter((p) => setB.has(p)).length;
  return { rootA: dirA.name, rootB: dirB.name, dirA, dirB, onlyA, onlyB, common };
}

export function useDiffViewer() {
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);

  async function selectAndDiff() {
    try {
      const dirA = await (window as any).showDirectoryPicker();
      const dirB = await (window as any).showDirectoryPicker();
      setLoading(true);
      setResult(await runDiff(dirA, dirB));
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function copyOnlyAToB() {
    if (!result) return;
    setCopying(true);
    try {
      await copyFiles(result.onlyA, result.dirA, result.dirB);
      setLoading(true);
      setResult(await runDiff(result.dirA, result.dirB));
    } catch (e) {
      console.error(e);
    } finally {
      setCopying(false);
      setLoading(false);
    }
  }

  async function copyOnlyBToA() {
    if (!result) return;
    setCopying(true);
    try {
      await copyFiles(result.onlyB, result.dirB, result.dirA);
      setLoading(true);
      setResult(await runDiff(result.dirA, result.dirB));
    } catch (e) {
      console.error(e);
    } finally {
      setCopying(false);
      setLoading(false);
    }
  }

  function clear() {
    setResult(null);
  }

  return { loading, copying, result, selectAndDiff, copyOnlyAToB, copyOnlyBToA, clear };
}

// ---- components ----

function DiffList({
  label,
  paths,
  color,
  copyLabel,
  onCopy,
  copying,
}: {
  label: string;
  paths: string[];
  color: "green" | "red";
  copyLabel: string;
  onCopy: () => void;
  copying: boolean;
}) {
  const [open, setOpen] = useState(false);
  const styles = {
    green: { border: "border-green-700", text: "text-green-400", arrow: "text-green-500" },
    red:   { border: "border-red-700",   text: "text-red-400",   arrow: "text-red-500"   },
  }[color];

  return (
    <div className={`bg-zinc-900 rounded-xl border ${styles.border}`}>
      <div className="flex items-center justify-between p-6 pb-3">
        <div
          className="flex items-center gap-2 cursor-pointer select-none"
          onClick={() => setOpen((o) => !o)}
        >
          <span className={styles.arrow}>{open ? "▾" : "▸"}</span>
          <span className={`${styles.text} font-semibold text-sm`}>{label} ({paths.length}件)</span>
        </div>
        <button
          onClick={onCopy}
          disabled={copying}
          className="text-xs px-3 py-1 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-200 transition-colors"
        >
          {copying ? "コピー中…" : copyLabel}
        </button>
      </div>
      {open && (
        <ul className={`font-mono text-sm ${styles.text} space-y-1 px-6 pb-6`}>
          {paths.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}
    </div>
  );
}

type Props = {
  result: DiffResult;
  copying: boolean;
  onCopyAToB: () => void;
  onCopyBToA: () => void;
};

export default function DiffView({ result, copying, onCopyAToB, onCopyBToA }: Props) {
  const labelA = `${result.rootA} (dir1)`;
  const labelB = `${result.rootB} (dir2)`;

  return (
    <div className="w-full max-w-3xl space-y-6">
      <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-700 font-mono text-sm text-zinc-400">
        <span className="text-green-400">{labelA}/</span>
        <span className="mx-2">と</span>
        <span className="text-red-400">{labelB}/</span>
        <span className="ml-4">共通: <span className="text-zinc-100 font-semibold">{result.common}</span>件</span>
      </div>
      {result.onlyA.length > 0 && (
        <DiffList
          label={`${labelA} にのみ存在`}
          paths={result.onlyA}
          color="green"
          copyLabel={`→ ${labelB} にコピー`}
          onCopy={onCopyAToB}
          copying={copying}
        />
      )}
      {result.onlyB.length > 0 && (
        <DiffList
          label={`${labelB} にのみ存在`}
          paths={result.onlyB}
          color="red"
          copyLabel={`→ ${labelA} にコピー`}
          onCopy={onCopyBToA}
          copying={copying}
        />
      )}
      {result.onlyA.length === 0 && result.onlyB.length === 0 && (
        <div className="text-center text-zinc-400 text-sm">差分はありません</div>
      )}
    </div>
  );
}
