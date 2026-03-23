"use client";

import { useRef, useState } from "react";
import { collectAudioFiles, getOrCreateDir, ConvertState } from "@/lib/fsUtils";

// ---- hook ----

export function useAudioConverter() {
  const [convertState, setConvertState] = useState<ConvertState | null>(null);
  const ffmpegRef = useRef<import("@ffmpeg/ffmpeg").FFmpeg | null>(null);

  const isConverting =
    convertState !== null &&
    convertState.status !== "done" &&
    convertState.status !== "error";

  async function convertAudio() {
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

  function clear() {
    setConvertState(null);
  }

  return { isConverting, convertState, convertAudio, clear };
}

// ---- component ----

type Props = {
  state: ConvertState;
};

export default function AudioConv({ state }: Props) {
  return (
    <div className="w-full max-w-3xl mb-8">
      <div className="bg-zinc-900 rounded-xl border border-indigo-700 p-6 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-indigo-400 font-semibold text-sm">
            {state.status === "loading-ffmpeg" && "ffmpeg を読み込み中..."}
            {state.status === "scanning" && "ファイルをスキャン中..."}
            {state.status === "converting" && `変換中 (${state.current} / ${state.total})`}
            {state.status === "done" && `完了 — ${state.total} ファイル変換`}
            {state.status === "error" && "エラーが発生しました"}
          </span>
        </div>
        {state.status === "converting" && (
          <>
            <div className="w-full bg-zinc-800 rounded-full h-2">
              <div
                className="bg-indigo-500 h-2 rounded-full transition-all"
                style={{ width: `${(state.current / state.total) * 100}%` }}
              />
            </div>
            <p className="font-mono text-xs text-zinc-400 truncate">{state.currentFile}</p>
          </>
        )}
        {state.status === "done" && state.errors.length > 0 && (
          <div>
            <p className="text-red-400 text-sm font-semibold mb-1">失敗したファイル ({state.errors.length}件)</p>
            <ul className="font-mono text-xs text-red-400 space-y-0.5 max-h-40 overflow-y-auto">
              {state.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
        {state.status === "done" && state.errors.length === 0 && state.total > 0 && (
          <p className="text-green-400 text-sm">すべてのファイルを converted/ に保存しました</p>
        )}
      </div>
    </div>
  );
}
