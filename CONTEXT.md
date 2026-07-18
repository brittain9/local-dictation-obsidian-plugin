# Local Dictation

Local Dictation captures audio on-device and can optionally transform completed
transcript text with a configured LLM. This glossary separates LLM destinations
from the policy that chooses between them.

## LLM transformation

**Provider connection**:
A configured LLM destination, including its provider type, selected model, and
any endpoint or credentials it requires.
_Avoid_: Route, backend

**Routing policy**:
The rule that selects a provider connection for an LLM transformation job. A
routing policy does not classify a provider as local or remote.
_Avoid_: Provider mode, Local/Remote/Auto

**Fixed policy**:
A routing policy that sends every LLM transformation job to one provider
connection.
_Avoid_: Local mode, remote mode

**Size-based policy**:
A routing policy that selects one provider connection up to a transcript-size
threshold and another above it.
_Avoid_: Auto mode, fallback

**On-device provider**:
A provider connection whose product integration guarantees that LLM
transformation requests remain on the user's device. Ollama is currently the
only provider with this guarantee.
_Avoid_: Local route

**Transformation payload**:
The transcript text and any optional note or prior-utterance context sent to the
selected provider. Audio is never part of this payload.
