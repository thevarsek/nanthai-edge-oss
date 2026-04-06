type FolderLike = {
  sortOrder?: number | null;
  createdAt?: number | null;
  name?: string | null;
};

export function compareFoldersForDisplay(a: FolderLike, b: FolderLike): number {
  const sortOrderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  if (sortOrderDiff !== 0) {
    return sortOrderDiff;
  }

  const createdAtDiff = (a.createdAt ?? 0) - (b.createdAt ?? 0);
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return (a.name ?? "").localeCompare(b.name ?? "");
}

export function resolveNextFolderSortOrder(folders: FolderLike[]): number {
  return folders.reduce(
    (highest, folder) => Math.max(highest, folder.sortOrder ?? 0),
    -1,
  ) + 1;
}
