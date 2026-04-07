"use client";

import { useEffect, useRef, useState } from "react";

// ---- Types ----

type TrackMetadata = {
  title: string;
  artist: string;
  album: string;
  trackNumber: string;
  year: string;
  genre: string;
};

type CoverArtUpdate = { dataUrl: string; data: Uint8Array; mimeType: string };

type AudioTrack = {
  relPath: string;
  fileHandle: FileSystemFileHandle;
  metadata: TrackMetadata;
  newFileName: string;
  saveStatus: "idle" | "saving" | "saved" | "error";
  coverArt: string | null;
  newCoverArt: CoverArtUpdate | "remove" | null;
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
  const entries: [string, FileSystemHandle][] = [];
  for await (const entry of dir as any) entries.push(entry);
  entries.sort(([a], [b]) => a.localeCompare(b));

  const results: { relPath: string; fileHandle: FileSystemFileHandle }[] = [];
  for (const [name, handle] of entries) {
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
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);

  const isBusy =
    loading ||
    (editorState?.status === "ready" &&
      editorState.tracks.some((t) => t.saveStatus === "saving"));

  async function loadFfmpeg(showLoadingState = true) {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (showLoadingState) setEditorState({ status: "loading-ffmpeg" });
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
  ): Promise<{ metadata: TrackMetadata; coverArt: string | null }> {
    const ext = relPath.substring(relPath.lastIndexOf("."));
    const inputName = `probe_in${ext}`;
    const metaName = "probe_meta.txt";
    const coverName = "probe_cover.jpg";
    const empty: TrackMetadata = { title: "", artist: "", album: "", trackNumber: "", year: "", genre: "" };
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
      let metadata = empty;
      try {
        const raw = await ffmpeg.readFile(metaName) as Uint8Array;
        await ffmpeg.deleteFile(metaName).catch(() => {});
        metadata = parseFFMetadata(new TextDecoder().decode(raw));
      } catch {}

      // Extract cover art (embedded as video stream in most formats)
      let coverArt: string | null = null;
      try {
        await ffmpeg.exec(["-i", inputName, "-map", "0:v", "-c", "copy", "-y", coverName]);
        const coverData = await ffmpeg.readFile(coverName) as Uint8Array;
        await ffmpeg.deleteFile(coverName).catch(() => {});
        if (coverData.length > 100) {
          let binary = "";
          for (let i = 0; i < coverData.length; i++) binary += String.fromCharCode(coverData[i]);
          coverArt = `data:image/jpeg;base64,${btoa(binary)}`;
        }
      } catch {}

      await ffmpeg.deleteFile(inputName).catch(() => {});
      return { metadata, coverArt };
    } catch {
      await ffmpeg.deleteFile(inputName).catch(() => {});
      return { metadata: empty, coverArt: null };
    }
  }

  async function selectAndLoad() {
    try {
      setLoading(true);
      const dir = await (window as any).showDirectoryPicker({ mode: "readwrite" });

      const ffmpeg = await loadFfmpeg();
      dirHandleRef.current = dir;
      const entries = await collectAllAudio(dir);

      const tracks: AudioTrack[] = [];
      for (let i = 0; i < entries.length; i++) {
        const { relPath, fileHandle } = entries[i];
        setEditorState({ status: "reading", done: i, total: entries.length });
        const { metadata, coverArt } = await readMetadata(ffmpeg, fileHandle, relPath);
        const fileName = relPath.includes("/") ? relPath.substring(relPath.lastIndexOf("/") + 1) : relPath;
        tracks.push({ relPath, fileHandle, metadata, newFileName: fileName, saveStatus: "idle", coverArt, newCoverArt: null });
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
      // Reset FFmpeg instance before each save to get a fresh WASM heap,
      // preventing "memory access out of bounds" from heap fragmentation.
      ffmpegRef.current = null;
      const ffmpeg = await loadFfmpeg(false);
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

      const { newCoverArt } = track;
      let coverInputName: string | null = null;
      if (newCoverArt && newCoverArt !== "remove") {
        const coverExt = newCoverArt.mimeType === "image/png" ? ".png" : ".jpg";
        coverInputName = `cover_in${coverExt}`;
        await ffmpeg.writeFile(coverInputName, newCoverArt.data);
      }

      const ffArgs: string[] = ["-i", inputName];
      if (coverInputName) ffArgs.push("-i", coverInputName);

      if (coverInputName) {
        // New cover art: audio from input 0, cover art from input 1
        ffArgs.push("-map", "0:a", "-map", "1");
      } else if (newCoverArt === "remove") {
        // Remove cover art: only map audio streams
        ffArgs.push("-map", "0:a");
      } else {
        // No change: preserve all streams (audio + existing cover art)
        ffArgs.push("-map", "0");
      }

      ffArgs.push("-map_metadata", "-1", ...metaArgs, "-c", "copy", outputName);

      await ffmpeg.exec(ffArgs);
      if (coverInputName) await ffmpeg.deleteFile(coverInputName).catch(() => {});
      const outputData = (await ffmpeg.readFile(outputName)) as Uint8Array;
      await ffmpeg.deleteFile(inputName).catch(() => {});
      await ffmpeg.deleteFile(outputName).catch(() => {});
      // Release WASM memory immediately after extracting output
      ffmpegRef.current = null;

      const currentFileName = track.relPath.includes("/")
        ? track.relPath.substring(track.relPath.lastIndexOf("/") + 1)
        : track.relPath;
      const isRenamed = track.newFileName.trim() !== "" && track.newFileName.trim() !== currentFileName;

      if (isRenamed && dirHandleRef.current) {
        // Navigate to parent directory
        const dirParts = track.relPath.includes("/")
          ? track.relPath.substring(0, track.relPath.lastIndexOf("/")).split("/")
          : [];
        let parentDir: FileSystemDirectoryHandle = dirHandleRef.current;
        for (const part of dirParts) {
          parentDir = await parentDir.getDirectoryHandle(part);
        }
        // Write new file
        const newHandle = await parentDir.getFileHandle(track.newFileName.trim(), { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(outputData as unknown as ArrayBuffer);
        await writable.close();
        // Delete old file
        await parentDir.removeEntry(currentFileName);
        // Update relPath and fileHandle in state
        const newRelPath = dirParts.length > 0
          ? `${dirParts.join("/")}/${track.newFileName.trim()}`
          : track.newFileName.trim();
        // Determine saved cover art state
        const savedCoverArt = track.newCoverArt === "remove" ? null
          : track.newCoverArt ? track.newCoverArt.dataUrl
          : track.coverArt;
        setEditorState((prev) =>
          prev?.status === "ready"
            ? { ...prev, tracks: prev.tracks.map((t, i) => i === index ? { ...t, relPath: newRelPath, fileHandle: newHandle, saveStatus: "saved", coverArt: savedCoverArt, newCoverArt: null } : t) }
            : prev
        );
      } else {
        const writable = await track.fileHandle.createWritable();
        await writable.write(outputData as unknown as ArrayBuffer);
        await writable.close();
        const savedCoverArt = track.newCoverArt === "remove" ? null
          : track.newCoverArt ? track.newCoverArt.dataUrl
          : track.coverArt;
        setEditorState((prev) =>
          prev?.status === "ready"
            ? { ...prev, tracks: prev.tracks.map((t, i) => i === index ? { ...t, saveStatus: "saved", coverArt: savedCoverArt, newCoverArt: null } : t) }
            : prev
        );
      }
    } catch (err) {
      console.error("Failed to save metadata:", err);
      ffmpegRef.current = null;
      setEditorState((prev) =>
        prev?.status === "ready"
          ? { ...prev, tracks: prev.tracks.map((t, i) => i === index ? { ...t, saveStatus: "error" } : t) }
          : prev
      );
    }
  }

  function updateFileName(index: number, value: string) {
    setEditorState((prev) =>
      prev?.status === "ready"
        ? {
            ...prev,
            tracks: prev.tracks.map((t, i) =>
              i === index ? { ...t, newFileName: value, saveStatus: "idle" } : t
            ),
          }
        : prev
    );
  }

  function updateCoverArt(index: number, value: CoverArtUpdate | "remove" | null) {
    setEditorState((prev) =>
      prev?.status === "ready"
        ? {
            ...prev,
            tracks: prev.tracks.map((t, i) =>
              i === index ? { ...t, newCoverArt: value, saveStatus: "idle" } : t
            ),
          }
        : prev
    );
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
    updateFileName,
    updateCoverArt,
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

function formatTime(sec: number): string {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  editorState: EditorState;
  selectedIndex: number;
  onSelect: (i: number) => void;
  onSave: (i: number) => void;
  onUpdateMetadata: (i: number, field: keyof TrackMetadata, value: string) => void;
  onUpdateFileName: (i: number, value: string) => void;
  onUpdateCoverArt: (i: number, value: CoverArtUpdate | "remove" | null) => void;
};

export default function MetadataEdit({
  editorState,
  selectedIndex,
  onSelect,
  onSave,
  onUpdateMetadata,
  onUpdateFileName,
  onUpdateCoverArt,
}: Props) {
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime));
    audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
    audio.addEventListener("ended", () => setIsPlaying(false));

    return () => {
      audio.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      audioRef.current = null;
    };
  }, []);

  async function handlePlay(index: number) {
    if (editorState.status !== "ready") return;
    const audio = audioRef.current;
    if (!audio) return;

    if (playingIndex === index) {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        await audio.play();
        setIsPlaying(true);
      }
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const track = editorState.tracks[index];
    const file = await track.fileHandle.getFile();
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    audio.src = url;
    audio.currentTime = 0;
    setPlayingIndex(index);
    setCurrentTime(0);
    setDuration(0);
    await audio.play();
    setIsPlaying(true);
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const t = parseFloat(e.target.value);
    audio.currentTime = t;
    setCurrentTime(t);
  }

  function handleVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  }

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

  const q = searchQuery.trim().toLowerCase();
  const filteredTracks = q
    ? tracks
        .map((track, originalIndex) => ({ track, originalIndex }))
        .filter(({ track }) => {
          const fileName = track.relPath.includes("/")
            ? track.relPath.substring(track.relPath.lastIndexOf("/") + 1)
            : track.relPath;
          return (
            fileName.toLowerCase().includes(q) ||
            track.metadata.title.toLowerCase().includes(q) ||
            track.metadata.artist.toLowerCase().includes(q) ||
            track.metadata.album.toLowerCase().includes(q)
          );
        })
    : tracks.map((track, originalIndex) => ({ track, originalIndex }));

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
  const playingTrack = playingIndex !== null ? tracks[playingIndex] : null;

  return (
    <div className="w-full max-w-5xl mb-8">
      <div className="bg-zinc-900 rounded-xl border border-violet-700 overflow-hidden flex flex-col">
        <div className="flex h-[540px]">
          {/* File list */}
          <div className="w-64 border-r border-zinc-800 flex flex-col flex-shrink-0">
            <div className="px-3 py-2 border-b border-zinc-800 flex-shrink-0">
              <input
                type="text"
                placeholder="検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500 transition-colors"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {filteredTracks.length === 0 && (
                <p className="text-xs text-zinc-500 px-3 py-3">一致なし</p>
              )}
              {filteredTracks.map(({ track, originalIndex }) => {
                const fileName = track.relPath.includes("/")
                  ? track.relPath.substring(track.relPath.lastIndexOf("/") + 1)
                  : track.relPath;
                const isSelected = originalIndex === selectedIndex;
                const isThisPlaying = playingIndex === originalIndex && isPlaying;
                return (
                  <div
                    key={originalIndex}
                    className={`flex items-stretch border-b border-zinc-800 transition-colors ${
                      isSelected ? "bg-violet-900/40 border-l-2 border-l-violet-500" : "hover:bg-zinc-800"
                    }`}
                  >
                    <button
                      onClick={() => onSelect(originalIndex)}
                      className="flex-1 min-w-0 text-left px-3 py-2.5"
                    >
                      <div className="flex items-start gap-1.5">
                        <span className="flex-1 min-w-0">
                          <p className={`text-xs truncate font-mono ${playingIndex === originalIndex ? "text-violet-300" : "text-zinc-100"}`}>{fileName}</p>
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
                    <button
                      onClick={() => handlePlay(originalIndex)}
                      className="px-2 text-zinc-400 hover:text-violet-400 transition-colors flex-shrink-0"
                      title={isThisPlaying ? "一時停止" : "再生"}
                    >
                      {isThisPlaying ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                          <rect x="3" y="2" width="3.5" height="12" rx="1" />
                          <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                          <path d="M3 2.5l10 5.5-10 5.5V2.5z" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Edit panel */}
          {selected && (
            <div className="flex-1 p-6 overflow-y-auto">
              <p className="text-xs text-zinc-500 font-mono mb-4 truncate">{selected.relPath}</p>

              {/* Cover art */}
              {(() => {
                const coverUrl = selected.newCoverArt === "remove"
                  ? null
                  : selected.newCoverArt
                  ? selected.newCoverArt.dataUrl
                  : selected.coverArt;
                const hasCover = coverUrl !== null;
                return (
                  <div className="mb-5">
                    <label className="block text-xs text-zinc-400 mb-2">ジャケット画像</label>
                    <div className="flex items-start gap-3">
                      <div className="w-20 h-20 bg-zinc-800 border border-zinc-700 rounded flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {hasCover ? (
                          <img src={coverUrl!} alt="カバーアート" className="w-full h-full object-cover" />
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-zinc-600">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <circle cx="12" cy="12" r="4" />
                            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                          </svg>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 pt-0.5">
                        <label className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-100 cursor-pointer transition-colors">
                          {hasCover ? "変更" : "画像を選択"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const arrayBuffer = await file.arrayBuffer();
                              const data = new Uint8Array(arrayBuffer);
                              let binary = "";
                              for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
                              const dataUrl = `data:${file.type || "image/jpeg"};base64,${btoa(binary)}`;
                              onUpdateCoverArt(selectedIndex, { dataUrl, data, mimeType: file.type || "image/jpeg" });
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {(hasCover || selected.newCoverArt === "remove") && (
                          <button
                            onClick={() => onUpdateCoverArt(selectedIndex, selected.newCoverArt === "remove" ? null : "remove")}
                            className={`px-3 py-1.5 rounded text-xs transition-colors text-left ${
                              selected.newCoverArt === "remove"
                                ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                                : "bg-zinc-800 hover:bg-red-900/40 text-zinc-400 hover:text-red-400"
                            }`}
                          >
                            {selected.newCoverArt === "remove" ? "元に戻す" : "削除"}
                          </button>
                        )}
                        {selected.newCoverArt === "remove" && (
                          <span className="text-xs text-red-400">削除予定</span>
                        )}
                        {selected.newCoverArt && selected.newCoverArt !== "remove" && (
                          <span className="text-xs text-violet-400">変更予定</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="mb-5">
                <label className="block text-xs text-zinc-400 mb-1">ファイル名</label>
                <input
                  type="text"
                  value={selected.newFileName}
                  onChange={(e) => onUpdateFileName(selectedIndex, e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100 font-mono focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
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

        {/* Player bar */}
        <div className="border-t border-zinc-800 px-4 py-3 flex items-center gap-4 bg-zinc-950">
          <button
            onClick={() => playingIndex !== null && handlePlay(playingIndex)}
            disabled={playingIndex === null}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-violet-700 hover:bg-violet-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="white" className="w-3.5 h-3.5">
                <rect x="3" y="2" width="3.5" height="12" rx="1" />
                <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="white" className="w-3.5 h-3.5">
                <path d="M3 2.5l10 5.5-10 5.5V2.5z" />
              </svg>
            )}
          </button>

          <div className="flex-1 min-w-0">
            {playingTrack ? (
              <p className="text-xs text-zinc-300 truncate mb-1.5">
                <span className="text-violet-400">{playingTrack.metadata.title || (playingTrack.relPath.includes("/") ? playingTrack.relPath.substring(playingTrack.relPath.lastIndexOf("/") + 1) : playingTrack.relPath)}</span>
                {playingTrack.metadata.artist && <span className="text-zinc-500"> — {playingTrack.metadata.artist}</span>}
              </p>
            ) : (
              <p className="text-xs text-zinc-600 mb-1.5">再生停止中</p>
            )}
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              disabled={!playingTrack}
              className="w-full h-1 accent-violet-500 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            />
          </div>

          <span className="text-xs text-zinc-500 tabular-nums flex-shrink-0">
            {formatTime(currentTime)}{duration > 0 ? ` / ${formatTime(duration)}` : ""}
          </span>

          <div className="flex items-center gap-2 flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0">
              {volume === 0 ? (
                <path d="M8 2.5L4.5 6H2a.5.5 0 00-.5.5v3A.5.5 0 002 10h2.5L8 13.5V2.5zM11.5 5.5l-1 1M13.5 3.5l-1 1M11.5 10.5l-1-1M13.5 12.5l-1-1" />
              ) : volume < 0.5 ? (
                <path d="M8 2.5L4.5 6H2a.5.5 0 00-.5.5v3A.5.5 0 002 10h2.5L8 13.5V2.5zM10.5 5.5a3 3 0 010 5" />
              ) : (
                <path d="M8 2.5L4.5 6H2a.5.5 0 00-.5.5v3A.5.5 0 002 10h2.5L8 13.5V2.5zM10.5 5.5a3 3 0 010 5M12.5 3.5a6 6 0 010 9" />
              )}
            </svg>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={handleVolume}
              className="w-20 h-1 accent-violet-500 cursor-pointer"
              title={`音量: ${Math.round(volume * 100)}%`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
