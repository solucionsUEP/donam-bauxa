// Text-to-Speech via the Web Speech API (SpeechSynthesis).
// Used to read chatbot replies and artist descriptions aloud.
import { getLang } from "../i18n.js";

const supported =
  typeof window !== "undefined" && "speechSynthesis" in window;

let voices = [];

function loadVoices() {
  if (!supported) return;
  voices = window.speechSynthesis.getVoices() || [];
}

if (supported) {
  loadVoices();
  // Voices populate asynchronously in most browsers.
  window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
}

const LANG_MAP = { ca: "ca-ES", es: "es-ES", en: "en-GB", de: "de-DE" };

export function isTtsSupported() {
  return supported;
}

export function isSpeaking() {
  return supported && window.speechSynthesis.speaking;
}

export function stopSpeaking() {
  if (supported) window.speechSynthesis.cancel();
}

export function speak(text, lang) {
  if (!supported || !text || !text.trim()) return false;
  window.speechSynthesis.cancel();
  const bcp = LANG_MAP[lang || getLang()] || "ca-ES";
  const base = bcp.slice(0, 2);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = bcp;
  utterance.rate = 0.98;
  utterance.pitch = 1;
  const voice =
    voices.find((v) => v.lang === bcp) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(base));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return true;
}
