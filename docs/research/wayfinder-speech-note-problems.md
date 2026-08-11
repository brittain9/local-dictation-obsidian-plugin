# Recurring problems between speech and durable notes

Research for [Find recurring user problems at the boundary of speech and notes](https://github.com/brittain9/speech-kit-obsidian-plugin/issues/402).

## Bottom line

The strongest unmet need is not another way to obtain a transcript. It is a **trustworthy handoff from messy speech to a useful note**: preserve what the person meant, expose what was transformed, carry forward the moments they considered important, and leave a reviewable Markdown artifact.

The evidence supports five recurring problems. The first four are useful within a single recording, transcript, or active note and do not require automatic whole-vault access. The fifth is real but has weaker Obsidian-specific demand evidence.

This is qualitative discovery, not prevalence measurement. Sources are first-party user reports, original project issues/discussions, and official product documentation. Repeated independent reports and visible workarounds are treated as stronger evidence than feature-list convergence alone.

## Ranked problems

### 1. A raw transcript is not a durable note, but automatic cleanup can erase the author's meaning

Spoken thought is nonlinear: people circle a problem, revise themselves, mix topics, and only reach the useful conclusion late. The resulting transcript is hard to scan or reuse. Yet users also distrust cleanup that silently summarizes, shortens, or rewrites their thought.

Evidence:

- An Obsidian user lists the post-transcription work explicitly: separate mixed topics, extract tasks, turn vague thoughts into notes, split a brain dump, choose destinations, and keep the source without cluttering the vault. A respondent's working prompt insists on first-person voice and a distinction between observations, contradictions, implications, and actions. [Original user report and discussion](https://www.reddit.com/r/ObsidianMD/comments/1tb4a58/how_do_you_turn_voice_thoughts_into_actual_notes/)
- Another user describes long voice thoughts as a continuous string that is difficult to parse; commenters use an LLM to add paragraphs and remove fillers, while another reports that ChatGPT keeps shortening the material despite instructions to make only corrections. [Original user report and discussion](https://www.reddit.com/r/ObsidianMD/comments/1ndc0jq/workflows_for_capturing_voice_and_transcribing_to/)
- Plaud's official documentation now offers thousands of context-specific summary templates. This confirms that one generic summary shape does not fit meetings, interviews, study notes, and professional records. [Plaud summary-template documentation](https://support.plaud.ai/hc/en-us/articles/50636128812441-Summary-templates)

Why it ranks first: the problem recurs for writers, knowledge workers, and meeting users; it happens after every substantial recording; and a visible before/review/accept workflow can earn trust without reading unrelated notes.

Boundary: the input can be the current transcript and, optionally, the active note or an explicitly chosen template. Automatic filing across a vault is a separate problem.

### 2. A transcript misses the user's live judgment about what mattered

Audio captures what was said, not why a moment mattered to the note-taker. During a meeting, people mark a decision, type a private concern, capture a visual, or note a question they did not say aloud. A post-hoc transcript or generic summary cannot reliably recover that private layer of salience.

Evidence:

- An Obsidian workflow report describes taking notes while system audio is transcribed, then combining those notes and the transcript into Markdown after the meeting. [Original Obsidian Forum workflow](https://forum.obsidian.md/t/get-meeting-notes-in-your-vault-without-a-plug-in/112447)
- A long-running Obsidian meeting-minutes discussion describes recording meaningful remarks rather than every phrase, capturing screenshots, writing unsaid questions, reorganizing after the meeting, and separately recording personal action items. [Original Obsidian Forum discussion](https://forum.obsidian.md/t/how-do-other-people-take-meeting-minutes-with-obsidian/12237)
- Plaud's official meeting workflow tells users to mark key moments, type short notes, take screenshots for information audio cannot carry, and add highlights at topic boundaries before producing actions and decisions. [Plaud Desktop workflow documentation](https://support.plaud.ai/hc/en-us/articles/58739663514009-Using-Plaud-Desktop-tips-and-FAQ)

Why it ranks second: this is more distinctive than generic summarization and is naturally Obsidian-native. It operates on the recording plus the active note and can improve every meeting without indexing the vault.

Boundary: whole-vault context is unnecessary. The essential inputs are the current recording/transcript and deliberate user marks or text from the same session.

### 3. Meeting follow-through is duplicated across transcript, summary, tasks, and the next meeting

Meeting-heavy users repeatedly extract decisions and actions, copy them into another system, distribute a recap, and then recreate context for the next conversation. The pain is the handoff and source-of-truth problem, not merely the absence of an AI summary.

Evidence:

- One Obsidian user describes preparing from prior actions, documenting discussion, extracting actions separately, copying content into Outlook, managing actions elsewhere, and repeating the process; they call out redundancy and double handling. [Original Obsidian user report](https://www.reddit.com/r/ObsidianMD/comments/1cfmsuy/whats_your_workflow_for_meeting_notes_action_items/)
- An Obsidian Forum user wants one input to create a task while also leaving a linked record in the meeting minutes, but finds that doing both appears to require scripting. [Original Obsidian Forum request](https://forum.obsidian.md/t/creating-action-items/95231)
- Another user wants meeting entries from daily notes to appear in the relevant person's note; the suggested solution depends on templates, links, and Dataview conventions. [Original Obsidian Forum request](https://forum.obsidian.md/t/need-help-with-obsidian-dataview-for-meeting-notes/90648)
- Otter's official product behavior consolidates assigned actions across conversations and links each generated action back to the exact transcript location. This is evidence that mature meeting products treat follow-through and provenance as a combined workflow. [Otter action-item documentation](https://help.otter.ai/hc/en-us/articles/25983095114519-Action-Items-Overview)

Why it ranks third: it is frequent and valuable, but basic summary/action extraction is already crowded. Differentiation would have to come from a reviewable Markdown handoff, explicit ownership/provenance, or continuity that does not require uncontrolled vault mutation.

Boundary: producing structured decisions/actions inside the current note is in bounds. Cross-meeting rollups require access to an explicitly selected folder, tag, or set of notes; automatic whole-vault scanning is not necessary and should not be assumed.

### 4. Derived notes are hard to verify when speaker identity and source moments are lost

The more aggressively a transcript is summarized, the harder it becomes to answer: who actually said this, in what context, and was the derived action accurate? Incorrect diarization makes this especially risky because ownership and disagreement depend on speaker identity.

Evidence:

- A WhisperX user reports nearly flawless transcription and alignment but disastrous speaker recognition on some three-person recordings, including speakers with distinct accents and speakers with similar voices. [Original WhisperX issue](https://github.com/m-bain/whisperX/issues/323)
- Another WhisperX user says speaker labels are crucial to identifying who said what, but the plain-text export omits them. [Original WhisperX issue](https://github.com/m-bain/whisperX/issues/801)
- Otter exposes “View in transcript” for generated actions, while its documentation warns that a summary is not automatically regenerated after transcript or speaker corrections. Both behaviors show why derived output needs an inspectable relationship to its source and corrections. [Otter conversation-page documentation](https://help.otter.ai/hc/en-us/articles/5093228433687-Conversation-Page-Overview)
- Plaud advises reviewing and renaming speaker labels and warns that cross-talk and background noise can merge speakers. [Plaud Desktop workflow documentation](https://support.plaud.ai/hc/en-us/articles/58739663514009-Using-Plaud-Desktop-tips-and-FAQ)

Why it ranks fourth: source-backed notes would be noticeable and trustworthy, but reliable identity is technically harder than linking a derived statement to a timestamped source segment. Treat identity correction and source navigation as related but separable problems.

Boundary: timestamps, audio, transcript segments, and corrected labels all belong to the current recording. No vault-wide context is required.

### 5. Multilingual and code-switched speech does not fit a single up-front language choice

Multilingual users may switch languages within one recording, want the transcript preserved in those languages, and want the durable note in one chosen language. Current pipelines often infer one language from the beginning or conflate transcription, translation, and diarization.

Evidence:

- In an official Whisper discussion, maintainers explain that automatic language detection previews the first 30 seconds and is less reliable than an explicit language choice. That model is a poor fit when the recording itself changes language. [OpenAI Whisper discussion](https://github.com/openai/whisper/discussions/1456)
- A WhisperX user working with mixed Hindi-English speech translates the transcription to English and then cannot tell how to combine it safely with diarization over the original bilingual audio. [Original WhisperX issue](https://github.com/m-bain/whisperX/issues/845)
- Plaud documents that generated notes remain in the recording's original language even when the chosen template is written in another language; changing output language requires changing the recording language. [Plaud summary-template documentation](https://support.plaud.ai/hc/en-us/articles/50636128812441-Summary-templates)

Why it ranks fifth: the pain is consequential and technically interesting, but this research found less direct Obsidian-user evidence than for the first four problems. It deserves a focused prototype or user test before being treated as a flagship bet.

Boundary: language behavior can be resolved within one recording and its output. It does not require note or vault access.

## Implications for portfolio selection

- **Do not count generic “summarize transcript” or “extract action items” as unique.** Otter, Plaud, [Granola](https://help.granola.ai/article/chatting-with-your-meetings), and multiple Obsidian workflows already treat these as standard. The differentiating seam is control, fidelity, provenance, or human-guided salience.
- **Do not make automatic whole-vault filing a prerequisite.** Users want durable Markdown in the right place, but the strongest problems can be addressed with the current recording, active note, explicit destination, or explicitly selected notes.
- **Treat capture friction as real but architecture-sensitive.** Users repeatedly ask for lock-screen, hands-free, no-copy workflows and build multi-app automations to achieve them: [one-action Android/Obsidian request](https://www.reddit.com/r/ObsidianMD/comments/1qp30y7/the_best_voice_notes_workflow/) and [voice-to-Markdown workaround](https://www.reddit.com/r/ObsidianMD/comments/1s7nh7g/voice_notes_to_obsidian_markdown_built_a_workflow/). Because Speech Kit currently targets desktop platforms and pairs the plugin with a native sidecar ([project README](../../README.md#one-toolkit-across-platforms)), mobile capture should be evaluated as its own platform bet rather than smuggled into a note-processing feature.
- **Preserve source material by default.** Across writer and meeting workflows, users want a clean artifact but also need the raw transcript or audio for correction, nuance, and trust.

## Best problem seams to prototype

The research favors prototypes around these questions, in order:

1. Can Speech Kit turn a rambling transcript into a structured note while making every deletion or interpretation reviewable and preserving the author's voice?
2. Can the user's live highlights, typed notes, and source audio become one coherent post-meeting artifact rather than competing records?
3. Can a decision or action in Markdown retain a lightweight, usable pointer to the exact speaker turn and audio moment that supports it?

These are problem-validation prompts, not implementation recommendations. Each can be tested on one recording and one note before choosing a larger product direction.
