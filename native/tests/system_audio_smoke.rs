//! Hardware smoke test for native system-audio (WASAPI loopback) capture.
//!
//! Ignored by default: it opens the real default render endpoint, which a
//! headless CI runner may not have. Run it manually on a machine with an active
//! audio output device:
//!
//! ```sh
//! cargo test --test system_audio_smoke -- --ignored
//! ```

#![cfg(windows)]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use local_dictation_sidecar::protocol::PCM_BYTES_PER_FRAME;
use local_dictation_sidecar::system_audio::SystemAudioController;

#[test]
#[ignore = "requires an active audio output device; run with --ignored"]
fn opens_default_loopback_and_emits_well_formed_frames() {
    let frame_count = Arc::new(AtomicUsize::new(0));
    let bad_frame = Arc::new(AtomicUsize::new(0));

    let mut controller = SystemAudioController::new();
    {
        let frame_count = Arc::clone(&frame_count);
        let bad_frame = Arc::clone(&bad_frame);
        controller.set_sink(Arc::new(move |frame| {
            frame_count.fetch_add(1, Ordering::Relaxed);
            if frame.frame_bytes.len() != PCM_BYTES_PER_FRAME {
                bad_frame.fetch_add(1, Ordering::Relaxed);
            }
        }));
    }

    controller
        .start("smoke".to_string())
        .expect("default render endpoint should open in loopback mode");

    // Give the capture loop time to run. Play audio during this window to see
    // a non-zero frame count; with silence the device still opens and runs.
    std::thread::sleep(Duration::from_millis(500));
    controller.stop("smoke");

    assert_eq!(
        bad_frame.load(Ordering::Relaxed),
        0,
        "every emitted frame must be exactly {PCM_BYTES_PER_FRAME} bytes"
    );
    eprintln!(
        "system-audio smoke: captured {} frames",
        frame_count.load(Ordering::Relaxed)
    );
}
