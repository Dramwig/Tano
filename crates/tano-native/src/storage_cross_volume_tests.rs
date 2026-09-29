use super::*;

#[test]
#[ignore = "requires TANO_SECOND_VOLUME pointing to a different filesystem"]
fn portable_workspace_crosses_real_volumes_without_aliasing_documents() {
    let second_volume = std::env::var_os("TANO_SECOND_VOLUME")
        .expect("set TANO_SECOND_VOLUME to an existing directory on a second filesystem");
    let source_area = tempfile::tempdir().unwrap();
    let target_area = tempfile::Builder::new()
        .prefix("tano-cross-volume-")
        .tempdir_in(second_volume)
        .unwrap();
    let cache_area = tempfile::tempdir().unwrap();
    let cache = cache_area.path().join("index.sqlite");
    let source = fs::canonicalize(source_area.path()).unwrap();
    let target = fs::canonicalize(target_area.path()).unwrap();
    let id = workspace_identity(&source).unwrap();
    let note = "研究 与 Agent/初稿 #1.md";
    let renamed = "新目录/跨卷重命名.md";
    let bytes = "# 同页\n\n跨卷迁移标记，人与 Agent 在同一页。\n";
    let attachment: &[u8] = &[0, 255, 128, 7, 9, 1];
    fs::create_dir_all(source.join("研究 与 Agent")).unwrap();
    fs::create_dir_all(source.join("assets")).unwrap();
    fs::write(source.join(note), bytes).unwrap();
    fs::write(source.join("unique.md"), "unique rename marker").unwrap();
    fs::write(source.join("assets/附件 #1.bin"), attachment).unwrap();
    for path in ["duplicate-a.md", "duplicate-b.md"] {
        fs::write(source.join(path), "identical duplicates").unwrap();
    }
    fs::write(source.join("changed-and-moved.md"), "before move and edit").unwrap();
    let initial = scan(&source, &id, &cache).unwrap();
    let old_ids: HashMap<_, _> = initial
        .files
        .iter()
        .filter(|entry| entry.kind != "directory")
        .map(|entry| (entry.path.clone(), entry.id.clone()))
        .collect();
    let old_key = native_key(&source.join(note));
    assert!(!old_key.is_empty(), "native file identity unavailable");

    // Copy to a fresh directory on the other device, then remove only fixture
    // source files, as a cross-volume move does. The cache stays outside both.
    for (from, to) in [
        (".tano/config.json", ".tano/config.json"),
        (note, note),
        ("unique.md", renamed),
        ("assets/附件 #1.bin", "assets/附件 #1.bin"),
        ("duplicate-a.md", "新目录/duplicate-c.md"),
        ("duplicate-b.md", "新目录/duplicate-d.md"),
        ("changed-and-moved.md", "新目录/changed.md"),
    ] {
        fs::create_dir_all(target.join(to).parent().unwrap()).unwrap();
        fs::copy(source.join(from), target.join(to)).unwrap();
        fs::remove_file(source.join(from)).unwrap();
    }
    let new_key = native_key(&target.join(note));
    assert!(!new_key.is_empty());
    assert_ne!(
        old_key.split(':').next(),
        new_key.split(':').next(),
        "test requires different volume serial/device ids, not just different directories"
    );
    fs::write(
        target.join("新目录/changed.md"),
        "edited during cross-volume rename",
    )
    .unwrap();
    assert_eq!(workspace_identity(&target).unwrap(), id);
    let migrated = scan(&target, &id, &cache).unwrap();
    let new_ids: HashMap<_, _> = migrated
        .files
        .iter()
        .filter(|entry| entry.kind != "directory")
        .map(|entry| (entry.path.clone(), entry.id.clone()))
        .collect();
    assert_eq!(new_ids[note], old_ids[note]);
    assert_eq!(new_ids[renamed], old_ids["unique.md"]);
    assert_eq!(new_ids["assets/附件 #1.bin"], old_ids["assets/附件 #1.bin"]);
    assert_eq!(fs::read(target.join(note)).unwrap(), bytes.as_bytes());
    assert_eq!(
        fs::read(target.join("assets/附件 #1.bin")).unwrap(),
        attachment
    );
    assert_eq!(
        new_ids.values().collect::<HashSet<_>>().len(),
        new_ids.len()
    );
    // No native identity survives this move. Identical old candidates, or a
    // concurrent rename+edit, must receive distinct new UUIDs rather than guessing.
    for path in [
        "新目录/duplicate-c.md",
        "新目录/duplicate-d.md",
        "新目录/changed.md",
    ] {
        assert!(!old_ids.values().any(|old| old == &new_ids[path]));
    }
    let row =
        |path: &str| -> (i64, i64, String) {
            database(&cache).unwrap().query_row(
            "SELECT version,deleted,native_key FROM files WHERE workspace_id=?1 AND path=?2",
            params![id, path], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap()
        };
    assert_eq!(row(note), (1, 0, new_key.clone()));
    assert_eq!(row("unique.md").1, 1);
    assert_eq!(row(renamed).0, 1);
    let hits = crate::search::query(&cache, &id, "unique rename marker").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, old_ids["unique.md"]);
    assert_eq!(hits[0].path, renamed);
    let snapshot = read(&target.join(note)).unwrap();
    let external = format!("{bytes}\n外部修改必须保留。\n");
    fs::write(target.join(note), &external).unwrap();
    assert!(matches!(
        write(&target.join(note), "stale overwrite", &snapshot.hash).unwrap(),
        WriteResult::Conflict { .. }
    ));
    scan(&target, &id, &cache).unwrap();
    assert_eq!(row(note).0, 2);
    assert_eq!(fs::read_to_string(target.join(note)).unwrap(), external);
    let hits = crate::search::query(&cache, &id, "外部修改必须保留").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, old_ids[note]);
    fs::remove_file(target.join(renamed)).unwrap();
    scan(&target, &id, &cache).unwrap();
    assert!(crate::search::query(&cache, &id, "unique rename marker")
        .unwrap()
        .is_empty());
    assert_eq!(row(renamed).1, 1);
    assert_eq!(fs::read_dir(target.join(".tano")).unwrap().count(), 1);
    assert!(!target.join("index.sqlite").exists());
    println!(
        "TANO_CROSS_VOLUME {}",
        serde_json::json!({
            "platform": std::env::consts::OS,
            "sourceNativeKey": old_key, "destinationNativeKey": new_key,
            "workspaceId": id, "samePathDocumentId": old_ids[note],
            "uniqueRenamedDocumentId": old_ids["unique.md"],
            "sourceMarkdownSha256": snapshot.hash,
            "attachmentSha256": hash(attachment),
            "samePathIdentityPreserved": true, "uniqueHashRenamePreserved": true,
            "ambiguousMovesDoNotAlias": true, "renameAndEditDoesNotGuessIdentity": true,
            "externalEditProtected": true, "versionAdvanced": true,
            "searchRenamedUpdatedAndDeleted": true, "workspaceContainsOnlyPortableConfig": true
        })
    );
}
