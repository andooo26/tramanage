"use client";

import Header from "@/components/Header";
import DirectoryView, { useFolderViewer } from "@/components/DirectoryView";
import DiffView, { useDiffViewer } from "@/components/DiffView";
import AudioConv, { useAudioConverter } from "@/components/AudioConv";
import MetadataEdit, { useMetadataEditor } from "@/components/MetadataEdit";

export default function Home() {
  const folderViewer = useFolderViewer();
  const diffViewer = useDiffViewer();
  const audioConverter = useAudioConverter();
  const metadataEditor = useMetadataEditor();

  const busy =
    folderViewer.loading ||
    diffViewer.loading ||
    audioConverter.isConverting ||
    metadataEditor.isBusy;

  function handleSelectFolder() {
    diffViewer.clear();
    audioConverter.clear();
    metadataEditor.clear();
    folderViewer.selectFolder();
  }

  function handleSelectAndDiff() {
    folderViewer.clear();
    audioConverter.clear();
    metadataEditor.clear();
    diffViewer.selectAndDiff();
  }

  function handleConvertAudio() {
    folderViewer.clear();
    diffViewer.clear();
    metadataEditor.clear();
    audioConverter.convertAudio();
  }

  function handleEditMetadata() {
    folderViewer.clear();
    diffViewer.clear();
    audioConverter.clear();
    metadataEditor.selectAndLoad();
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
        <button
          onClick={handleEditMetadata}
          disabled={busy}
          className="px-6 py-3 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium transition-colors"
        >
          {metadataEditor.loading ? "Loading..." : "メタデータ編集"}
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
        <DiffView
          result={diffViewer.result}
          copying={diffViewer.copying}
          copyProgress={diffViewer.copyProgress}
          copyDirection={diffViewer.copyDirection}
          onCopyAToB={diffViewer.copyOnlyAToB}
          onCopyBToA={diffViewer.copyOnlyBToA}
        />
      )}

      {metadataEditor.editorState && (
        <MetadataEdit
          editorState={metadataEditor.editorState}
          selectedIndex={metadataEditor.selectedIndex}
          onSelect={metadataEditor.setSelectedIndex}
          onSave={metadataEditor.saveTrack}
          onUpdateMetadata={metadataEditor.updateMetadata}
          onUpdateFileName={metadataEditor.updateFileName}
          onUpdateCoverArt={metadataEditor.updateCoverArt}
        />
      )}
    </div>
  );
}
