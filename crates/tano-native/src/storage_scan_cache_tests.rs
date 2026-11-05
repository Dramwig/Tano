use super::*;

#[test]
fn batched_states_match_individual_queries_including_missing_files() {
    let root = tempfile::tempdir().unwrap();
    let paths: Vec<String> = (0..1_024).map(|index| format!("note-{index}.md")).collect();
    for path in paths.iter().take(1_023) {
        fs::write(root.path().join(path), path).unwrap();
    }
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    let states = scan_cache::states(root.path(), &refs).unwrap();
    assert_eq!(states.len(), paths.len());
    for path in &paths {
        let expected = scan_cache::state(&root.path().join(path));
        assert_eq!(states[path].key, expected.key);
        assert_eq!(states[path].stamp, expected.stamp);
    }
    assert!(scan_cache::states(root.path(), &[]).unwrap().is_empty());
}

#[test]
fn large_scan_keeps_identity_and_detects_edits_after_parallel_state_reads() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let db = cache.path().join("index.sqlite");
    let id = workspace_identity(root.path()).unwrap();
    for index in 0..600 {
        fs::write(
            root.path().join(format!("note-{index}.md")),
            format!("before {index}"),
        )
        .unwrap();
    }
    let first = scan(root.path(), &id, &db).unwrap();
    scan_cache::take_content_reads();
    let repeated = scan(root.path(), &id, &db).unwrap();
    assert_eq!(scan_cache::take_content_reads(), 0);
    assert_eq!(
        serde_json::to_value(&first).unwrap(),
        serde_json::to_value(&repeated).unwrap()
    );
    let path = root.path().join("note-0.md");
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    fs::write(&path, "after! 0").unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    fs::rename(
        root.path().join("note-1.md"),
        root.path().join("renamed.md"),
    )
    .unwrap();
    fs::remove_file(root.path().join("note-2.md")).unwrap();
    let changed = scan(root.path(), &id, &db).unwrap();
    let original_id = |path| {
        first
            .files
            .iter()
            .find(|file| file.path == path)
            .unwrap()
            .id
            .clone()
    };
    let edited = changed
        .files
        .iter()
        .find(|file| file.path == "note-0.md")
        .unwrap();
    assert_eq!(edited.id, original_id("note-0.md"));
    assert_eq!(edited.content_hash, Some(hash(b"after! 0")));
    assert_eq!(
        changed
            .files
            .iter()
            .find(|file| file.path == "renamed.md")
            .unwrap()
            .id,
        original_id("note-1.md")
    );
    assert!(!changed.files.iter().any(|file| file.path == "note-2.md"));
    assert_eq!(crate::search::query(&db, &id, "after!").unwrap().len(), 1);
    assert!(matches!(
        write(&path, "local", &hash(b"before 0")).unwrap(),
        WriteResult::Conflict { .. }
    ));
}

#[test]
fn unchanged_scans_skip_content_reads_but_preserved_mtime_edits_are_seen() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let db = cache.path().join("index.sqlite");
    let id = workspace_identity(root.path()).unwrap();
    let path = root.path().join("note.md");
    fs::write(&path, "before").unwrap();
    fs::write(root.path().join("image.bin"), b"image1").unwrap();
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    scan_cache::take_content_reads();
    let first = scan(root.path(), &id, &db).unwrap();
    assert_eq!(scan_cache::take_content_reads(), 2);
    let repeated = scan(root.path(), &id, &db).unwrap();
    assert_eq!(scan_cache::take_content_reads(), 0);
    assert_eq!(
        serde_json::to_value(&first).unwrap(),
        serde_json::to_value(&repeated).unwrap()
    );

    fs::write(&path, "after!").unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    let changed = scan(root.path(), &id, &db).unwrap();
    assert_eq!(scan_cache::take_content_reads(), 1);
    let entry = changed
        .files
        .iter()
        .find(|file| file.path == "note.md")
        .unwrap();
    assert_eq!(entry.content_hash, Some(hash(b"after!")));
    assert_eq!(
        entry.id,
        first
            .files
            .iter()
            .find(|file| file.path == "note.md")
            .unwrap()
            .id
    );
    assert!(crate::search::query(&db, &id, "before").unwrap().is_empty());
    assert_eq!(crate::search::query(&db, &id, "after!").unwrap().len(), 1);
    assert!(matches!(
        write(&path, "local edit", &hash(b"before")).unwrap(),
        WriteResult::Conflict { .. }
    ));

    let image = root.path().join("image.bin");
    let modified = fs::metadata(&image).unwrap().modified().unwrap();
    fs::write(&image, b"image2").unwrap();
    fs::File::options()
        .write(true)
        .open(&image)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    let changed = scan(root.path(), &id, &db).unwrap();
    assert_eq!(scan_cache::take_content_reads(), 1);
    assert_eq!(
        changed
            .files
            .iter()
            .find(|file| file.path == "image.bin")
            .unwrap()
            .content_hash,
        Some(hash(b"image2"))
    );
}

#[test]
fn cache_rebuild_renames_and_deletion_do_not_leave_stale_search_or_fingerprints() {
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let db = cache.path().join("index.sqlite");
    let id = workspace_identity(root.path()).unwrap();
    fs::write(root.path().join("first.md"), "search marker").unwrap();
    let first = scan(root.path(), &id, &db).unwrap();
    let connection = database(&db).unwrap();
    connection
        .execute_batch("DELETE FROM search_documents; DELETE FROM document_fts;")
        .unwrap();
    scan(root.path(), &id, &db).unwrap();
    assert_eq!(crate::search::query(&db, &id, "marker").unwrap().len(), 1);
    fs::rename(root.path().join("first.md"), root.path().join("renamed.md")).unwrap();
    let renamed = scan(root.path(), &id, &db).unwrap();
    assert_eq!(renamed.files[0].id, first.files[0].id);
    assert_eq!(
        crate::search::query(&db, &id, "marker").unwrap()[0].path,
        "renamed.md"
    );
    let rebuilt = scan(root.path(), &id, &cache.path().join("rebuilt.sqlite")).unwrap();
    assert_eq!(rebuilt.files[0].id, first.files[0].id);
    fs::remove_file(root.path().join("renamed.md")).unwrap();
    scan(root.path(), &id, &db).unwrap();
    assert!(crate::search::query(&db, &id, "marker").unwrap().is_empty());
    let fingerprints: i64 = connection
        .query_row("SELECT count(*) FROM scan_fingerprints", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(fingerprints, 0);
}

#[cfg(windows)]
#[test]
fn an_open_writer_disables_timestamp_reuse_until_it_closes() {
    use std::io::{Seek, SeekFrom};
    let root = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let db = cache.path().join("index.sqlite");
    let path = root.path().join("note.md");
    fs::write(&path, "before").unwrap();
    scan(root.path(), "test", &db).unwrap();
    let mut writer = fs::File::options().write(true).open(&path).unwrap();
    writer.seek(SeekFrom::Start(0)).unwrap();
    writer.write_all(b"after!").unwrap();
    writer.flush().unwrap();
    assert!(scan_cache::state(&path).stamp.is_empty());
    // Exercise the worker path while a writer keeps its timestamp unpublished.
    let mut paths: Vec<String> = (0..1_024)
        .map(|index| format!("missing-{index}.md"))
        .collect();
    paths.push("note.md".into());
    let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
    assert!(scan_cache::states(root.path(), &refs).unwrap()["note.md"]
        .stamp
        .is_empty());
    let changed = scan(root.path(), "test", &db).unwrap();
    assert_eq!(changed.files[0].content_hash, Some(hash(b"after!")));
    drop(writer);
    scan(root.path(), "test", &db).unwrap();
    scan_cache::take_content_reads();
    scan(root.path(), "test", &db).unwrap();
    assert_eq!(scan_cache::take_content_reads(), 0);
}
