"use client";

import Header from "@/components/Header";
import DirectoryView, { useFolderViewer } from "@/components/DirectoryView";
import DiffView, { useDiffViewer } from "@/components/DiffView";
import AudioConv, { useAudioConverter } from "@/components/AudioConv";

export default function Home() {
  const folderViewer = useFolderViewer();
  const diffViewer = useDiffViewer();
  const audioConverter = useAudioConverter();

  const busy = folderViewer.loading || diffViewer.loading || audioConverter.isConverting;

  function handleSelectFolder() {
    diffViewer.clear();
    audioConverter.clear();
    folderViewer.selectFolder();
  }

  function handleSelectAndDiff() {
    folderViewer.clear();
    audioConverter.clear();
    diffViewer.selectAndDiff();
  }

  function handleConvertAudio() {
    folderViewer.clear();
    diffViewer.clear();
    audioConverter.convertAudio();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center pt-24 pb-16 px-6">
      <Header />

      <div className="flex gap-4 mb-10 flex-wrap justify-center">
        <button
          onClick={handleSelectFolder}
          disabled={busy}
          className="px-6 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium transition-colors"
        >
          {folderViewer.loading ? "Loading..." : "フォルダを選択"}
        </button>
        <button
          onClick={handleSelectAndDiff}
          disabled={busy}
          className="px-6 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium transition-colors"
        >
          {diffViewer.loading ? "Loading..." : "差分を比較"}
        </button>
        <button
          onClick={handleConvertAudio}
          disabled={busy}
          className="px-6 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium transition-colors"
        >
          {audioConverter.isConverting ? "Loading..." : "音源を変換"}
        </button>
      </div>

      {audioConverter.convertState && (
        <AudioConv state={audioConverter.convertState} />
      )}

      {folderViewer.result && !folderViewer.loading && (
        <DirectoryView
          result={folderViewer.result}
          deletingHidden={folderViewer.deletingHidden}
          onDeleteHidden={folderViewer.deleteHiddenFiles}
        />
      )}

      {diffViewer.result && !diffViewer.loading && (
        <DiffView result={diffViewer.result} />
      )}
    </div>
  );
}
