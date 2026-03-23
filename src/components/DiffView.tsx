"use client";

import { useState } from "react";
import { buildTree } from "@/lib/fsUtils";

// ---- hook ----

export type DiffResult = {
  rootA: string;
  rootB: string;
  onlyA: string[];
  onlyB: string[];
  common: number;
};

export function useDiffViewer() {
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function selectAndDiff() {
    try {
      const dirA = await (window as any).showDirectoryPicker();
      const dirB = await (window as any).showDirectoryPicker();
      setLoading(true);
      const [resA, resB] = await Promise.all([buildTree(dirA), buildTree(dirB)]);
      const isImage = (p: string) => /\.(jpe?g|png)$/i.test(p);
      const setB = new Set(resB.filePaths.filter((p) => !isImage(p)));
      const setA = new Set(resA.filePaths.filter((p) => !isImage(p)));
      const onlyA = [...setA].filter((p) => !setB.has(p));
      const onlyB = [...setB].filter((p) => !setA.has(p));
      const common = [...setA].filter((p) => setB.has(p)).length;
      setResult({ rootA: dirA.name, rootB: dirB.name, onlyA, onlyB, common });
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function clear() {
    setResult(null);
  }

  return { loading, result, selectAndDiff, clear };
}

// ---- components ----

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

type Props = {
  result: DiffResult;
};

export default function DiffView({ result }: Props) {
  return (
    <div className="w-full max-w-3xl space-y-6">
      <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-700 font-mono text-sm text-zinc-400">
        <span className="text-green-400">{result.rootA}/</span>
        <span className="mx-2">と</span>
        <span className="text-red-400">{result.rootB}/</span>
        <span className="ml-4">共通: <span className="text-zinc-100 font-semibold">{result.common}</span>件</span>
      </div>
      {result.onlyA.length > 0 && (
        <DiffList label={`${result.rootA} にのみ存在`} paths={result.onlyA} color="green" />
      )}
      {result.onlyB.length > 0 && (
        <DiffList label={`${result.rootB} にのみ存在`} paths={result.onlyB} color="red" />
      )}
      {result.onlyA.length === 0 && result.onlyB.length === 0 && (
        <div className="text-center text-zinc-400 text-sm">差分はありません</div>
      )}
    </div>
  );
}
