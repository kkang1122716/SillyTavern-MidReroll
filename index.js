// Mid Reroll — two ways to redo part of the last AI reply:
//  • continue: keep the text before a cut point, optionally insert the user's own passage and/or a
//    one-shot direction, then let the model write the rest.
//  • replace: pick a passage in the middle, have the model rewrite only that passage, compare
//    before/after and swap it in place.
// Results in another language can be checked with a translation shown only inside the popup.

const MODULE = 'mid_reroll';
const PROMPT_KEY = 'mid_reroll_direction';
const KEY_STORAGE = 'mid_reroll_custom_key';
const LOG = '[MidReroll]';

// extension_prompt_types.IN_CHAT / extension_prompt_roles.SYSTEM (not exposed via getContext)
const IN_CHAT = 1;
const ROLE_SYSTEM = 0;

const ctx = () => SillyTavern.getContext();

// ---------- languages ----------
const DIR_LANGS = [['en', 'English (추천)'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어']];
const DIR_CODE = { en: 'en', zh: 'zh-CN', ja: 'ja', ko: 'ko' };
const TR_LANGS = [['ko', '한국어'], ['en', 'English'], ['ja', '日本語'], ['zh-CN', '中文(简体)']];
const LANG_NAME = { ko: 'Korean', en: 'English', ja: 'Japanese', 'zh-CN': 'Simplified Chinese' };

const PRESET_NAMES = ['더 길게', '대사 많이', '감정 묘사', '천천히', '새 사건', '유저 대필 금지'];
const preset = (texts) => texts.map((text, i) => ({ name: PRESET_NAMES[i], text }));

const DEFAULT_PACKS = Object.freeze({
    en: {
        presets: preset([
            'Make this part longer and more detailed than before.',
            'Give dialogue more weight than narration.',
            'Go deeper into the characters\' emotions and physical sensations.',
            'Slow the pacing down and stay in the current scene longer.',
            'Introduce one unexpected event or twist.',
            'Do not write dialogue, actions, or thoughts for the user\'s character.',
        ]),
        template: '[OOC: For what you write next, follow this direction: {{direction}}. Do not repeat text that is already written.]',
        insertNote: '[OOC: The final passage of the reply being continued was written by the user. Pick up right after it and respond to it naturally. Do not repeat or rewrite it.]',
        rewrite: '[OOC: Rewrite only the marked passage of your last reply. Everything before and after it stays exactly as it is, so the new passage must follow naturally from the text before it and lead smoothly into the text after it. Keep the same language, tone, and formatting.{{#direction}}\nDirection for the rewrite: {{direction}}{{/direction}}\n\nText before the passage:\n<before>{{before}}</before>\n\nPassage to rewrite:\n<passage>{{passage}}</passage>\n\nText after the passage:\n<after>{{after}}</after>\n\nReply with the new passage only, without tags or explanations.]',
    },
    zh: {
        presets: preset([
            '把这一部分写得比现在更长、更详细。',
            '增加对白的比重，减少叙述。',
            '更深入地描写人物的情感和感官体验。',
            '放慢节奏，在当前场景中多停留一会儿。',
            '加入一个意想不到的事件或转折。',
            '不要代替用户的角色写台词、动作或想法。',
        ]),
        template: '[OOC: 接下来的内容请遵循以下指示：{{direction}}。不要重复已经写过的内容。]',
        insertNote: '[OOC: 正在续写的回复中，最后一段是用户亲自写的。请紧接其后自然地做出回应并继续写下去，不要重复或改写那一段。]',
        rewrite: '[OOC: 只重写你上一条回复中标出的部分。它前后的文字会原样保留，所以新写的部分必须自然地承接前文，并顺畅地衔接后文。保持原有的语言、语气和格式。{{#direction}}\n本次重写的指示：{{direction}}{{/direction}}\n\n前文：\n<before>{{before}}</before>\n\n需要重写的部分：\n<passage>{{passage}}</passage>\n\n后文：\n<after>{{after}}</after>\n\n只输出重写后的部分，不要加标签或说明。]',
    },
    ja: {
        presets: preset([
            'この部分を今よりも長く、詳しく書いてください。',
            '地の文よりも台詞の比重を増やしてください。',
            '登場人物の感情と感覚の描写をより深くしてください。',
            '展開をゆっくりにして、今の場面にもっと留まってください。',
            '予想外の出来事やどんでん返しを一つ入れてください。',
            'ユーザーのキャラクターの台詞・行動・思考は代わりに書かないでください。',
        ]),
        template: '[OOC: 次に書く内容は、この指示に従ってください：{{direction}}。すでに書かれた文章は繰り返さないでください。]',
        insertNote: '[OOC: 続きを書いている返答の最後の部分はユーザーが書いたものです。その直後から自然に反応して続けてください。その部分を繰り返したり書き直したりしないでください。]',
        rewrite: '[OOC: 直前の返答のうち、示した部分だけを書き直してください。その前後の文章はそのまま残るので、新しい部分は前の文章から自然につながり、後の文章へ滑らかに続く必要があります。言語・口調・書式は元のままにしてください。{{#direction}}\n今回の書き直しの指示：{{direction}}{{/direction}}\n\n前の文章：\n<before>{{before}}</before>\n\n書き直す部分：\n<passage>{{passage}}</passage>\n\n後の文章：\n<after>{{after}}</after>\n\n書き直した部分だけを出力してください。タグや説明は付けないでください。]',
    },
    ko: {
        presets: preset([
            '이 부분을 지금보다 더 길고 자세하게 써 줘.',
            '서술보다 대사 비중을 늘려 줘.',
            '인물의 감정과 감각 묘사를 더 깊게 해 줘.',
            '전개 속도를 늦추고 지금 장면에 더 머물러 줘.',
            '예상하지 못한 사건이나 반전을 하나 넣어 줘.',
            '유저 캐릭터의 대사, 행동, 생각은 대신 쓰지 마.',
        ]),
        template: '[OOC: 이어서 쓸 내용은 다음 지시를 따라 주세요: {{direction}}. 이미 쓴 내용은 반복하지 마세요.]',
        insertNote: '[OOC: 이어 쓰는 답변의 마지막 부분은 유저가 직접 쓴 내용입니다. 그 바로 뒤부터 자연스럽게 반응하며 이어 쓰고, 그 부분을 반복하거나 고쳐 쓰지 마세요.]',
        rewrite: '[OOC: 직전 답변에서 표시한 부분만 다시 써 주세요. 그 앞과 뒤의 글은 그대로 남으니, 새로 쓴 부분은 앞 글에서 자연스럽게 이어지고 뒤 글로 매끄럽게 넘어가야 해요. 언어, 말투, 서식은 원래대로 유지하세요.{{#direction}}\n이번 수정 지시: {{direction}}{{/direction}}\n\n앞 글:\n<before>{{before}}</before>\n\n다시 쓸 부분:\n<passage>{{passage}}</passage>\n\n뒤 글:\n<after>{{after}}</after>\n\n새로 쓴 부분만 출력하세요. 태그나 설명은 붙이지 마세요.]',
    },
});
const PACK_KEYS = ['presets', 'template', 'insertNote', 'rewrite'];

const DEFAULT_TR_PROMPT =
    'You are a translator. Translate the user\'s text into {{lang}}. Keep every line break so the output has the same number of lines, and keep markup such as * and quotation marks. Output only the translation.';

const defaultSettings = Object.freeze({
    defaultMode: 'continue',  // continue | replace
    cutMode: 'both',          // both | paragraph | select
    insertMode: 'inline',     // inline | separate
    resultMode: 'swipe',      // continue result: swipe | overwrite
    replaceResult: 'overwrite', // replace result: overwrite | swipe
    buttonPlace: 'bar',       // bar | menu | both
    apiMode: 'current',       // current | profile | custom
    profileId: '',
    customUrl: '',
    customModel: '',
    maxTokens: 0,             // 0 = follow ST's current response length
    dirLang: 'en',
    dirAutoTranslate: true,
    packs: DEFAULT_PACKS,
    trEngine: 'google',       // google | ai
    trAiApi: 'current',       // current | profile | custom
    trProfileId: '',
    trCustomModel: '',
    trLang: 'ko',
    trPrompt: DEFAULT_TR_PROMPT,
    trCache: false,
    reviewContinue: 'foreign', // foreign | always | never
    announceAsNew: false,     // after a replace: send "new reply" signals instead of "edited"
    autoTranslateResult: true,
    injectDepth: 0,
    trimOverlap: true,
});

function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = structuredClone(defaultSettings);
    const s = extensionSettings[MODULE];
    // 1.0.x kept one Korean preset list and templates at the top level
    for (const old of ['presets', 'directionTemplate', 'insertNoteTemplate']) delete s[old];
    for (const k of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(s, k)) s[k] = structuredClone(defaultSettings[k]);
    }
    if (typeof s.packs !== 'object' || !s.packs) s.packs = structuredClone(DEFAULT_PACKS);
    for (const lang of Object.keys(DEFAULT_PACKS)) {
        if (typeof s.packs[lang] !== 'object' || !s.packs[lang]) s.packs[lang] = structuredClone(DEFAULT_PACKS[lang]);
        for (const k of PACK_KEYS) {
            if (!Object.hasOwn(s.packs[lang], k)) s.packs[lang][k] = structuredClone(DEFAULT_PACKS[lang][k]);
        }
        if (!Array.isArray(s.packs[lang].presets)) s.packs[lang].presets = structuredClone(DEFAULT_PACKS[lang].presets);
    }
    if (!DIR_CODE[s.dirLang]) s.dirLang = 'en';
    return s;
}
const save = () => ctx().saveSettingsDebounced();
const pack = () => { const s = getSettings(); return s.packs[s.dirLang]; };

function getCustomKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
function setCustomKey(v) {
    try { v ? localStorage.setItem(KEY_STORAGE, v) : localStorage.removeItem(KEY_STORAGE); } catch { /* storage blocked */ }
}

// ---------- small helpers ----------
function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (k === 'value') n.value = v;
        else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
}

function getProfiles() {
    try { return ctx().ConnectionManagerRequestService?.getSupportedProfiles?.() ?? []; } catch { return []; }
}

function isGenerating() {
    const stop = document.getElementById('mes_stop');
    return !!stop && stop.offsetParent !== null;
}

function fmtText(t, msg, mesId) {
    try { return ctx().messageFormatting(t, msg?.name, false, false, mesId); } catch { return el('span', { text: t }).innerHTML; }
}

/** Splits raw message text into non-empty lines with their offsets. */
function splitParas(raw) {
    const out = [];
    const re = /[^\n]+/g;
    let m;
    while ((m = re.exec(raw))) {
        if (m[0].trim()) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
    return out;
}

/** Maps an offset in displayed text back to raw text (raw may contain markup like * or _). */
function mapOffset(raw, shown, target) {
    let i = 0, j = 0;
    while (j < target && i < raw.length) {
        const r = raw[i], d = shown[j];
        if (r === d) { i++; j++; continue; }
        const rs = /\s/.test(r), ds = /\s/.test(d);
        if (rs && ds) { i++; j++; continue; }
        if (ds) { j++; continue; }
        if (rs) { i++; continue; }
        const k = raw.indexOf(d, i);
        if (k < 0 || k - i > 8) { j++; continue; }
        i = k;
    }
    return i;
}

function normWithIndex(s) {
    let out = '';
    const idx = [];
    let prevSpace = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '*' || ch === '_') continue;
        if (/\s/.test(ch)) {
            if (prevSpace) continue;
            prevSpace = true; out += ' '; idx.push(i); continue;
        }
        prevSpace = false; out += ch; idx.push(i);
    }
    return { out, idx };
}

/** Finds a displayed snippet inside raw text, ignoring * _ and whitespace differences. Returns {start,end} or null. */
function findInRaw(raw, needle, last = false) {
    needle = String(needle ?? '');
    const direct = last ? raw.lastIndexOf(needle) : raw.indexOf(needle);
    if (needle && direct >= 0) return { start: direct, end: direct + needle.length };
    const r = normWithIndex(raw), n = normWithIndex(needle.trim());
    if (!n.out) return null;
    const at = last ? r.out.lastIndexOf(n.out) : r.out.indexOf(n.out);
    if (at < 0) return null;
    return { start: r.idx[at], end: r.idx[at + n.out.length - 1] + 1 };
}

function paraSeparator(raw) {
    return /\n[ \t]*\n/.test(raw) ? '\n\n' : '\n';
}

/** Snaps a raw offset back to the start of the word it falls in. */
function snapToWord(raw, i, floor) {
    while (i > floor && !/\s/.test(raw[i - 1])) i--;
    return i;
}
/** Snaps a raw offset forward to the end of the word it falls in. */
function snapToWordEnd(raw, i, ceil) {
    while (i < ceil && !/\s/.test(raw[i])) i++;
    return i;
}

/** {{name}} placeholders plus {{#name}}…{{/name}} blocks shown only when the value is non-empty. */
function fill(tpl, vars) {
    return String(tpl)
        .replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (m, k, inner) => (vars[k] ? inner : ''))
        .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Removes text the model repeated from the kept part. Returns the cleaned continuation (no leading space). */
function trimOverlap(kept, cont) {
    let body = cont.replace(/^\s+/, '');
    const keptTrim = kept.trimEnd();
    for (let k = Math.min(keptTrim.length, body.length, 800); k >= 12; k--) {
        const tail = keptTrim.slice(-k).trimStart();
        if (tail.length >= 12 && body.startsWith(tail)) return body.slice(tail.length).replace(/^\s+/, '');
    }
    const lastLine = keptTrim.slice(keptTrim.lastIndexOf('\n') + 1).trim();
    if (lastLine.length >= 4 && body.startsWith(lastLine)) return body.slice(lastLine.length).replace(/^\s+/, '');
    const head = keptTrim.slice(0, 40);
    if (head.length >= 20 && body.startsWith(head)) {
        const tail40 = keptTrim.slice(-40);
        const at = body.indexOf(tail40);
        if (at >= 0) return body.slice(at + tail40.length).replace(/^\s+/, '');
    }
    return body;
}

/** If the last line has an unclosed * or " (cut mid-sentence), close it. */
function closeOpenMarks(text) {
    const lastLine = text.slice(text.lastIndexOf('\n') + 1);
    let out = text;
    const stars = (lastLine.replace(/\*\*/g, '').match(/\*/g) || []).length;
    const quotes = (lastLine.match(/"/g) || []).length;
    const qAt = lastLine.lastIndexOf('"'), sAt = lastLine.lastIndexOf('*');
    const closers = [];
    if (quotes % 2) closers.push(['"', qAt]);
    if (stars % 2) closers.push(['*', sAt]);
    closers.sort((a, b) => b[1] - a[1]);
    for (const [ch] of closers) out += ch;
    return out;
}

function joinCont(joiner, cont) {
    const body = cont.replace(/^\s+/, '');
    if (!body) return '';
    if (joiner.includes('\n')) return joiner + body;
    if (!joiner) return cont;
    return ' ' + body;
}

// ---------- language detection ----------
function scriptStats(t) {
    const n = (re) => (String(t).match(re) || []).length;
    return { hangul: n(/[가-힣ㄱ-ㆎ]/g), kana: n(/[぀-ヿ]/g), han: n(/[一-鿿]/g), latin: n(/[A-Za-z]/g) };
}
/** Rough check whether a text is already written in the given language code. */
function isLang(text, code) {
    const st = scriptStats(text);
    const total = st.hangul + st.kana + st.han + st.latin;
    if (!total) return true;
    const r = (x) => x / total;
    switch (code) {
        case 'ko': return r(st.hangul) >= 0.3;
        case 'ja': return r(st.kana) >= 0.08 && r(st.hangul) < 0.05;
        case 'zh': case 'zh-CN': return r(st.han) >= 0.5 && r(st.kana) < 0.03 && r(st.hangul) < 0.05;
        case 'en': return r(st.latin) >= 0.8;
        default: return false;
    }
}

// ---------- translation ----------
// Only the text itself is sent (no chat history, no character data).
const trMemo = new Map();

async function translate(text, to) {
    text = String(text ?? '');
    if (!text.trim()) return text;
    const s = getSettings();
    const key = `${s.trEngine}|${s.trEngine === 'ai' ? s.trAiApi : ''}|${to}|${text}`;
    if (s.trCache && trMemo.has(key)) return trMemo.get(key);
    let out = s.trEngine === 'ai' ? await translateAi(text, to) : await translateGoogle(text, to);
    out = String(out ?? '').replace(/^\s+|\s+$/g, '');
    if (!out) throw new Error('번역 결과가 비어 있어요.');
    if (s.trCache) {
        trMemo.set(key, out);
        if (trMemo.size > 300) trMemo.delete(trMemo.keys().next().value);
    } else {
        trMemo.clear();
    }
    return out;
}

async function translateGoogle(text, to) {
    const res = await fetch('/api/translate/google', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({ text, lang: to }),
    });
    if (!res.ok) throw new Error(`구글 번역에 실패했어요 (${res.status}).`);
    return res.text();
}

async function translateAi(text, to) {
    const c = ctx();
    const s = getSettings();
    const sys = fill(s.trPrompt, { lang: LANG_NAME[to] ?? to });
    const maxTokens = Math.min(8000, Math.max(600, Math.ceil(text.length * 2)));
    const messages = [{ role: 'system', content: sys }, { role: 'user', content: text }];
    if (s.trAiApi === 'profile') {
        return readResult(await profileCall(s.trProfileId, messages, maxTokens, { includePreset: false }));
    }
    if (s.trAiApi === 'custom') {
        return readResult(await customCall(messages, maxTokens, { model: s.trCustomModel || s.customModel }));
    }
    return c.generateRaw({ prompt: text, systemPrompt: sys, responseLength: maxTokens });
}

/** Translates a list of paragraphs, keeping them aligned one-to-one. */
async function translateParas(texts, to) {
    try {
        const lines = (await translate(texts.join('\n'), to)).split('\n').map((x) => x.trim()).filter(Boolean);
        if (lines.length === texts.length) return lines;
    } catch (e) {
        if (texts.length === 1) throw e;
        console.warn(LOG, 'joined translation failed, going one by one', e);
    }
    const out = new Array(texts.length);
    let next = 0;
    const worker = async () => {
        while (next < texts.length) {
            const i = next++;
            out[i] = await translate(texts[i], to);
        }
    };
    await Promise.all([worker(), worker(), worker()]);
    return out;
}

/** Translation another extension already put on screen (extra.display_text), split like the raw text. */
function displayParas(msg) {
    const d = msg?.extra?.display_text;
    if (!d) return null;
    const clean = String(d).replace(/\n*<div class="(?:custom-)?ip-cb (?:custom-)?ip-cb-\d+"><\/div>\n\n/g, '\n');
    return splitParas(clean).map((p) => p.text);
}

/** Removes an on-screen translation so a changed message is not shown with its old translation. */
function dropDisplay(extra) {
    if (!extra) return false;
    const had = !!extra.display_text;
    for (const k of ['display_text', 'reasoning_display_text', 'interpres_original', 'interpres_src', 'interpres_code']) delete extra[k];
    return had;
}

function announceEdit(mesId) {
    const c = ctx();
    // Same signals ST sends after an edit — translators/memory extensions pick the new text up from here
    Promise.resolve()
        .then(() => c.eventSource.emit(c.eventTypes.MESSAGE_EDITED, mesId))
        .then(() => c.eventSource.emit(c.eventTypes.MESSAGE_UPDATED, mesId))
        .catch((e) => console.warn(LOG, 'edit event failed', e));
}

/**
 * Opt-in: tell other extensions this is a freshly generated reply (like ST does after a generation), so
 * features that only run on new replies (per-turn checks, state trackers, auto-play) run again.
 * MESSAGE_EDITED is left out on purpose: extensions that handle both would process the reply twice.
 */
function announceNew(mesId, type) {
    const c = ctx();
    Promise.resolve()
        .then(() => c.eventSource.emit(c.eventTypes.MESSAGE_RECEIVED, mesId, type))
        .then(() => c.eventSource.emit(c.eventTypes.CHARACTER_MESSAGE_RENDERED, mesId, type))
        .then(() => c.eventSource.emit(c.eventTypes.MESSAGE_UPDATED, mesId))
        .catch((e) => console.warn(LOG, 'new-reply event failed', e));
}

/** Which signal to send after the extension itself changed or produced a reply. */
function announceResult(mesId, type) {
    if (getSettings().announceAsNew) announceNew(mesId, type);
    else announceEdit(mesId);
}

// ---------- chat selection tracking (for "drag in chat, then press the button") ----------
let lastChatSelection = null;
function trackChatSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode) return;
    const anchorEl = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const mesText = anchorEl?.closest?.('#chat .mes .mes_text');
    if (!mesText) return;
    const mesId = Number(mesText.closest('.mes')?.getAttribute('mesid'));
    const range = sel.getRangeAt(0);
    const head = document.createRange();
    head.setStart(range.startContainer, range.startOffset);
    head.setEnd(mesText, mesText.childNodes.length);
    const tail = document.createRange();
    tail.setStart(mesText, 0);
    try { tail.setEnd(range.endContainer, range.endOffset); } catch { tail.setEnd(mesText, mesText.childNodes.length); }
    const startText = head.toString().slice(0, 40);
    const endText = mesText.contains(range.endContainer) ? tail.toString().slice(-40) : '';
    if (Number.isFinite(mesId) && startText.trim()) lastChatSelection = { mesId, startText, endText, at: Date.now() };
}

/** Maps a chat selection onto raw offsets. Falls back to paragraph matching when the chat shows a translation. */
function mapChatSelection(msg, raw, paras, sel) {
    const start = findInRaw(raw, sel.startText);
    if (start) {
        const end = sel.endText ? findInRaw(raw.slice(start.start), sel.endText, true) : null;
        return { a: snapToWord(raw, start.start, 0), b: end ? start.start + end.end : null, approx: false };
    }
    const dps = displayParas(msg);
    if (!dps?.length) return null;
    const key = (t) => normWithIndex(String(t).replace(/["“”「」『』]/g, '')).out.trim();
    const findPara = (snippet, fromEnd) => {
        const lines = String(snippet).split('\n').map(key).filter(Boolean);
        const k = (fromEnd ? lines[lines.length - 1]?.slice(-15) : lines[0]?.slice(0, 15)) ?? '';
        if (!k) return -1;
        return dps.findIndex((p) => key(p).includes(k));
    };
    const toRaw = (i) => (dps.length === paras.length ? i : Math.round(i * (paras.length - 1) / Math.max(1, dps.length - 1)));
    const si = findPara(sel.startText, false);
    if (si < 0) return null;
    const ei = sel.endText ? findPara(sel.endText, true) : -1;
    const pa = paras[Math.min(paras.length - 1, toRaw(si))];
    const pb = ei >= si ? paras[Math.min(paras.length - 1, toRaw(ei))] : null;
    return { a: pa.start, b: pb ? pb.end : null, approx: true };
}

// ---------- remember the last run so "same spot, try again" is one click ----------
let lastRun = null; // { chatId, mesId, mode, kept?, a?, b?, text?, insert, direction }

// ---------- segmented toggle ----------
function seg(options, get, set) {
    const wrap = el('div', { class: 'mr-seg' });
    const draw = () => {
        wrap.replaceChildren(...options.map(([v, label]) => el('button', {
            type: 'button',
            class: `mr-seg-btn${get() === v ? ' active' : ''}`,
            text: label,
            onclick: () => { set(v); draw(); },
        })));
    };
    draw();
    return wrap;
}

// ---------- main popup ----------
async function openPopup(mesId) {
    const c = ctx();
    const s = getSettings();
    const chat = c.chat;
    if (busy) return toastr.warning('이미 다시 쓰는 중이에요.');
    if (isGenerating()) return toastr.warning('생성이 끝난 뒤에 써 주세요.');
    if (!Number.isInteger(mesId) || !chat[mesId]) return toastr.warning('메시지를 찾지 못했어요.');
    const msg = chat[mesId];
    if (msg.is_user || msg.is_system) return toastr.warning('AI 답변에서만 쓸 수 있어요.');
    if (mesId !== chat.length - 1) return toastr.warning('마지막 AI 답변에서만 쓸 수 있어요.');

    const raw = String(msg.mes ?? '');
    const paras = splitParas(raw);
    if (!paras.length) return toastr.warning('빈 메시지예요.');

    const state = {
        mode: s.defaultMode === 'replace' ? 'replace' : 'continue',
        a: null,              // continue: cut point / replace: range start
        b: null,              // replace: range end
        insertMode: s.insertMode,
        resultMode: s.resultMode,
        replaceResult: s.replaceResult,
        showTr: false,
        tr: null,             // translated paragraphs
    };
    const paraOf = (i) => paras.find((p) => i >= p.start && i < p.end) ?? paras.find((p) => p.start >= i) ?? paras[paras.length - 1];

    // Preselect: text dragged in the chat → else the last run on this message
    let approxNote = '';
    const selRecent = lastChatSelection && lastChatSelection.mesId === mesId && Date.now() - lastChatSelection.at < 60000;
    if (selRecent) {
        const m = mapChatSelection(msg, raw, paras, lastChatSelection);
        if (m) {
            state.a = s.cutMode === 'paragraph' ? paraOf(m.a).start : m.a;
            if (m.b != null && m.b > m.a) state.b = s.cutMode === 'paragraph' ? paraOf(m.b - 1).end : snapToWordEnd(raw, m.b, raw.length);
            if (m.approx) approxNote = '채팅에 번역문이 보이고 있어서, 고른 위치를 문단 단위로 맞췄어요.';
        }
    }
    const same = lastRun && lastRun.chatId === c.chatId && lastRun.mesId === mesId ? lastRun : null;
    const sameContinue = same?.mode === 'continue' && raw.startsWith(same.kept) && same.kept.length < raw.length;
    const sameReplace = same?.mode === 'replace' && raw.slice(same.a, same.b) === same.text;
    if (state.a == null && sameContinue) { state.mode = 'continue'; state.a = same.kept.length; }
    if (state.a == null && sameReplace) { state.mode = 'replace'; state.a = same.a; state.b = same.b; }
    lastChatSelection = null;

    // ----- build UI -----
    const textBox = el('div', { class: 'mr-text' });
    const hint = el('div', { class: 'mr-hint' });
    const status = el('div', { class: 'mr-status' });
    const pickLabel = el('div', { class: 'mr-label' });

    const insertArea = el('textarea', { class: 'text_pole mr-insert', rows: 3, placeholder: '비워 두면 끼워넣지 않아요.' });
    const dirArea = el('textarea', { class: 'text_pole mr-dir', rows: 3 });
    if (same) {
        insertArea.value = same.insert ?? '';
        dirArea.value = same.direction ?? '';
    }

    const trBtn = el('button', { type: 'button', class: 'mr-chip mr-tr-btn', title: '이 창에서만 번역해서 보여줘요' },
        el('i', { class: 'fa-solid fa-language' }), el('span', { text: ' 번역 같이 보기' }));
    trBtn.addEventListener('click', async () => {
        if (state.showTr) { state.showTr = false; trBtn.classList.remove('active'); render(); return; }
        if (!state.tr) {
            const shown = displayParas(msg);
            if (shown && shown.length === paras.length && !paras.every((p, i) => p.text === shown[i])) {
                state.tr = shown;
            } else {
                trBtn.disabled = true;
                status.textContent = '번역하는 중…';
                try {
                    state.tr = await translateParas(paras.map((p) => p.text), s.trLang);
                } catch (e) {
                    console.error(LOG, e);
                    toastr.error(String(e?.message || e), '번역 실패');
                    trBtn.disabled = false;
                    render();
                    return;
                }
                trBtn.disabled = false;
            }
        }
        state.showTr = true;
        trBtn.classList.add('active');
        render();
    });

    const modeSeg = seg([['continue', '✂ 여기서부터 다시 쓰기'], ['replace', '🔁 부분만 갈아끼우기']],
        () => state.mode, (v) => {
            state.mode = v;
            if (v === 'replace' && state.a != null && (state.b == null || state.b <= state.a)) state.b = paraOf(state.a).end;
            render();
        });
    modeSeg.classList.add('mr-mode-seg');

    const insertSeg = seg([['inline', '답변 안에 넣기'], ['separate', '유저 메시지로 따로']],
        () => state.insertMode, (v) => { state.insertMode = v; });
    const resultSegContinue = seg([['swipe', '새 스와이프'], ['overwrite', '덮어쓰기']],
        () => state.resultMode, (v) => { state.resultMode = v; });
    const resultSegReplace = seg([['overwrite', '덮어쓰기'], ['swipe', '새 스와이프']],
        () => state.replaceResult, (v) => { state.replaceResult = v; });

    const chips = el('div', { class: 'mr-chips' },
        pack().presets.filter((p) => p?.name && p?.text).map((p) => el('button', {
            type: 'button', class: 'mr-chip', text: p.name, title: p.text,
            onclick: () => {
                const cur = dirArea.value.trim();
                dirArea.value = cur ? `${cur}\n${p.text}` : p.text;
                dirArea.focus();
            },
        })));
    const dirNote = el('div', { class: 'mr-small' });
    const langName = DIR_LANGS.find(([v]) => v === s.dirLang)?.[1]?.replace(' (추천)', '') ?? s.dirLang;
    dirNote.textContent = s.dirAutoTranslate && s.dirLang !== 'ko'
        ? `한국어로 적어도 보낼 때 ${langName}(으)로 번역해서 보내요.`
        : '';

    const apiLabel = el('span', { class: 'mr-api', text: apiDescription() });

    const backup = msg.extra?.mid_reroll_backup;
    const previewBtn = el('button', {
        type: 'button', class: 'mr-link', text: '📋 보낼 프롬프트 확인 (월드인포·페르소나·카드 등)',
        onclick: async () => {
            const replace = state.mode === 'replace';
            if (state.a == null || (replace && (state.b == null || state.b <= state.a))) {
                return toastr.warning(replace ? '바꿀 부분을 먼저 골라 주세요.' : '다시 쓰기 시작할 위치를 먼저 골라 주세요.');
            }
            if (!replace && state.a === 0 && !(insertArea.value.trim() && state.insertMode === 'inline')) {
                return toastr.warning('앞부분을 조금이라도 남겨야 미리 볼 수 있어요.');
            }
            previewBtn.disabled = true;
            try {
                await showPromptPreview({
                    mesId, mode: state.mode, a: state.a, b: state.b,
                    insert: insertArea.value, insertMode: state.insertMode, direction: dirArea.value,
                });
            } finally {
                previewBtn.disabled = false;
            }
        },
    });

    const restoreBtn = backup ? el('button', {
        type: 'button', class: 'mr-link', text: '↩ 덮어쓰기 전 원본으로 되돌리기',
        onclick: async () => {
            await restoreBackup(mesId);
            popup.completeCancelled();
        },
    }) : null;

    const insertSection = el('div', { class: 'mr-section' },
        el('div', { class: 'mr-row' }, el('div', { class: 'mr-label', text: '끼워넣을 내용 (선택)' }), insertSeg),
        insertArea);
    const resultRowContinue = el('div', { class: 'mr-row' }, el('span', { class: 'mr-small', text: '결과' }), resultSegContinue);
    const resultRowReplace = el('div', { class: 'mr-row' }, el('span', { class: 'mr-small', text: '결과' }), resultSegReplace);

    const root = el('div', { class: 'mr-popup' },
        el('div', { class: 'mr-title' }, el('i', { class: 'fa-solid fa-scissors' }), ' 중간 리롤'),
        modeSeg,
        el('div', { class: 'mr-section' },
            el('div', { class: 'mr-row' }, pickLabel, trBtn),
            hint, textBox, status),
        insertSection,
        el('div', { class: 'mr-section' },
            el('div', { class: 'mr-label', text: '전개 지시 (선택)' }),
            chips, dirArea, dirNote),
        el('div', { class: 'mr-foot' },
            resultRowContinue, resultRowReplace,
            el('div', { class: 'mr-row' }, el('span', { class: 'mr-small', text: 'API' }), apiLabel),
            previewBtn,
            restoreBtn),
    );

    const plain = (t) => t.replace(/\*/g, '');

    function render() {
        const replace = state.mode === 'replace';
        const ra = state.a;
        const rb = replace ? state.b : raw.length;
        const has = ra != null && rb != null && rb > ra;
        const fullCls = replace ? 'mr-picked' : 'mr-cut';
        const partCls = replace ? 'mr-picked-inline' : 'mr-cut-inline';
        const nodes = [];
        let markerPlaced = false;
        paras.forEach((p, i) => {
            const block = el('div', { class: 'mr-para', 'data-i': i });
            if (!has || p.end <= ra || p.start >= rb) {
                block.innerHTML = fmtText(p.text, msg, mesId);
            } else if (p.start >= ra && p.end <= rb) {
                block.classList.add(fullCls);
                block.innerHTML = fmtText(p.text, msg, mesId);
                if (!replace && !markerPlaced) {
                    nodes.push(el('div', { class: 'mr-marker' }, el('span', { text: '✂ 여기서부터 새로 써요' })));
                    markerPlaced = true;
                }
            } else {
                const from = Math.max(0, ra - p.start), to = Math.min(p.text.length, rb - p.start);
                block.classList.add(replace ? 'mr-picked-split' : 'mr-split');
                block.append(
                    el('span', { text: plain(p.text.slice(0, from)) }),
                    !replace && from > 0 ? el('span', { class: 'mr-inline-mark' }) : null,
                    el('span', { class: partCls, text: plain(p.text.slice(from, to)) }),
                    el('span', { text: plain(p.text.slice(to)) }),
                );
                if (!replace) markerPlaced = true;
            }
            if (state.showTr && state.tr?.[i]) block.append(el('div', { class: 'mr-tr', text: plain(state.tr[i]) }));
            nodes.push(block);
        });
        textBox.replaceChildren(...nodes);
        textBox.classList.toggle('mr-mode-paragraph', s.cutMode === 'paragraph');

        pickLabel.textContent = replace ? '어느 부분을 갈아끼울까요?' : '어디서부터 다시 쓸까요?';
        hint.textContent = replace
            ? ({
                both: '문단을 누르면 그 문단을, 다른 문단을 더 누르면 그 사이까지 골라요. 드래그하면 그 글자만 골라요.',
                paragraph: '바꿀 문단을 눌러 주세요. 다른 문단을 더 누르면 그 사이까지 골라요.',
                select: '바꿀 부분을 드래그해 주세요. 문단을 누르면 문단째로 골라요.',
            }[s.cutMode] ?? '')
            : ({
                both: '문단을 누르면 그 문단부터, 글자를 드래그하면 그 위치부터 다시 써요.',
                paragraph: '다시 쓰기 시작할 문단을 눌러 주세요.',
                select: '다시 쓰기 시작할 위치를 누르거나 드래그해 주세요.',
            }[s.cutMode] ?? '');
        if (state.showTr) hint.textContent += ' (번역 줄을 눌러도 그 문단이 골라져요)';

        insertSection.style.display = replace ? 'none' : '';
        resultRowContinue.style.display = replace ? 'none' : '';
        resultRowReplace.style.display = replace ? '' : 'none';
        dirArea.placeholder = replace
            ? '비워 두면 지시 없이 그 부분만 새로 써요.'
            : '비워 두면 지시 없이 그 지점부터 다시 써요.';

        let msgText = '';
        if (has) {
            if (replace) {
                msgText = `${(rb - ra).toLocaleString()}자를 골랐어요. 이 부분만 새로 써서 앞뒤 글 사이에 갈아끼워요.`;
            } else {
                msgText = ra === 0
                    ? '처음부터 전부 다시 써요. (끼워넣을 내용이 있어야 해요)'
                    : `앞부분 ${ra.toLocaleString()}자는 그대로 두고, 뒤 ${(raw.length - ra).toLocaleString()}자를 새로 써요.`;
            }
        }
        status.textContent = [approxNote, msgText].filter(Boolean).join(' ');
    }

    const scrollToMark = () => textBox.querySelector('.mr-marker, .mr-inline-mark, .mr-picked, .mr-picked-split')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    function setCut(i) {
        if (!Number.isFinite(i)) return;
        i = Math.max(0, Math.min(raw.length, i));
        if (i >= raw.trimEnd().length) return toastr.info('맨 끝이라 다시 쓸 부분이 없어요.');
        state.a = i;
        approxNote = '';
        render();
        scrollToMark();
    }
    function setRange(a, b) {
        a = Math.max(0, Math.min(raw.length, a));
        b = Math.max(0, Math.min(raw.length, b));
        if (b <= a || !raw.slice(a, b).trim()) return;
        state.a = a;
        state.b = b;
        approxNote = '';
        render();
    }

    /** Raw offset for a DOM point inside a paragraph block (null if it falls on a translation line). */
    function rawFromPoint(node, offset) {
        const nodeEl = node.nodeType === 1 ? node : node.parentElement;
        if (nodeEl?.closest('.mr-tr')) return null;
        const blockEl = nodeEl?.closest('.mr-para');
        if (!blockEl || !textBox.contains(blockEl)) return null;
        const p = paras[Number(blockEl.dataset.i)];
        const r = document.createRange();
        r.selectNodeContents(blockEl);
        try { r.setEnd(node, offset); } catch { return null; }
        return { p, at: p.start + mapOffset(p.text, blockEl.textContent, r.toString().length) };
    }

    function applySelection(rg) {
        const s1 = rawFromPoint(rg.startContainer, rg.startOffset);
        if (!s1) return false;
        if (state.mode === 'replace') {
            const e1 = rawFromPoint(rg.endContainer, rg.endOffset);
            const end = e1 ? e1.at : s1.p.end;
            setRange(snapToWord(raw, s1.at, s1.p.start), snapToWordEnd(raw, end, (e1?.p ?? s1.p).end));
        } else {
            setCut(snapToWord(raw, s1.at, s1.p.start));
        }
        return true;
    }

    function clickParagraph(p) {
        if (state.mode !== 'replace') return setCut(p.start);
        const { a, b } = state;
        if (a == null || b == null || b <= a) return setRange(p.start, p.end);
        const inside = p.start >= a && p.end <= b;
        if (inside && paraOf(a) === p && paraOf(b - 1) === p) { // only this one picked → unpick
            state.a = null; state.b = null; render(); return;
        }
        if (inside) return setRange(p.start, p.end);
        setRange(Math.min(a, p.start), Math.max(b, p.end));
    }

    textBox.addEventListener('click', (e) => {
        const blockEl = e.target.closest('.mr-para');
        if (!blockEl) return;
        const sel = window.getSelection();
        if (s.cutMode !== 'paragraph' && sel && !sel.isCollapsed && textBox.contains(sel.anchorNode)) {
            if (applySelection(sel.getRangeAt(0))) { sel.removeAllRanges(); return; }
        }
        if (s.cutMode === 'select' && state.mode === 'continue' && !e.target.closest('.mr-tr')) {
            const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
            const rg = pos ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY);
            const node = pos?.offsetNode ?? rg?.startContainer;
            const off = pos?.offset ?? rg?.startOffset;
            const hit = node ? rawFromPoint(node, off) : null;
            if (hit) return setCut(snapToWord(raw, hit.at, hit.p.start));
        }
        clickParagraph(paras[Number(blockEl.dataset.i)]);
    });

    // Touch devices: long-press selection does not fire click
    let selTimer = null;
    const onSelChange = () => {
        if (s.cutMode === 'paragraph') return;
        clearTimeout(selTimer);
        selTimer = setTimeout(() => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || !textBox.contains(sel.anchorNode)) return;
            applySelection(sel.getRangeAt(0));
        }, 700);
    };
    document.addEventListener('selectionchange', onSelChange);

    render();

    const popup = new c.Popup(root, c.POPUP_TYPE.CONFIRM, '', {
        okButton: '다시 쓰기',
        cancelButton: '취소',
        wide: true,
        allowVerticalScrolling: true,
        onClosing: (p) => {
            if (p.result !== c.POPUP_RESULT.AFFIRMATIVE) return true;
            if (state.mode === 'replace') {
                if (state.a == null || state.b == null || state.b <= state.a) { toastr.warning('바꿀 부분을 먼저 골라 주세요.'); return false; }
                return true;
            }
            if (state.a == null) { toastr.warning('다시 쓰기 시작할 위치를 먼저 골라 주세요.'); return false; }
            const ins = insertArea.value.trim();
            if (state.a === 0 && !(ins && state.insertMode === 'inline')) {
                toastr.warning('앞부분을 조금이라도 남기거나, "답변 안에 넣기"로 끼워넣을 내용을 적어 주세요.');
                return false;
            }
            return true;
        },
    });
    const result = await popup.show();
    document.removeEventListener('selectionchange', onSelChange);
    clearTimeout(selTimer);
    if (result !== c.POPUP_RESULT.AFFIRMATIVE) return;

    const direction = await prepareDirection(dirArea.value);
    if (direction === null) return;
    if (state.mode === 'replace') {
        await runReplace({ mesId, a: state.a, b: state.b, direction, rawDirection: dirArea.value, resultMode: state.replaceResult });
    } else {
        await runRewrite({
            mesId,
            cut: state.a,
            insert: insertArea.value,
            direction,
            rawDirection: dirArea.value,
            insertMode: state.insertMode,
            resultMode: state.resultMode,
        });
    }
}

/** Translates the direction into the chosen prompt language when it is written in another one. */
async function prepareDirection(text, { quiet = false } = {}) {
    const s = getSettings();
    text = String(text ?? '').trim();
    if (!text || !s.dirAutoTranslate || isLang(text, s.dirLang)) return text;
    try {
        const out = await translate(text, DIR_CODE[s.dirLang]);
        if (!quiet) toastr.info(out, '지시를 번역해서 보내요', { timeOut: 4000 });
        return out;
    } catch (e) {
        console.warn(LOG, e);
        toastr.warning('지시 번역에 실패해서 적은 그대로 보내요.');
        return text;
    }
}

function apiDescription() {
    const s = getSettings();
    if (s.apiMode === 'profile') {
        const p = getProfiles().find((x) => x.id === s.profileId);
        return p ? `저장 프로필: ${p.name}` : '저장 프로필 (선택 안 됨)';
    }
    if (s.apiMode === 'custom') return `커스텀: ${s.customModel || '모델 미입력'}`;
    return '현재 연결';
}

// ---------- shared message helpers ----------
let busy = false;

function snapshotOf(msg) {
    return {
        mes: msg.mes,
        swipes: Array.isArray(msg.swipes) ? [...msg.swipes] : undefined,
        swipe_id: msg.swipe_id,
        swipe_info: Array.isArray(msg.swipe_info) ? structuredClone(msg.swipe_info) : undefined,
        extra: structuredClone(msg.extra ?? {}),
    };
}
function applySnapshot(msg, snap) {
    msg.mes = snap.mes;
    if (snap.swipes) msg.swipes = snap.swipes; else delete msg.swipes;
    if (snap.swipe_id !== undefined) msg.swipe_id = snap.swipe_id; else delete msg.swipe_id;
    if (snap.swipe_info) msg.swipe_info = snap.swipe_info; else delete msg.swipe_info;
    msg.extra = snap.extra;
}

function setMessageText(msg, text) {
    msg.mes = text;
    if (Array.isArray(msg.swipes)) msg.swipes[msg.swipe_id ?? 0] = text;
}

/** Adds `text` as a new swipe and switches to it (keeps swipe_info in step). */
function pushSwipe(msg, text) {
    const raw = String(msg.mes ?? '');
    if (!Array.isArray(msg.swipes) || !msg.swipes.length) {
        msg.swipes = [raw];
        msg.swipe_id = 0;
    }
    if (!Array.isArray(msg.swipe_info)) msg.swipe_info = [];
    while (msg.swipe_info.length < msg.swipes.length) {
        msg.swipe_info.push({ send_date: msg.send_date, gen_started: msg.gen_started, gen_finished: msg.gen_finished, extra: structuredClone(msg.extra ?? {}) });
    }
    const now = new Date().toISOString();
    const extra = structuredClone(msg.extra ?? {});
    delete extra.mid_reroll_backup;
    dropDisplay(extra);
    msg.swipes.push(text);
    msg.swipe_info.push({ send_date: now, gen_started: now, gen_finished: null, extra });
    msg.swipe_id = msg.swipes.length - 1;
    msg.mes = text;
    msg.extra = structuredClone(extra);
}

async function rerender(mesId) {
    const c = ctx();
    c.updateMessageBlock(mesId, c.chat[mesId]);
    try { c.swipe?.refresh?.(true); } catch { /* older ST */ }
}

async function restoreBackup(mesId) {
    const c = ctx();
    const msg = c.chat[mesId];
    const b = msg?.extra?.mid_reroll_backup;
    if (!b) return;
    setMessageText(msg, b.mes);
    delete msg.extra.mid_reroll_backup;
    dropDisplay(msg.extra);
    await rerender(mesId);
    await c.saveChat();
    announceEdit(mesId);
    toastr.success('원본으로 되돌렸어요.');
}

// ---------- continue mode ----------
/** What stays in the message, and how the continuation joins it. */
function planContinue(raw, cut, insert, insertMode) {
    const before = raw.slice(0, cut);
    let kept = before.replace(/\s+$/, '');
    const gap = before.slice(kept.length);
    const sep = paraSeparator(raw);
    let joiner = gap.includes('\n') ? sep : (gap ? ' ' : '');
    insert = String(insert ?? '').trim();
    const inline = !!insert && insertMode === 'inline';
    const separate = !!insert && insertMode === 'separate';
    // The kept part ends here for good (something follows it), so close an open *italic* or "quote"
    if (kept && insert) kept = closeOpenMarks(kept);
    if (inline) {
        kept = kept ? kept + sep + insert : insert;
        joiner = sep;
    }
    return { kept, joiner, inline, separate, insert };
}

/** One-shot direction (and the inline-insert note) for the next generation only. Returns whether anything was set. */
function injectDirection(direction, inline) {
    const s = getSettings();
    const p = pack();
    const lines = [];
    if (direction) lines.push(fill(p.template, { direction }));
    if (inline) lines.push(p.insertNote);
    if (!lines.length) return false;
    ctx().setExtensionPrompt(PROMPT_KEY, lines.join('\n'), IN_CHAT, Number(s.injectDepth) || 0, false, ROLE_SYSTEM);
    return true;
}

function replaceInstruction(raw, a, b, direction) {
    const before = raw.slice(0, a);
    const after = raw.slice(b);
    return fill(pack().rewrite, {
        before: before.length > 800 ? '…' + before.slice(-800) : before,
        passage: raw.slice(a, b).trim(),
        after: after.length > 800 ? after.slice(0, 800) + '…' : after,
        direction: String(direction ?? '').trim(),
    });
}

async function runRewrite({ mesId, cut, insert, direction, rawDirection, insertMode, resultMode }) {
    const c = ctx();
    const s = getSettings();
    const chat = c.chat;
    const msg = chat[mesId];
    if (!msg || mesId !== chat.length - 1) return toastr.warning('그사이 채팅이 바뀌었어요. 다시 열어 주세요.');

    const raw = String(msg.mes ?? '');
    direction = String(direction ?? '').trim();
    const plan = planContinue(raw, cut, insert, insertMode);
    const { kept, joiner, inline, separate } = plan;
    insert = plan.insert;
    if (!kept) return toastr.warning('남길 부분이 없어요.');

    lastRun = { chatId: c.chatId, mesId, mode: 'continue', kept: raw.slice(0, cut), insert, direction: rawDirection ?? direction };

    const snap = snapshotOf(msg);
    busy = true;
    const textarea = document.getElementById('send_textarea');
    const draft = textarea?.value ?? '';
    let userMsgAdded = false;
    let newAiIndex = -1;
    try {
        // 1) Cut the message (new swipe or in place)
        if (resultMode === 'swipe') {
            pushSwipe(msg, kept);
        } else {
            msg.extra = msg.extra ?? {};
            msg.extra.mid_reroll_backup = { mes: raw, at: Date.now() };
            dropDisplay(msg.extra);
            setMessageText(msg, kept);
        }
        await rerender(mesId);
        await c.saveChat();

        // 2) One-shot direction for this generation only
        injectDirection(direction, inline);

        // 3) Separate mode: the user's passage becomes its own message
        let genType = 'continue';
        if (separate) {
            await addUserMessage(insert);
            userMsgAdded = true;
            genType = 'normal';
        }

        if (textarea) { textarea.value = ''; textarea.dispatchEvent(new Event('input', { bubbles: true })); }

        // 4) Generate
        if (s.apiMode === 'current') {
            await c.generate(genType);
        } else {
            newAiIndex = await generateElsewhere(genType, mesId, kept, joiner);
        }
    } catch (err) {
        console.error(LOG, err);
        if (err?.name !== 'AbortError') toastr.error(String(err?.message || err), '중간 리롤 실패');
    } finally {
        c.setExtensionPrompt(PROMPT_KEY, '', IN_CHAT, 0);
        if (textarea && !textarea.value && draft) {
            textarea.value = draft;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        busy = false;
        hideBusy();
    }

    // 5) Tidy up the result
    if (separate) {
        if (userMsgAdded) {
            const last = chat[chat.length - 1];
            if (newAiIndex < 0 && last?.is_user) toastr.info('유저 메시지는 들어갔지만 AI 답변은 생성되지 않았어요.');
        }
        return;
    }
    const m = chat[mesId];
    if (!m || chat.length - 1 !== mesId) return;
    const text = String(m.mes ?? '');
    const cont = text.startsWith(kept) ? text.slice(kept.length) : null;
    if (cont == null) return; // someone edited it meanwhile; leave it
    if (!cont.trim()) {
        applySnapshot(m, snap);
        await rerender(mesId);
        await c.saveChat();
        toastr.warning('새로 써진 내용이 없어서 원래대로 되돌렸어요.');
        return;
    }
    const body = s.trimOverlap ? trimOverlap(kept, cont) : cont;
    const finalText = (kept + joinCont(joiner, body)).trimEnd();
    if (finalText !== text) {
        setMessageText(m, finalText);
        await rerender(mesId);
        await c.saveChat();
    }
    // The current connection already sent ST's own "new reply (continue)" signals; the others did not
    if (s.apiMode === 'current') announceEdit(mesId);
    else announceResult(mesId, 'continue');

    // 6) Optional check window (with translation) for the newly written part
    const newPart = finalText.slice(kept.length).trim();
    const wantReview = s.reviewContinue === 'always' || (s.reviewContinue === 'foreign' && !isLang(newPart, s.trLang));
    if (!wantReview || !newPart) return;
    const choice = await reviewContinue({ msg: m, mesId, kept, newPart });
    if (choice === 'keep') return;
    if (chat[mesId] !== m || String(m.mes) !== finalText) return toastr.warning('그사이 메시지가 바뀌어서 그대로 뒀어요.');
    applySnapshot(m, snap);
    await rerender(mesId);
    await c.saveChat();
    announceEdit(mesId);
    if (choice === 'retry') {
        await runRewrite({ mesId, cut, insert, direction, rawDirection, insertMode, resultMode });
    } else {
        toastr.info('새로 쓴 부분을 버리고 원래대로 되돌렸어요.');
    }
}

/** Translation block with a button; translates only `getText()` and shows it in this popup only. */
function translationBlock(getText, { auto = false, label = '번역 보기' } = {}) {
    const s = getSettings();
    const out = el('div', { class: 'mr-tr-out' });
    out.style.display = 'none';
    const btn = el('button', { type: 'button', class: 'mr-chip mr-tr-btn' }, el('i', { class: 'fa-solid fa-language' }), el('span', { text: ` ${label}` }));
    let lastSrc = null;
    const run = async () => {
        const src = getText();
        if (!src.trim()) return;
        if (lastSrc === src && out.style.display !== 'none') { out.style.display = 'none'; btn.classList.remove('active'); return; }
        btn.disabled = true;
        out.style.display = '';
        out.textContent = '번역하는 중…';
        try {
            out.textContent = await translate(src, s.trLang);
            lastSrc = src;
            btn.classList.add('active');
        } catch (e) {
            out.textContent = `번역 실패: ${e?.message || e}`;
        } finally {
            btn.disabled = false;
        }
    };
    btn.addEventListener('click', run);
    if (auto) setTimeout(run, 0);
    return { btn, out, run };
}

async function reviewContinue({ msg, mesId, kept, newPart }) {
    const c = ctx();
    const s = getSettings();
    const tail = kept.length > 160 ? '…' + kept.slice(-160) : kept;
    const tr = translationBlock(() => newPart, { auto: s.autoTranslateResult && !isLang(newPart, s.trLang) });
    const root = el('div', { class: 'mr-popup' },
        el('div', { class: 'mr-title' }, el('i', { class: 'fa-solid fa-scissors' }), ' 새로 쓴 부분 확인'),
        el('div', { class: 'mr-ctx', text: tail }),
        el('div', { class: 'mr-new-block', html: fmtText(newPart, msg, mesId) }),
        el('div', { class: 'mr-row' }, el('span', { class: 'mr-small', text: '번역은 이 창에서만 보여요. 채팅에는 원문이 그대로 남아요.' }), tr.btn),
        tr.out,
    );
    const res = await new c.Popup(root, c.POPUP_TYPE.TEXT, '', {
        okButton: '이대로 두기',
        wide: true,
        allowVerticalScrolling: true,
        customButtons: [
            { text: '다시 쓰기', result: 2, classes: ['mr-btn-retry'] },
            { text: '되돌리기', result: 3, classes: ['mr-btn-undo'] },
        ],
    }).show();
    if (res === 2) return 'retry';
    if (res === 3) return 'undo';
    return 'keep';
}

async function addUserMessage(text) {
    try {
        const mod = await import('../../../../script.js');
        if (typeof mod.sendMessageAsUser === 'function') {
            await mod.sendMessageAsUser(text, '');
            return;
        }
    } catch (e) {
        console.warn(LOG, 'sendMessageAsUser import failed, falling back', e);
    }
    const c = ctx();
    const message = {
        name: c.name1,
        is_user: true,
        is_system: false,
        send_date: new Date().toISOString(),
        mes: text,
        extra: {},
    };
    c.chat.push(message);
    const id = c.chat.length - 1;
    await c.eventSource.emit(c.eventTypes.MESSAGE_SENT, id);
    c.addOneMessage(message);
    await c.eventSource.emit(c.eventTypes.USER_MESSAGE_RENDERED, id);
    await c.saveChat();
}

// ---------- prompt preview ----------
// Builds the exact prompt the next run would send (ST dry run), then checks which pieces made it in.

/** Dry-runs the prompt for the current popup choices. Message/chat changes are temporary and undone at once. */
async function buildPreviewPrompt({ mesId, mode, a, b, insert, insertMode, direction }) {
    const c = ctx();
    const msg = c.chat[mesId];
    const raw = String(msg.mes ?? '');
    if (mode === 'replace') {
        const quietInstr = replaceInstruction(raw, a, b, direction);
        const prompt = await capturePrompt('quiet', { quiet_prompt: quietInstr });
        return { prompt, extPrompts: c.extensionPrompts ?? {}, quietInstr };
    }
    const plan = planContinue(raw, a, insert, insertMode);
    const undo = [];
    try {
        msg.mes = plan.kept;
        undo.push(() => { msg.mes = raw; });
        if (injectDirection(direction, plan.inline)) undo.push(() => c.setExtensionPrompt(PROMPT_KEY, '', IN_CHAT, 0));
        let type = 'continue';
        if (plan.separate) {
            c.chat.push({ name: c.name1, is_user: true, is_system: false, send_date: new Date().toISOString(), mes: plan.insert, extra: {} });
            undo.push(() => c.chat.pop());
            type = 'normal';
        }
        const prompt = await capturePrompt(type);
        // Keep what was injected for this run before the temporary direction is cleared again
        return { prompt, extPrompts: structuredClone(c.extensionPrompts ?? {}) };
    } finally {
        for (const f of undo.reverse()) { try { f(); } catch { /* keep undoing */ } }
    }
}

function contentText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('\n');
    return String(content ?? '');
}

/** World books that can feed this chat: global, character (main + extra), chat-bound, persona-bound. */
async function activeBookNames() {
    const c = ctx();
    const names = new Set();
    try {
        const wi = await import('../../../world-info.js');
        (wi.selected_world_info ?? []).forEach((n) => names.add(n));
        const ch = c.characters?.[c.characterId];
        const main = ch?.data?.extensions?.world;
        if (main) names.add(main);
        const file = String(ch?.avatar ?? '').replace(/\.[^.]+$/, '');
        (wi.world_info?.charLore?.find((e) => e.name === file)?.extraBooks ?? []).forEach((n) => names.add(n));
        const chatBook = c.chatMetadata?.[wi.METADATA_KEY ?? 'world_info'];
        if (chatBook) names.add(chatBook);
    } catch (e) {
        console.warn(LOG, 'world info list unavailable', e);
    }
    const personaBook = c.powerUserSettings?.persona_description_lorebook;
    if (personaBook) names.add(personaBook);
    return [...names].filter(Boolean);
}

const EXT_PROMPT_NAMES = {
    '1_memory': '요약 (Summarize)',
    '2_floating_prompt': '작가 노트',
    '3_vectors': '채팅 벡터 기억',
    '4_vectors_data_bank': '데이터 뱅크',
    chromadb: '스마트 컨텍스트',
    DEPTH_PROMPT: '캐릭터 노트 (깊이 프롬프트)',
    [PROMPT_KEY]: '✂ 중간 리롤 지시 (이번에만)',
};

async function analyzePrompt(prompt, extPrompts, quietInstr) {
    const c = ctx();
    const parts = Array.isArray(prompt)
        ? prompt.map((m) => ({ role: String(m?.role ?? ''), text: contentText(m?.content) }))
        : [{ role: '', text: String(prompt ?? '') }];
    const full = parts.map((p) => p.text).join('\n');
    const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
    const hay = norm(full);
    /** true/false when the text is (not) in the prompt, null when there is nothing to look for. */
    const has = (t) => {
        const n = norm(Array.isArray(t) ? t.join('\n') : t);
        if (!n) return null;
        if (n.length <= 50) return hay.includes(n);
        const w = 40;
        const probes = [n.slice(0, w), n.slice(Math.floor(n.length / 2), Math.floor(n.length / 2) + w), n.slice(-w)];
        return probes.some((p) => hay.includes(p));
    };

    let f = {};
    try { f = c.getCharacterCardFields?.() ?? {}; } catch { /* group chat or no card */ }
    const card = [
        ['캐릭터 설명', f.description],
        ['캐릭터 성격', f.personality],
        ['시나리오', f.scenario],
        ['예시 대화', f.mesExamples],
        ['캐릭터 노트 (깊이 프롬프트)', f.charDepthPrompt],
        ['캐릭터 카드의 시스템 프롬프트', f.system],
        ['캐릭터 카드의 Post-History 지시', f.jailbreak],
        ['페르소나 설명', f.persona],
    ].map(([label, text]) => ({ label, state: has(text) }));

    const books = [];
    for (const name of await activeBookNames()) {
        let data = null;
        try { data = await c.loadWorldInfo(name); } catch { /* missing book */ }
        const entries = Object.values(data?.entries ?? {}).filter((e) => !e?.disable && String(e?.content ?? '').trim());
        const sub = (t) => { try { return c.substituteParams(t); } catch { return t; } };
        const inPrompt = entries.filter((e) => has(sub(e.content)))
            .map((e) => String(e.comment || (Array.isArray(e.key) ? e.key.join(', ') : '') || `#${e.uid}`));
        books.push({ name, total: entries.length, inPrompt });
    }

    const ext = Object.entries(extPrompts ?? c.extensionPrompts ?? {})
        .filter(([k, v]) => String(v?.value ?? '').trim() && !/^customDepthWI/i.test(k))
        .map(([k, v]) => ({ label: EXT_PROMPT_NAMES[k] ?? k, state: has(v.value) }));
    if (quietInstr) ext.push({ label: '🔁 부분 갈아끼우기 지시 (이번에만)', state: has(quietInstr) });

    const chatMsgs = c.chat.filter((m) => !m.is_system && String(m.mes ?? '').trim());
    const chatIn = chatMsgs.filter((m) => has(m.mes)).length;

    let tokens = null;
    try { tokens = await c.getTokenCountAsync(full); } catch { /* tokenizer unavailable */ }
    return { parts, full, card, books, ext, chatTotal: chatMsgs.length, chatIn, tokens };
}

async function showPromptPreview(choice) {
    const c = ctx();
    const s = getSettings();
    const wait = toastr.info('프롬프트를 만드는 중…', '', { timeOut: 0, extendedTimeOut: 0 });
    let info;
    try {
        const direction = await prepareDirection(choice.direction, { quiet: true });
        const built = await buildPreviewPrompt({ ...choice, direction });
        const prompt = built?.prompt;
        if (!prompt || (Array.isArray(prompt) && !prompt.length)) throw new Error('프롬프트를 만들지 못했어요.');
        info = await analyzePrompt(prompt, built.extPrompts, built.quietInstr);
    } catch (e) {
        console.error(LOG, e);
        toastr.error(String(e?.message || e), '프롬프트 확인 실패');
        return;
    } finally {
        toastr.clear(wait);
    }

    const row = (label, state) => el('div', { class: `mr-pv-row mr-pv-${state === true ? 'in' : state === false ? 'out' : 'empty'}` },
        el('span', { class: 'mr-pv-icon', text: state === true ? '✅' : state === false ? '❌' : '➖' }),
        el('span', { text: label }),
        el('span', { class: 'mr-pv-state', text: state === true ? '들어감' : state === false ? '안 들어감' : '비어 있음' }));

    const where = {
        current: '현재 연결로 보낼 프롬프트예요. 실제로 생성할 때도 실리태번이 똑같이 만들어요.',
        profile: `이 프롬프트를 그대로 저장 프로필(${apiDescription().replace(/^저장 프로필:? ?/, '')})로 보내요.`,
        custom: '이 프롬프트를 그대로 커스텀 API로 보내요.',
    }[s.apiMode] ?? '';

    const bookBlocks = info.books.length
        ? info.books.map((b) => el('div', { class: 'mr-pv-book' },
            el('div', { class: 'mr-pv-row' },
                el('span', { class: 'mr-pv-icon', text: b.inPrompt.length ? '📖' : '📕' }),
                el('span', { text: b.name }),
                el('span', { class: 'mr-pv-state', text: `${b.total}개 중 ${b.inPrompt.length}개 들어감` })),
            b.inPrompt.length ? el('div', { class: 'mr-pv-entries', text: b.inPrompt.join(' · ') }) : null))
        : [el('div', { class: 'mr-small', text: '켜져 있는 월드인포가 없어요.' })];

    const fullList = el('div', { class: 'mr-pv-full' }, info.parts.map((p) => el('div', { class: 'mr-pv-msg' },
        p.role ? el('div', { class: `mr-pv-role mr-pv-role-${p.role}`, text: p.role }) : null,
        el('div', { class: 'mr-pv-text', text: p.text }))));
    const copyBtn = el('button', { type: 'button', class: 'mr-chip', onclick: async () => {
        const text = info.parts.map((p) => (p.role ? `[${p.role}]\n${p.text}` : p.text)).join('\n\n');
        try { await navigator.clipboard.writeText(text); toastr.success('복사했어요.'); } catch { toastr.warning('복사하지 못했어요.'); }
    } }, el('i', { class: 'fa-solid fa-copy' }), ' 전체 복사');

    const root = el('div', { class: 'mr-popup mr-pv' },
        el('div', { class: 'mr-title' }, el('i', { class: 'fa-solid fa-list-check' }), ' 보낼 프롬프트 확인'),
        el('div', { class: 'mr-small', text: where }),
        el('div', { class: 'mr-pv-total', text: [
            info.tokens != null ? `약 ${info.tokens.toLocaleString()} 토큰` : null,
            info.parts.length > 1 ? `메시지 ${info.parts.length}개` : null,
            `채팅 기록 ${info.chatTotal}개 중 ${info.chatIn}개`,
        ].filter(Boolean).join(' · ') }),
        el('div', { class: 'mr-section' }, el('div', { class: 'mr-label', text: '캐릭터 카드 · 페르소나' }), info.card.map((x) => row(x.label, x.state))),
        el('div', { class: 'mr-section' }, el('div', { class: 'mr-label', text: '월드인포 (로어북)' }), bookBlocks),
        el('div', { class: 'mr-section' }, el('div', { class: 'mr-label', text: '확장·기능이 끼워넣은 내용' }),
            info.ext.length ? info.ext.map((x) => row(x.label, x.state)) : el('div', { class: 'mr-small', text: '없어요.' })),
        el('small', { class: 'mr-note', text: '본문이 프롬프트 안에 그대로 있는지 찾아본 결과예요. 프리셋이나 확장이 모양을 바꿔서 넣는 항목은 "안 들어감"으로 보일 수 있어요. 채팅 기록은 맥락 길이에 맞춰 오래된 것부터 빠져요. 번역할 때는 이 프롬프트가 아니라 번역할 글만 보내요.' }),
        el('details', { class: 'mr-group mr-adv' },
            el('summary', { class: 'mr-group-title', text: '전체 프롬프트 보기' }),
            el('div', { class: 'mr-inline' }, copyBtn),
            fullList),
    );
    await new c.Popup(root, c.POPUP_TYPE.TEXT, '', { okButton: '닫기', wide: true, large: true, allowVerticalScrolling: true }).show();
}

// ---------- replace mode ----------
async function runReplace({ mesId, a, b, direction, rawDirection, resultMode }) {
    const c = ctx();
    const chat = c.chat;
    const msg = chat[mesId];
    if (!msg || mesId !== chat.length - 1) return toastr.warning('그사이 채팅이 바뀌었어요. 다시 열어 주세요.');
    const raw = String(msg.mes ?? '');
    const passage = raw.slice(a, b);
    const before = raw.slice(0, a);
    const after = raw.slice(b);
    const lead = passage.match(/^\s*/)[0];
    const trail = passage.match(/\s*$/)[0];
    const core = passage.trim();

    const instr = replaceInstruction(raw, a, b, direction);
    lastRun = { chatId: c.chatId, mesId, mode: 'replace', a, b, text: passage, insert: '', direction: rawDirection ?? direction };

    let candidate = '';
    for (;;) {
        busy = true;
        try {
            candidate = cleanReplacement(await generateReplacement(instr), before, after);
        } catch (err) {
            console.error(LOG, err);
            if (err?.name !== 'AbortError') toastr.error(String(err?.message || err), '부분 갈아끼우기 실패');
            return;
        } finally {
            busy = false;
            hideBusy();
        }
        if (!candidate) return toastr.warning('새로 써진 내용이 없어요. 다시 시도해 주세요.');

        const r = await reviewReplace({ msg, mesId, before, passage: core, after, candidate });
        if (r.action === 'retry') continue;
        if (r.action !== 'apply') return;
        candidate = r.text.trim();
        break;
    }
    if (!candidate) return;

    if (chat[mesId] !== msg || String(msg.mes ?? '') !== raw) return toastr.warning('그사이 메시지가 바뀌어서 적용하지 않았어요.');
    const newText = before + lead + candidate + trail + after;
    if (resultMode === 'swipe') {
        pushSwipe(msg, newText);
        if (msg.swipe_info?.[msg.swipe_id]) msg.swipe_info[msg.swipe_id].gen_finished = new Date().toISOString();
    } else {
        msg.extra = msg.extra ?? {};
        if (!msg.extra.mid_reroll_backup) msg.extra.mid_reroll_backup = { mes: raw, at: Date.now() };
        dropDisplay(msg.extra);
        setMessageText(msg, newText);
    }
    await rerender(mesId);
    await c.saveChat();
    announceResult(mesId, resultMode === 'swipe' ? 'swipe' : 'normal');
    const start = before.length + lead.length;
    lastRun = { ...lastRun, a: start, b: start + candidate.length, text: candidate };
    toastr.success(resultMode === 'swipe' ? '바꾼 답변을 새 스와이프로 넣었어요.' : '그 부분만 갈아끼웠어요.');
}

/** Strips tags, fences and echoed context the model may wrap around the new passage. */
function cleanReplacement(text, before, after) {
    let t = String(text ?? '').trim();
    const m = t.match(/<passage>([\s\S]*?)(?:<\/passage>|$)/i);
    if (m) t = m[1];
    t = t.replace(/<\/?(?:passage|before|after)>/gi, '').trim();
    const fence = t.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
    if (fence) t = fence[1].trim();
    // Model echoed the surrounding text
    const bt = before.trimEnd().slice(-60);
    if (bt.length >= 20 && t.startsWith(bt)) t = t.slice(bt.length).trim();
    const at = after.trimStart().slice(0, 60);
    if (at.length >= 20 && t.endsWith(at)) t = t.slice(0, -at.length).trim();
    return t;
}

async function generateReplacement(instr) {
    const c = ctx();
    const s = getSettings();
    if (s.apiMode === 'current') {
        showBusy(() => { try { c.stopGeneration(); } catch { /* ignore */ } });
        return c.generateQuietPrompt({
            quietPrompt: instr,
            removeReasoning: true,
            responseLength: Number(s.maxTokens) > 0 ? Number(s.maxTokens) : null,
        });
    }
    const prompt = await capturePrompt('quiet', { quiet_prompt: instr });
    if (!prompt || (Array.isArray(prompt) && !prompt.length)) throw new Error('프롬프트를 만들지 못했어요.');
    const ac = new AbortController();
    showBusy(() => ac.abort());
    const res = s.apiMode === 'profile'
        ? await profileCall(s.profileId, prompt, genMaxTokens(), { signal: ac.signal })
        : await customCall(prompt, genMaxTokens(), { signal: ac.signal });
    return readResult(res);
}

async function reviewReplace({ msg, mesId, before, passage, after, candidate }) {
    const c = ctx();
    const s = getSettings();
    const newArea = el('textarea', { class: 'text_pole mr-new-edit', rows: 6 });
    newArea.value = candidate;
    const fit = () => { newArea.style.height = 'auto'; newArea.style.height = Math.min(window.innerHeight * 0.45, newArea.scrollHeight + 4) + 'px'; };
    newArea.addEventListener('input', fit);
    const foreign = !isLang(candidate, s.trLang);
    const trNew = translationBlock(() => newArea.value, { auto: s.autoTranslateResult && foreign, label: '새 글 번역' });
    const trOld = translationBlock(() => passage, { label: '원래 글 번역' });
    const bTail = before.trimEnd();
    const aHead = after.trimStart();
    const root = el('div', { class: 'mr-popup' },
        el('div', { class: 'mr-title' }, el('i', { class: 'fa-solid fa-right-left' }), ' 바꿀 내용 확인'),
        bTail ? el('div', { class: 'mr-ctx', text: bTail.length > 140 ? '…' + bTail.slice(-140) : bTail }) : null,
        el('div', { class: 'mr-cmp' },
            el('div', { class: 'mr-cmp-col mr-old' },
                el('div', { class: 'mr-row' }, el('span', { class: 'mr-cmp-label', text: '원래' }), trOld.btn),
                el('div', { class: 'mr-old-text', html: fmtText(passage, msg, mesId) }),
                trOld.out),
            el('div', { class: 'mr-cmp-col mr-new' },
                el('div', { class: 'mr-row' }, el('span', { class: 'mr-cmp-label', text: '새로 (직접 고쳐도 돼요)' }), trNew.btn),
                newArea,
                trNew.out),
        ),
        aHead ? el('div', { class: 'mr-ctx', text: aHead.length > 140 ? aHead.slice(0, 140) + '…' : aHead }) : null,
        el('div', { class: 'mr-small', text: '번역은 이 창에서만 보여요. 적용하면 위 원문(새로)이 들어가요.' }),
    );
    const popup = new c.Popup(root, c.POPUP_TYPE.CONFIRM, '', {
        okButton: '갈아끼우기',
        cancelButton: '취소',
        wide: true,
        allowVerticalScrolling: true,
        customButtons: [{ text: '다시 생성', result: 2, classes: ['mr-btn-retry'] }],
    });
    const shown = popup.show();
    setTimeout(fit, 0);
    const res = await shown;
    if (res === 2) return { action: 'retry' };
    if (res === c.POPUP_RESULT.AFFIRMATIVE) return { action: 'apply', text: newArea.value };
    return { action: 'cancel' };
}

// ---------- generating with a saved profile or a custom endpoint ----------
async function capturePrompt(type, opts = {}) {
    const c = ctx();
    let captured = null;
    const hook = (data, dryRun) => { if (dryRun) captured = data?.prompt ?? null; };
    c.eventSource.on(c.eventTypes.GENERATE_AFTER_DATA, hook);
    try {
        await c.generate(type, opts, true);
    } finally {
        c.eventSource.removeListener(c.eventTypes.GENERATE_AFTER_DATA, hook);
    }
    return captured;
}

function defaultMaxTokens() {
    const c = ctx();
    const n = Number(c.chatCompletionSettings?.openai_max_tokens);
    return Number.isFinite(n) && n > 0 ? n : 1024;
}
function genMaxTokens() {
    const s = getSettings();
    return Number(s.maxTokens) > 0 ? Number(s.maxTokens) : defaultMaxTokens();
}

async function profileCall(profileId, prompt, maxTokens, { stream = false, signal, includePreset = true } = {}) {
    const svc = ctx().ConnectionManagerRequestService;
    if (!svc) throw new Error('연결 관리자(Connection Manager)를 쓸 수 없어요.');
    if (!getProfiles().some((p) => p.id === profileId)) throw new Error('선택한 저장 프로필을 찾지 못했어요. 설정에서 다시 골라 주세요.');
    return svc.sendRequest(profileId, prompt, maxTokens, { stream, signal, extractData: true, includePreset, includeInstruct: includePreset });
}

async function customCall(prompt, maxTokens, { stream = false, signal, model } = {}) {
    const s = getSettings();
    const url = String(s.customUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    model = model || s.customModel;
    if (!url) throw new Error('커스텀 API 주소를 설정에서 입력해 주세요.');
    if (!model) throw new Error('커스텀 모델 이름을 설정에서 입력해 주세요.');
    const key = getCustomKey();
    const messages = Array.isArray(prompt) ? prompt : [{ role: 'user', content: String(prompt) }];
    return ctx().ChatCompletionService.processRequest({
        stream,
        messages,
        model,
        chat_completion_source: 'custom',
        custom_url: url,
        max_tokens: maxTokens,
        custom_include_headers: key ? `Authorization: ${JSON.stringify('Bearer ' + key)}` : undefined,
    }, {}, true, signal);
}

/** Reads a request result: a stream generator (calls onText with the text so far) or a plain response. */
async function readResult(res, onText) {
    if (typeof res === 'function') {
        let text = '';
        for await (const chunk of res()) {
            text = String(chunk?.text ?? text);
            onText?.(text);
        }
        return text;
    }
    return typeof res === 'string' ? res : String(res?.content ?? '');
}

/** Returns the index of a newly created AI message (normal type) or -1. */
async function generateElsewhere(type, mesId, kept, joiner) {
    const c = ctx();
    const chat = c.chat;
    const prompt = await capturePrompt(type);
    if (!prompt || (Array.isArray(prompt) && !prompt.length)) throw new Error('프롬프트를 만들지 못했어요.');

    let target, targetId, base;
    const s = getSettings();
    const apiTag = s.apiMode === 'custom' ? 'custom' : 'profile';
    const modelTag = s.apiMode === 'custom' ? s.customModel : (getProfiles().find((p) => p.id === s.profileId)?.model ?? '');
    if (type === 'continue') {
        target = chat[mesId];
        targetId = mesId;
        base = kept;
    } else {
        const ref = chat[mesId];
        const now = new Date().toISOString();
        target = {
            name: ref.name,
            is_user: false,
            is_system: false,
            send_date: now,
            mes: '',
            extra: { api: apiTag, model: modelTag },
            swipes: [''],
            swipe_id: 0,
            swipe_info: [{ send_date: now, gen_started: now, gen_finished: null, extra: { api: apiTag, model: modelTag } }],
        };
        if (ref.force_avatar) target.force_avatar = ref.force_avatar;
        if (ref.original_avatar) target.original_avatar = ref.original_avatar;
        chat.push(target);
        targetId = chat.length - 1;
        c.addOneMessage(target);
        base = '';
    }

    const ac = new AbortController();
    showBusy(() => ac.abort());
    let text = '';
    let lastPaint = 0;
    const paint = (force = false) => {
        const now = Date.now();
        if (!force && now - lastPaint < 120) return;
        lastPaint = now;
        setMessageText(target, base ? base + joinCont(joiner, text) || base : text);
        c.updateMessageBlock(targetId, target);
    };

    let aborted = false;
    try {
        const res = s.apiMode === 'profile'
            ? await profileCall(s.profileId, prompt, genMaxTokens(), { stream: true, signal: ac.signal })
            : await customCall(prompt, genMaxTokens(), { stream: true, signal: ac.signal });
        text = await readResult(res, (t) => { text = t; paint(); });
    } catch (err) {
        if (err?.name === 'AbortError' || ac.signal.aborted) aborted = true;
        else {
            if (type !== 'continue' && !text) {
                chat.splice(targetId, 1);
                $(`#chat .mes[mesid="${targetId}"]`).remove();
                await c.saveChat();
            }
            throw err;
        }
    }
    paint(true);
    if (aborted) toastr.info('중지했어요.');

    if (type !== 'continue') {
        if (!text.trim()) {
            chat.splice(targetId, 1);
            $(`#chat .mes[mesid="${targetId}"]`).remove();
            await c.saveChat();
            return -1;
        }
        target.swipe_info[0].gen_finished = new Date().toISOString();
        await c.eventSource.emit(c.eventTypes.MESSAGE_RECEIVED, targetId, 'normal');
        c.updateMessageBlock(targetId, target);
        await c.eventSource.emit(c.eventTypes.CHARACTER_MESSAGE_RENDERED, targetId, 'normal');
    }
    await c.saveChat();
    return type === 'continue' ? -1 : targetId;
}

// ---------- busy bar ----------
let busyBar = null;
function showBusy(onStop) {
    hideBusy();
    busyBar = el('div', { class: 'mr-busy' },
        el('i', { class: 'fa-solid fa-scissors fa-fade' }),
        el('span', { text: '중간 리롤 생성 중…' }),
        el('button', { type: 'button', class: 'mr-busy-stop', text: '중지', onclick: onStop }));
    document.body.append(busyBar);
}
function hideBusy() {
    busyBar?.remove();
    busyBar = null;
}

// ---------- buttons ----------
const BTN_TITLE = '중간 리롤 (다시 쓰기 · 부분 갈아끼우기)';
const btnHtml = (where) => `<div title="${BTN_TITLE}" class="mes_button mid_reroll_btn mr-in-${where} fa-solid fa-scissors"></div>`;

function placeButtons(root) {
    const place = getSettings().buttonPlace;
    const wantMenu = place === 'menu' || place === 'both';
    const wantBar = place === 'bar' || place === 'both';
    const extra = root.querySelector('.extraMesButtons');
    const bar = root.querySelector('.mes_buttons');
    const inMenu = extra?.querySelector('.mr-in-menu');
    const inBar = bar?.querySelector(':scope > .mr-in-bar');
    if (wantMenu && extra && !inMenu) extra.insertAdjacentHTML('afterbegin', btnHtml('menu'));
    if (!wantMenu) inMenu?.remove();
    if (wantBar && bar && !inBar) bar.insertAdjacentHTML('afterbegin', btnHtml('bar'));
    if (!wantBar) inBar?.remove();
}

function addButtons() {
    const tpl = document.getElementById('message_template');
    if (tpl) placeButtons(tpl);
    document.querySelectorAll('#chat .mes').forEach(placeButtons);
    addWandItem();
}

function addWandItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('mid_reroll_wand')) return;
    menu.append(el('div', {
        id: 'mid_reroll_wand',
        class: 'list-group-item flex-container flexGap5 interactable',
        tabindex: 0,
        title: '마지막 AI 답변에서 중간 리롤 창을 열어요',
        onclick: () => {
            const chat = ctx().chat;
            let id = chat.length - 1;
            if (chat[id]?.is_system) return toastr.warning('마지막 메시지가 AI 답변이 아니에요.');
            openPopup(id);
        },
    }, el('div', { class: 'fa-solid fa-scissors extensionsMenuExtensionButton' }), el('span', { text: '중간 리롤' })));
}

// ---------- settings panel ----------
function buildSettings() {
    const s = getSettings();
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('mid_reroll_settings')) return;

    const select = (key, options, onChange) => {
        const sel = el('select', { class: 'text_pole' }, options.map(([v, t]) => el('option', { value: v, text: t })));
        sel.value = s[key];
        sel.addEventListener('change', () => { s[key] = sel.value; save(); onChange?.(); });
        return sel;
    };
    const field = (label, control, note) => el('label', { class: 'mr-field' },
        el('span', { class: 'mr-field-label', text: label }), control, note ? el('small', { class: 'mr-note', text: note }) : null);
    const check = (key, label, onChange) => {
        const box = el('input', { type: 'checkbox' });
        box.checked = !!s[key];
        box.addEventListener('change', () => { s[key] = box.checked; save(); onChange?.(); });
        return el('label', { class: 'checkbox_label mr-check' }, box, el('span', { text: label }));
    };
    const profileSelect = (key) => {
        const sel = el('select', { class: 'text_pole' });
        const refill = () => {
            const list = getProfiles();
            sel.replaceChildren(el('option', { value: '', text: list.length ? '— 프로필 선택 —' : '저장된 프로필이 없어요' }),
                ...list.map((p) => el('option', { value: p.id, text: p.name })));
            sel.value = list.some((p) => p.id === s[key]) ? s[key] : '';
        };
        sel.addEventListener('mousedown', refill);
        sel.addEventListener('focus', refill);
        sel.addEventListener('change', () => { s[key] = sel.value; save(); });
        refill();
        return sel;
    };
    const textInput = (key, placeholder) => {
        const inp = el('input', { class: 'text_pole', type: 'text', placeholder, value: s[key] });
        inp.addEventListener('input', () => { s[key] = inp.value.trim(); save(); });
        return inp;
    };

    // API
    const keyIn = el('input', { class: 'text_pole', type: 'password', placeholder: getCustomKey() ? '저장됨 (바꾸려면 새로 입력)' : 'API 키 (필요할 때만)', autocomplete: 'off' });
    keyIn.addEventListener('change', () => {
        setCustomKey(keyIn.value.trim());
        keyIn.value = '';
        keyIn.placeholder = getCustomKey() ? '저장됨 (바꾸려면 새로 입력)' : 'API 키 (필요할 때만)';
        toastr.success(getCustomKey() ? 'API 키를 이 브라우저에 저장했어요.' : 'API 키를 지웠어요.');
    });
    const keyClear = el('button', { type: 'button', class: 'menu_button mr-mini', text: '키 지우기', onclick: () => { setCustomKey(''); keyIn.placeholder = 'API 키 (필요할 때만)'; toastr.success('API 키를 지웠어요.'); } });
    const maxIn = el('input', { class: 'text_pole', type: 'number', min: 0, step: 50, value: s.maxTokens });
    maxIn.addEventListener('input', () => { s.maxTokens = Math.max(0, Number(maxIn.value) || 0); save(); });

    const profBox = el('div', { class: 'mr-sub' }, field('저장 프로필', profileSelect('profileId'), '연결 관리자에 저장한 프로필로 보내요. 캐릭터·월드인포·프리셋 프롬프트는 지금 화면 그대로 쓰고, 보내는 곳만 바뀌어요.'));
    const customBox = el('div', { class: 'mr-sub' },
        field('API 주소', textInput('customUrl', 'https://example.com/v1'), 'OpenAI 호환 주소 (…/v1 까지). /chat/completions 는 자동으로 붙어요.'),
        field('모델', textInput('customModel', '모델 이름')),
        field('API 키', el('div', { class: 'mr-inline' }, keyIn, keyClear), '키는 서버가 아닌 이 브라우저에만 저장돼요. 다른 기기에서는 다시 입력해야 해요.'));
    const maxBox = el('div', { class: 'mr-sub' }, field('최대 응답 길이 (토큰)', maxIn, '0 = 실리태번의 현재 응답 길이 설정을 따라요.'));
    const syncApi = () => {
        profBox.style.display = s.apiMode === 'profile' ? '' : 'none';
        customBox.style.display = s.apiMode === 'custom' ? '' : 'none';
    };

    // Translation
    const trProfBox = el('div', { class: 'mr-sub' }, field('번역용 저장 프로필', profileSelect('trProfileId')));
    const trCustomBox = el('div', { class: 'mr-sub' },
        field('번역용 모델', textInput('trCustomModel', '비워 두면 위 API의 커스텀 모델'), '주소와 키는 위 API 설정의 커스텀 값을 같이 써요.'));
    const trPromptArea = el('textarea', { class: 'text_pole', rows: 3 });
    trPromptArea.value = s.trPrompt;
    trPromptArea.addEventListener('input', () => { s.trPrompt = trPromptArea.value; save(); });
    const trAiBox = el('div', { class: 'mr-sub' },
        field('AI 번역에 쓸 연결', select('trAiApi', [['current', '현재 연결'], ['profile', '실리태번 저장 프로필'], ['custom', '커스텀 (위 API 설정의 주소·키)']], () => syncTr())),
        trProfBox, trCustomBox,
        field('AI 번역 지시문', trPromptArea, '{{lang}} 자리에 언어 이름이 들어가요.'));
    const syncTr = () => {
        trAiBox.style.display = s.trEngine === 'ai' ? '' : 'none';
        trProfBox.style.display = s.trAiApi === 'profile' ? '' : 'none';
        trCustomBox.style.display = s.trAiApi === 'custom' ? '' : 'none';
    };

    // Direction language + presets (per language)
    const presetList = el('div', { class: 'mr-presets' });
    const dirTpl = el('textarea', { class: 'text_pole', rows: 3 });
    const insTpl = el('textarea', { class: 'text_pole', rows: 3 });
    const rwTpl = el('textarea', { class: 'text_pole', rows: 6 });
    dirTpl.addEventListener('input', () => { pack().template = dirTpl.value; save(); });
    insTpl.addEventListener('input', () => { pack().insertNote = insTpl.value; save(); });
    rwTpl.addEventListener('input', () => { pack().rewrite = rwTpl.value; save(); });
    const drawTemplates = () => {
        const p = pack();
        dirTpl.value = p.template;
        insTpl.value = p.insertNote;
        rwTpl.value = p.rewrite;
    };

    const maybeTranslatePreset = async (p, area) => {
        const text = area.value.trim();
        if (!s.dirAutoTranslate || !text || isLang(text, s.dirLang)) return;
        area.disabled = true;
        try {
            const out = await translate(text, DIR_CODE[s.dirLang]);
            p.text = out;
            area.value = out;
            save();
            toastr.success('프리셋 지시를 프롬프트 언어로 번역해 뒀어요.');
        } catch (e) {
            toastr.warning(`번역 실패: ${e?.message || e}`);
        } finally {
            area.disabled = false;
        }
    };

    const drawPresets = () => {
        const list = pack().presets;
        presetList.replaceChildren(...list.map((p, i) => {
            const name = el('input', { class: 'text_pole mr-p-name', type: 'text', value: p.name, placeholder: '버튼 이름' });
            const text = el('textarea', { class: 'text_pole mr-p-text', rows: 2, placeholder: '지시 내용 (한국어로 적어도 자동 번역돼요)' });
            text.value = p.text;
            name.addEventListener('input', () => { p.name = name.value; save(); });
            text.addEventListener('input', () => { p.text = text.value; save(); });
            text.addEventListener('change', () => maybeTranslatePreset(p, text));
            const del = el('button', { type: 'button', class: 'menu_button mr-mini', title: '삭제', onclick: () => { list.splice(i, 1); save(); drawPresets(); } },
                el('i', { class: 'fa-solid fa-trash-can' }));
            const up = el('button', { type: 'button', class: 'menu_button mr-mini', title: '위로', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; save(); drawPresets(); } },
                el('i', { class: 'fa-solid fa-arrow-up' }));
            return el('div', { class: 'mr-preset' }, el('div', { class: 'mr-inline' }, name, up, del), text);
        }));
    };
    const addPreset = el('button', { type: 'button', class: 'menu_button', onclick: () => { pack().presets.push({ name: '새 프리셋', text: '' }); save(); drawPresets(); } },
        el('i', { class: 'fa-solid fa-plus' }), ' 프리셋 추가');
    const resetPresets = el('button', { type: 'button', class: 'menu_button', onclick: async () => {
        if (!await ctx().Popup.show.confirm('프리셋 초기화', '지금 언어의 프리셋을 기본값으로 되돌릴까요? 지금 목록은 사라져요.')) return;
        s.packs[s.dirLang].presets = structuredClone(DEFAULT_PACKS[s.dirLang].presets); save(); drawPresets();
    } }, el('i', { class: 'fa-solid fa-rotate-left' }), ' 기본값');
    const onLang = () => { drawPresets(); drawTemplates(); };

    const depthIn = el('input', { class: 'text_pole', type: 'number', min: 0, max: 20, value: s.injectDepth });
    depthIn.addEventListener('input', () => { s.injectDepth = Math.max(0, Number(depthIn.value) || 0); save(); });
    const resetTpl = el('button', { type: 'button', class: 'menu_button', onclick: () => {
        const d = DEFAULT_PACKS[s.dirLang];
        Object.assign(pack(), { template: d.template, insertNote: d.insertNote, rewrite: d.rewrite });
        save(); drawTemplates();
    } }, el('i', { class: 'fa-solid fa-rotate-left' }), ' 지시문 기본값');

    const group = (title, ...kids) => el('div', { class: 'mr-group' }, el('div', { class: 'mr-group-title', text: title }), ...kids);
    const fold = (title, ...kids) => el('details', { class: 'mr-group mr-adv' }, el('summary', { class: 'mr-group-title', text: title }), ...kids);

    // Layout lives on an inner box: a display rule on .inline-drawer-content would override ST's
    // default "closed" state and make the drawer start open.
    const content = el('div', { class: 'inline-drawer-content' }, el('div', { class: 'mr-settings' },
        group('기본 동작',
            field('창을 열면 먼저 보일 방식', select('defaultMode', [['continue', '✂ 여기서부터 다시 쓰기'], ['replace', '🔁 부분만 갈아끼우기']]), '창 안에서 언제든 바꿀 수 있어요.'),
            field('고르는 방법', select('cutMode', [['both', '문단 클릭 + 드래그 선택 (둘 다)'], ['paragraph', '문단 클릭만'], ['select', '드래그·글자 위치만']])),
            field('끼워넣기 기본값', select('insertMode', [['inline', 'AI 답변 안에 넣기'], ['separate', '유저 메시지로 따로 넣기']])),
            field('다시 쓰기 결과', select('resultMode', [['swipe', '새 스와이프로 추가 (원본 유지)'], ['overwrite', '덮어쓰기 (원본은 되돌리기용으로 보관)']])),
            field('갈아끼우기 결과', select('replaceResult', [['overwrite', '덮어쓰기 (원본은 되돌리기용으로 보관)'], ['swipe', '새 스와이프로 추가 (원본 유지)']])),
            check('announceAsNew', '갈아끼운 뒤 다른 확장에 "새 답변"으로 알리기'),
            el('small', { class: 'mr-note', text: '끄면 연필로 고친 것처럼 "수정됨"으로 알려요. 기억·상태창 확장 대부분은 이것만으로 새 글을 다시 읽어요. 켜면 새 답변에만 도는 기능(답변 점검, 상태 갱신, 자동 재생 등)도 다시 돌아요. 대신 확장에 따라 같은 답변을 한 번 더 처리해서 모델 호출이 늘 수 있어요.' }),
            field('✂ 버튼 위치', select('buttonPlace', [['bar', '메시지 위 버튼 줄에 바로'], ['menu', '··· 메뉴 안에'], ['both', '둘 다']], addButtons),
                '버튼이 안 보이면 "버튼 줄에 바로"로 두세요. 마법봉(확장) 메뉴와 /midreroll 로도 열 수 있어요.'),
        ),
        group('API',
            field('생성에 쓸 연결', select('apiMode', [['current', '현재 연결'], ['profile', '실리태번 저장 프로필'], ['custom', '커스텀 (직접 입력)']], syncApi)),
            profBox, customBox, maxBox,
        ),
        group('번역 (창 안에서만)',
            el('small', { class: 'mr-note', text: '번역은 중간 리롤 창 안에서만 보여 주고, 채팅에는 원문이 그대로 남아요. 번역할 글만 보내고 채팅 기록이나 캐릭터 정보는 보내지 않아요.' }),
            field('번역 엔진', select('trEngine', [['google', '구글 번역 (무료)'], ['ai', 'AI 번역']], syncTr)),
            trAiBox,
            field('번역해서 보여줄 언어', select('trLang', TR_LANGS)),
            field('다시 쓰기 후 확인 창', select('reviewContinue', [['foreign', '결과가 다른 언어일 때만'], ['always', '항상'], ['never', '띄우지 않기']]),
                '새로 쓴 부분만 보여 주고, 번역해 보거나 되돌리거나 다시 쓸 수 있어요.'),
            check('autoTranslateResult', '확인 창이 열리면 바로 번역하기 (다른 언어일 때)'),
            check('trCache', '번역 결과 기억하기', () => { if (!s.trCache) trMemo.clear(); }),
            el('small', { class: 'mr-note', text: '켜면 같은 글을 다시 번역할 때 새로 요청하지 않아요. 이 탭에만 잠깐 기억하고, 채팅 파일이나 서버에는 저장하지 않아요. 끄면 매번 새로 번역해요.' }),
        ),
        fold('전개 지시 · 프리셋',
            field('지시를 보낼 언어', select('dirLang', DIR_LANGS, onLang), '모델에게 보내는 지시문과 프리셋의 언어예요. 대부분의 모델은 영어 지시를 가장 잘 따라요.'),
            check('dirAutoTranslate', '다른 언어로 적은 지시는 자동으로 번역해서 보내기'),
            el('small', { class: 'mr-note', text: '창에서 적은 지시도, 여기서 새로 만든 프리셋도 위 언어로 번역돼요. 번역 엔진은 위 "번역" 설정을 따라요. 프리셋은 언어마다 따로 저장돼요.' }),
            presetList, el('div', { class: 'mr-inline' }, addPreset, resetPresets)),
        fold('고급',
            field('지시문 형식 (다시 쓰기)', dirTpl, '{{direction}} 자리에 입력한 지시가 들어가요. 이번 생성에만 한 번 쓰이고 채팅에는 남지 않아요.'),
            field('끼워넣기 안내문', insTpl, '"답변 안에 넣기"로 끼워넣었을 때만 함께 보내요.'),
            field('부분 갈아끼우기 지시문', rwTpl, '{{before}} {{passage}} {{after}} {{direction}}. {{#direction}}…{{/direction}} 안은 지시가 있을 때만 들어가요.'),
            el('small', { class: 'mr-note', text: '위 세 칸은 "지시를 보낼 언어"마다 따로 저장돼요.' }),
            field('지시 삽입 깊이', depthIn, '0 = 맨 끝 바로 앞. 보통 그대로 두면 돼요.'),
            check('trimOverlap', '모델이 앞부분을 반복하면 자동으로 잘라내기'),
            resetTpl,
        ),
    ));

    const drawer = el('div', { id: 'mid_reroll_settings', class: 'inline-drawer' },
        el('div', { class: 'inline-drawer-toggle inline-drawer-header' },
            el('b', {}, el('i', { class: 'fa-solid fa-scissors' }), ' 중간 리롤'),
            el('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' })),
        content);
    host.append(drawer);
    syncApi();
    syncTr();
    onLang();
}

// ---------- slash command ----------
function registerCommand() {
    const c = ctx();
    if (!c.SlashCommandParser || !c.SlashCommand) return;
    c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
        name: 'midreroll',
        callback: async () => {
            const chat = ctx().chat;
            const id = chat.length - 1;
            setTimeout(() => openPopup(id), 0);
            return '';
        },
        helpString: '<div>마지막 AI 답변에서 중간 리롤 창을 열어요.</div>',
    }));
}

// ---------- init ----------
(function init() {
    const c = ctx();
    getSettings();

    $(document).on('click', '.mid_reroll_btn', function (e) {
        e.stopPropagation();
        const mesId = Number($(this).closest('.mes').attr('mesid'));
        openPopup(mesId);
    });
    document.addEventListener('selectionchange', () => { try { trackChatSelection(); } catch { /* ignore */ } });

    const onReady = () => {
        addButtons();
        buildSettings();
    };
    c.eventSource.on(c.eventTypes.APP_READY, onReady);
    c.eventSource.on(c.eventTypes.CHAT_CHANGED, () => { addButtons(); lastRun = null; });
    c.eventSource.on(c.eventTypes.CHARACTER_MESSAGE_RENDERED, addButtons);
    c.eventSource.on(c.eventTypes.USER_MESSAGE_RENDERED, addButtons);
    c.eventSource.on(c.eventTypes.MESSAGE_UPDATED, addButtons);
    c.eventSource.on(c.eventTypes.MESSAGE_SWIPED, addButtons);
    if (document.getElementById('extensions_settings2')) onReady();
    try { registerCommand(); } catch (e) { console.warn(LOG, 'slash command not registered', e); }
})();
