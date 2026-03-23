export type HiddenEntry = { parent: FileSystemDirectoryHandle; name: string };

export type TreeNode = {
  name: string;
  kind: "file" | "directory";
  path: string;
  children: TreeNode[];
};

export type AudioFileEntry = {
  relPath: string;
  fileHandle: FileSystemFileHandle;
};

export type ConvertState = {
  status: "loading-ffmpeg" | "scanning" | "converting" | "done" | "error";
  current: number;
  total: number;
  currentFile: string;
  errors: string[];
};

export const AUDIO_FORMATS = /\.(flac|wav|aiff|aif|wma|ogg|m4a|opus|aac|alac|ape|dsf|dff)$/i;

export async function buildTree(dir: FileSystemDirectoryHandle, dirPath = "") {
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

export async function collectAudioFiles(
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

export async function getOrCreateDir(
  root: FileSystemDirectoryHandle,
  pathParts: string[]
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of pathParts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}
