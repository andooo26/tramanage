"use client";

import { useRef, useState } from "react";

// ---- Types ----

type TrackMetadata = {
  title: string;
  artist: string;
  album: string;
  trackNumber: string;
  year: string;
  genre: string;
};

type AudioTrack = {
  relPath: string;
  fileHandle: FileSystemFileHandle;
  metadata: TrackMetadata;
  saveStatus: "idle" | "saving" | "saved" | "error";
};

type EditorState =
  | { status: "loading-ffmpeg" }
  | { status: "reading"; done: number; total: number }
  | { status: "ready"; tracks: AudioTrack[] };

const ALL_AUDIO = /\.(mp3|flac|wav|aiff|aif|wma|ogg|m4a|opus|aac|alac|ape|dsf|dff)$/i;

async function collectAllAudio(
  dir: FileSystemDirectoryHandle,
  relPath = ""
): Promise<{ relPath: string; fileHandle: FileSystemFileHandle }[]> {
  const results: { relPath: string; fileHandle: FileSystemFileHandle }[] = [];
  for await (const [name, handle] of dir as any) {
    const path = relPath ? `${relPath}/${name}` : name;
    if (handle.kind === "directory") {
      const sub = await collectAllAudio(handle as FileSystemDirectoryHandle, path);
      results.push(...sub);
    } else if (ALL_AUDIO.test(name)) {
      results.push({ relPath: path, fileHandle: handle as FileSystemFileHandle });
    }
  }
  return results;
}

function parseFFMetadata(text: string): TrackMetadata {
  const tags: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (line.startsWith(";") || line.trim() === "") continue;
    const eq = line.indexOf("=");
    if (eq > 0) {
      const key = line.substring(0, eq).toLowerCase().trim();
      const val = line.substring(eq + 1).trim();
      tags[key] = val;
    }
  }
  return {
    title: tags.title ?? "",
    artist: tags.artist ?? "",
    album: tags.album ?? "",
    trackNumber: tags.track ?? "",
    year: tags.date ?? tags.year ?? "",
    genre: tags.genre ?? "",
  };
}

// ---- Hook ----

export function useMetadataEditor() {
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const ffmpegRef = useRef<import("@ffmpeg/ffmpeg").FFmpeg | null>(null);

  const isBusy =
    loading ||
    (editorState?.status === "ready" &&
      editorState.tracks.some((t) => t.saveStatus === "saving"));

  async function loadFfmpeg() {
    if (ffmpegRef.current) return ffmpegRef.current;
    setEditorState({ status: "loading-ffmpeg" });
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: await toBlobURL("/ffmpeg/ffmpeg-core.js", "text/javascript"),
      wasmURL: await toBlobURL("/ffmpeg/ffmpeg-core.wasm", "application/wasm"),
    });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }

  async function readMetadata(
    ffmpeg: import("@ffmpeg/ffmpeg").FFmpeg,
    fileHandle: FileSystemFileHandle,
    relPath: string
  ): Promise<TrackMetadata> {
    const ext = relPath.substring(relPath.lastIndexOf("."));
    const inputName = `probe_in${ext}`;
    const metaName = "probe_meta.txt";
    try {
      const file = await fileHandle.getFile();
      const inputData = new Uint8Array(await file.arrayBuffer());
      await ffmpeg.writeFile(inputName, inputData);
      // -f ffmetadata writes key=value metadata; ignore exit code
      try {
        await ffmpeg.exec(["-i", inputName, "-f", "ffmetadata", "-y", metaName]);
      } catch {
        // ffmpeg may return non-zero even on success
      }
      const raw = await ffmpeg.readFile(metaName) as Uint8Array;
      await ffmpeg.deleteFile(metaName).catch(() => {});
      await ffmpeg.deleteFile(inputName).catch(() => {});
      return parseFFMetadata(new TextDecoder().decode(raw));
    } catch {
      await ffmpeg.deleteFile(inputName).catch(() => {});
      return { title: "", artist: "", album: "", trackNumber: "", year: "", genre: "" };
    }
  }

  async function selectAndLoad() {
    try {
      setLoading(true);
      const dir = await (window as any).showDirectoryPicker({ mode: "readwrite" });

      const ffmpeg = await loadFfmpeg();
      const entries = await collectAllAudio(dir);

      const tracks: AudioTrack[] = [];
      for (let i = 0; i < entries.length; i++) {
        const { relPath, fileHandle } = entries[i];
        setEditorState({ status: "reading", done: i, total: entries.length });
        const metadata = await readMetadata(ffmpeg, fileHandle, relPath);
        tracks.push({ relPath, fileHandle, metadata, saveStatus: "idle" });
      }

      setEditorState({ status: "ready", tracks });
      setSelectedIndex(0);
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error(e);
      setEditorState(null);
    } finally {
      setLoading(false);
    }
  }

  async function saveTrack(index: number) {
    if (!editorState || editorState.status !== "ready") return;
    const track = editorState.tracks[index];

    setEditorState((prev) =>
      prev?.status === "ready"
        ? { ...prev, tracks: prev.tracks.map((t, i) => i === index ? { ...t, saveStatus: "saving" } : t) }
        : prev
    );

    try {
      const ffmpeg = await loadFfmpeg();
      const file = await track.fileHandle.getFile();
      const inputData = new Uint8Array(await file.arrayBuffer());
      const ext = track.relPath.substring(track.relPath.lastIndexOf("."));
      const inputName = `meta_in${ext}`;
      const outputName = `meta_out${ext}`;

      await ffmpeg.writeFile(inputName, inputData);

      const { title, artist, album, trackNumber, year, genre } = track.metadata;
      const metaArgs: string[] = [];
      if (title) metaArgs.push("-metadata", `title=${title}`);
      if (artist) metaArgs.push("-metadata", `artist=${artist}`);
      if (album) metaArgs.push("-metadata", `album=${album}`);
      if (trackNumber) metaArgs.push("-metadata", `track=${trackNumber}`);
      if (year) metaArgs.push("-metadata", `date=${year}`);
      if (genre) metaArgs.push("-metadata", `genre=${genre}`);

      await ffmpeg.exec(["-i", inputName, "-map_metadata", "-1", ...metaArgs, "-c", "copy", outputName]);
      const outputData = (await ffmpeg.readFile(outputName)) as Uint8Array;
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);

      const writable = await track.fileHandle.createWritable();
      await writable.write(outputData as unknown as ArrayBuffer);
      await writable.close();

      setEditorState((prev) =>
        prev?.status === "ready"
          ? { ...prev, tracks: prev.tracks.map((t, i) => i === index ? { ...t, saveStatus: "saved" } : t) }
          : prev
      );
    } catch (err) {
      console.error("Failed to save metadata:", err);
      setEditorState((prev) =>
        prev?.status === "ready"
          ? { ...prev, tracks: prev.tracks.map((t, i) => i === index ? { ...t, saveStatus: "error" } : t) }
          : prev
      );
    }
  }

  function updateMetadata(index: number, field: keyof TrackMetadata, value: string) {
    setEditorState((prev) =>
      prev?.status === "ready"
        ? {
            ...prev,
            tracks: prev.tracks.map((t, i) =>
              i === index
                ? { ...t, metadata: { ...t.metadata, [field]: value }, saveStatus: "idle" }
                : t
            ),
          }
        : prev
    );
  }

  function clear() {
    setEditorState(null);
  }

  return {
    editorState,
    selectedIndex,
    setSelectedIndex,
    loading,
    isBusy,
    selectAndLoad,
    saveTrack,
    updateMetadata,
    clear,
  };
}

// ---- Component ----

const FIELDS: { key: keyof TrackMetadata; label: string }[] = [
  { key: "title", label: "タイトル" },
  { key: "artist", label: "アーティスト" },
  { key: "album", label: "アルバム" },
  { key: "trackNumber", label: "トラック番号" },
  { key: "year", label: "年" },
  { key: "genre", label: "ジャンル" },
];

type Props = {
  editorState: EditorState;
  selectedIndex: number;
  onSelect: (i: number) => void;
  onSave: (i: number) => void;
  onUpdateMetadata: (i: number, field: keyof TrackMetadata, value: string) => void;
};

export default function MetadataEdit({
  editorState,
  selectedIndex,
  onSelect,
  onSave,
  onUpdateMetadata,
}: Props) {
  if (editorState.status === "loading-ffmpeg") {
    return (
      <div className="w-full max-w-5xl mb-8">
        <div className="bg-zinc-900 rounded-xl border border-violet-700 p-6">
          <p className="text-violet-400 text-sm">ffmpeg を読み込み中...</p>
        </div>
      </div>
    );
  }

  if (editorState.status === "reading") {
    const pct = editorState.total > 0 ? (editorState.done / editorState.total) * 100 : 0;
    return (
      <div className="w-full max-w-5xl mb-8">
        <div className="bg-zinc-900 rounded-xl border border-violet-700 p-6 space-y-3">
          <p className="text-violet-400 text-sm">
            メタデータを読み込み中... ({editorState.done} / {editorState.total})
          </p>
          <div className="w-full bg-zinc-800 rounded-full h-2">
            <div
              className="bg-violet-500 h-2 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  const { tracks } = editorState;

  if (tracks.length === 0) {
    return (
      <div className="w-full max-w-5xl mb-8">
        <div className="bg-zinc-900 rounded-xl border border-violet-700 p-6">
          <p className="text-zinc-400 text-sm">音楽ファイルが見つかりませんでした</p>
        </div>
      </div>
    );
  }

  const selected = tracks[selectedIndex] ?? null;

  return (
    <div className="w-full max-w-5xl mb-8">
      <div className="bg-zinc-900 rounded-xl border border-violet-700 overflow-hidden flex h-[540px]">
        {/* File list */}
        <div className="w-64 border-r border-zinc-800 overflow-y-auto flex-shrink-0">
          {tracks.map((track, i) => {
            const fileName = track.relPath.includes("/")
              ? track.relPath.substring(track.relPath.lastIndexOf("/") + 1)
              : track.relPath;
            const isSelected = i === selectedIndex;
            return (
              <button
                key={i}
                onClick={() => onSelect(i)}
                className={`w-full text-left px-3 py-2.5 border-b border-zinc-800 transition-colors ${
                  isSelected
                    ? "bg-violet-900/40 border-l-2 border-l-violet-500"
                    : "hover:bg-zinc-800"
                }`}
              >
                <div className="flex items-start gap-1.5">
                  <span className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-100 truncate font-mono">{fileName}</p>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">
                      {track.metadata.artist || "—"}
                    </p>
                  </span>
                  {track.saveStatus === "saved" && (
                    <span className="text-green-400 text-xs mt-0.5">✓</span>
                  )}
                  {track.saveStatus === "saving" && (
                    <span className="text-violet-400 text-xs mt-0.5 animate-pulse">…</span>
                  )}
                  {track.saveStatus === "error" && (
                    <span className="text-red-400 text-xs mt-0.5">✗</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Edit panel */}
        {selected && (
          <div className="flex-1 p-6 overflow-y-auto">
            <p className="text-xs text-zinc-500 font-mono mb-5 truncate">{selected.relPath}</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-6">
              {FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs text-zinc-400 mb-1">{label}</label>
                  <input
                    type="text"
                    value={selected.metadata[key]}
                    onChange={(e) => onUpdateMetadata(selectedIndex, key, e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-violet-500 transition-colors"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => onSave(selectedIndex)}
                disabled={selected.saveStatus === "saving"}
                className="px-5 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {selected.saveStatus === "saving" ? "保存中..." : "保存"}
              </button>
              {selected.saveStatus === "saved" && (
                <span className="text-green-400 text-sm">保存しました</span>
              )}
              {selected.saveStatus === "error" && (
                <span className="text-red-400 text-sm">保存に失敗しました</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
