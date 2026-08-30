const MAX_SPEECH_CHARACTERS = 520;

export function prepareSpeechText(value, { maxCharacters = MAX_SPEECH_CHARACTERS } = {}) {
  if (typeof value !== "string") return "";
  if (!Number.isInteger(maxCharacters) || maxCharacters < 80) {
    throw new RangeError("maxCharacters must be an integer of at least 80.");
  }

  let text = value
    .replace(/```[\s\S]*?```/g, " Code details are in the transcript. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]+/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, "")
    .replace(/\s*\|\s*/g, ", ")
    .replace(/https?:\/\/\S+/gi, "link in the transcript")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(
    /^(?:(?:hey there|sure|absolutely|of course|happy to help)[!.:,;\s-]+)+/i,
    "",
  );

  if (text.length <= maxCharacters) return text;
  const suffix = " The rest is in the transcript.";
  const boundary = Math.max(1, maxCharacters - suffix.length);
  const candidate = text.slice(0, boundary);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("? "),
    candidate.lastIndexOf("! "),
  );
  const wordEnd = candidate.lastIndexOf(" ");
  const cut = sentenceEnd >= boundary * 0.58 ? sentenceEnd + 1 : wordEnd;
  text = candidate.slice(0, Math.max(1, cut)).trimEnd();
  return text + suffix;
}

export function splitSpeechSegments(value, { maxCharacters = 260 } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return [];
  if (!Number.isInteger(maxCharacters) || maxCharacters < 80) {
    throw new RangeError("maxCharacters must be an integer of at least 80.");
  }

  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [text];
  const segments = [];
  let current = "";
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length > maxCharacters) {
      if (current) {
        segments.push(current);
        current = "";
      }
      segments.push(...splitLongSentence(sentence, maxCharacters));
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxCharacters) {
      segments.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) segments.push(current);
  return segments;
}

export function detectSpeechLanguage(value) {
  const text = ` ${String(value ?? "").toLowerCase()} `;
  const indonesianMarkers = [
    " yang ", " dan ", " untuk ", " dengan ", " tidak ", " sudah ",
    " saya ", " kamu ", " ini ", " itu ", " dari ", " akan ", " bisa ",
    " file ", " berkas ", " selesai ", " silakan ", " perangkat ",
  ];
  const score = indonesianMarkers.reduce(
    (total, marker) => total + (text.includes(marker) ? 1 : 0),
    0,
  );
  return score >= 2 ? "id" : "en";
}

function splitLongSentence(sentence, maxCharacters) {
  const words = sentence.split(/\s+/);
  const segments = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharacters && current) {
      segments.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) segments.push(current);
  return segments;
}
