// SQL pieces that decide what a user ($1) may do with a note `n`.
// owner  -> created the note
// editor -> editor share on the note, or owner/editor of the note's workspace
// viewer -> viewer share, or viewer in the note's workspace
const NOTE_ACCESS = `
  CASE
    WHEN n.owner_id = $1 THEN 'owner'
    WHEN EXISTS (SELECT 1 FROM workspace_members wm
                  WHERE wm.workspace_id = n.workspace_id AND wm.user_id = $1
                    AND wm.role IN ('owner', 'editor'))
      OR EXISTS (SELECT 1 FROM note_shares s
                  WHERE s.note_id = n.id AND s.user_id = $1 AND s.role = 'editor')
      THEN 'editor'
    WHEN EXISTS (SELECT 1 FROM workspace_members wm
                  WHERE wm.workspace_id = n.workspace_id AND wm.user_id = $1)
      OR EXISTS (SELECT 1 FROM note_shares s
                  WHERE s.note_id = n.id AND s.user_id = $1)
      THEN 'viewer'
  END`;

// Selects notes the user can see. Deleted notes are only visible to their owner (trash).
const NOTE_SELECT = `
  SELECT * FROM (
    SELECT n.id, n.owner_id, n.folder_id, n.workspace_id, n.title, n.content, n.tags,
           n.pinned, n.version, n.deleted_at, n.created_at, n.updated_at,
           owner.name AS owner_name, editor.name AS updated_by_name, n.updated_by,
           (SELECT count(*) FROM note_shares s WHERE s.note_id = n.id)::int AS share_count,
           ${NOTE_ACCESS} AS access
      FROM notes n
      JOIN users owner ON owner.id = n.owner_id
      LEFT JOIN users editor ON editor.id = n.updated_by
  ) x
  WHERE x.access IS NOT NULL AND (x.deleted_at IS NULL OR x.access = 'owner')`;

function toNote(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    folderId: row.folder_id,
    workspaceId: row.workspace_id,
    title: row.title,
    content: row.content,
    tags: row.tags || [],
    pinned: row.pinned,
    version: row.version,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
    shareCount: row.share_count,
    access: row.access,
  };
}

module.exports = { NOTE_ACCESS, NOTE_SELECT, toNote };
