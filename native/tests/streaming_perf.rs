//! Adapter-level streaming performance harness (Moonshine). `#[ignore]`d: needs
//! a model download + real inference. Run:
//! cargo test --manifest-path native/Cargo.toml --test streaming_perf -- --ignored --nocapture

mod common;

use common::model::{MoonshineTier, require_moonshine_model};

#[test]
#[ignore = "downloads Moonshine assets; run with --ignored"]
fn moonshine_tiny_assets_resolve_with_all_siblings() {
    let frontend = require_moonshine_model(MoonshineTier::Tiny);
    assert_eq!(frontend.file_name().unwrap(), "frontend.ort");
    let dir = frontend.parent().unwrap();
    for sibling in [
        "frontend.ort",
        "encoder.ort",
        "adapter.ort",
        "cross_kv.ort",
        "decoder_kv.ort",
        "streaming_config.json",
        "tokenizer.bin",
    ] {
        assert!(dir.join(sibling).is_file(), "missing {sibling}");
    }
}
