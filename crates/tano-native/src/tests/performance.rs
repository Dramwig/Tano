//! Opt-in benchmark of real filesystem scans and SQLite search, never user data.
use crate::{search, storage};
use serde_json::json;
use std::{fs, time::Instant};

#[test]
#[ignore = "opt-in filesystem/search performance benchmark"]
fn large_workspace_scan_and_search() {
    let directory = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(directory.path()).unwrap();
    let cache_directory = tempfile::tempdir().unwrap();
    let cache = cache_directory.path().join("index.sqlite");
    let count = std::env::var("TANO_BENCH_FILES")
        .ok()
        .map(|value| {
            value
                .parse::<usize>()
                .expect("TANO_BENCH_FILES must be an integer")
        })
        .unwrap_or(5_000);
    assert!((100..=20_000).contains(&count));
    let filler = "人与 Agent，在同一页工作。 Ordinary Markdown remains canonical.\n".repeat(28);
    let start = Instant::now();
    let mut bytes = 0;
    for index in 0..count {
        let content = format!("# Note {index}\n\nUniqueMarker{index:06}\n\n{filler}");
        bytes += content.len();
        fs::write(root.join(format!("note-{index:06}.md")), content).unwrap();
    }
    let fixture_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let initial = storage::scan(&root, "benchmark", &cache).unwrap();
    let initial_scan_ms = start.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(initial.files.len(), count);
    let mut unchanged_scan_ms = Vec::new();
    let mut unchanged_content_reads = Vec::new();
    storage::take_scan_content_reads();
    for _ in 0..5 {
        let start = Instant::now();
        let scanned = storage::scan(&root, "benchmark", &cache).unwrap();
        unchanged_scan_ms.push(start.elapsed().as_secs_f64() * 1000.0);
        unchanged_content_reads.push(storage::take_scan_content_reads());
        assert_eq!(scanned.files.len(), count);
        assert_eq!(scanned.files[0].id, initial.files[0].id);
    }
    let start = Instant::now();
    storage::scan_without_content_cache(&root, "benchmark", &cache).unwrap();
    let uncached_scan_ms = start.elapsed().as_secs_f64() * 1000.0;
    let uncached_content_reads = storage::take_scan_content_reads();
    let mut queries = Vec::new();
    for (needle, expected) in [
        ("UniqueMarker000042", 1),
        ("同一页工作", 80),
        ("同页", 0),
        ("工作", 80),
        ("nonexistent-marker", 0),
    ] {
        let mut samples = Vec::new();
        for _ in 0..20 {
            let start = Instant::now();
            let result = search::query(&cache, "benchmark", needle).unwrap();
            samples.push(start.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(result.len(), expected, "query {needle}");
        }
        samples.sort_by(f64::total_cmp);
        queries.push(json!({"query": needle, "hits": expected, "samples": samples.len(), "p50Ms": samples[9], "p95Ms": samples[18], "maxMs": samples[19]}));
    }
    let renamed_id = initial
        .files
        .iter()
        .find(|file| file.path == "note-000042.md")
        .unwrap()
        .id
        .clone();
    fs::rename(root.join("note-000042.md"), root.join("renamed.md")).unwrap();
    fs::write(
        root.join("renamed.md"),
        "# Renamed\n\n独立增量修改 IncrementalMarker",
    )
    .unwrap();
    fs::remove_file(root.join("note-000043.md")).unwrap();
    let start = Instant::now();
    let changed = storage::scan(&root, "benchmark", &cache).unwrap();
    let incremental_scan_ms = start.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(changed.files.len(), count - 1);
    let hits = search::query(&cache, "benchmark", "IncrementalMarker").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, renamed_id);
    assert!(search::query(&cache, "benchmark", "UniqueMarker000042")
        .unwrap()
        .is_empty());
    assert!(search::query(&cache, "benchmark", "UniqueMarker000043")
        .unwrap()
        .is_empty());
    assert!(search::query(&cache, "other-workspace", "工作")
        .unwrap()
        .is_empty());
    println!(
        "TANO_BENCHMARK {}",
        json!({"files":count,"contentBytes":bytes,"fixtureMs":fixture_ms,"initialScanMs":initial_scan_ms,"unchangedScanMs":unchanged_scan_ms,"unchangedContentReads":unchanged_content_reads,"uncachedScanMs":uncached_scan_ms,"uncachedContentReads":uncached_content_reads,"incrementalScanMs":incremental_scan_ms,"queries":queries,"correctness":"stable UUID; rename+edit+delete index; workspace isolation"})
    );
}
