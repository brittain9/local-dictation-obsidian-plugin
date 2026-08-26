export function formatBatchUserMessage(noteContext: string, sessionTranscript: string): string {
  return `<note_context>
${noteContext}
</note_context>

<session_transcript>
${sessionTranscript}
</session_transcript>`;
}
