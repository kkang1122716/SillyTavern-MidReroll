// Mid Reroll — keep the first part of the last AI reply, cut the rest, optionally insert
// the user's own passage and/or a one-shot direction, then let the model write from there.

const MODULE = 'mid_reroll';
const PROMPT_KEY = 'mid_reroll_direction';
const KEY_STORAGE = 'mid_reroll_custom_key';
const LOG = '[MidReroll]';

// extension_prompt_types.IN_CHAT / extension_prompt_roles.SYSTEM (not exposed via getContext)
const IN_CHAT = 1;
const ROLE_SYSTEM = 0;

const ctx = () => SillyTavern.getContext();

const DEFAULT_PRESETS = Object.freeze([
    { name: '더 길게', text: '이 뒷부분을 지금보다 더 길고 자세하게 써 줘.' },
    { name: '대사 많이', text: '서술보다 대사 비중을 늘려 줘.' },
    { name: '감정 묘사', text: '인물의 감정과 감각 묘사를 더 깊게 해 줘.' },
    { name: '천천히', text: '전개 속도를 늦추고 지금 장면에 더 머물러 줘.' },
    { name: '새 사건', text: '예상하지 못한 사건이나 반전을 하나 넣어 줘.' },
    { name: '유저 대필 금지', text: '유저 캐릭터의 대사, 행동, 생각은 대신 쓰지 마.' },
]);

const DEFAULT_DIRECTION_TEMPLATE =
    '[OOC: For what you write next, follow this direction: {{direction}}. Do not repeat text that is already written.]';
const DEFAULT_INSERT_NOTE =
    '[OOC: The final passage of the reply being continued was written by the user. Pick up right after it and respond to it naturally. Do not repeat or rewrite it.]';

const defaultSettings = Object.freeze({
    cutMode: 'both',          // both | paragraph | select
    insertMode: 'inline',     // inline | separate
    resultMode: 'swipe',      // swipe | overwrite
    apiMode: 'current',       // current | profile | custom
    profileId: '',
    customUrl: '',
    customModel: '',
    maxTokens: 0,             // 0 = follow ST's current response length
    presets: DEFAULT_PRESETS,
    directionTemplate: DEFAULT_DIRECTION_TEMPLATE,
    insertNoteTemplate: DEFAULT_INSERT_NOTE,
    injectDepth: 0,
    trimOverlap: true,
});

function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = structuredClone(defaultSettings);
    const s = extensionSettings[MODULE];
    for (const k of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(s, k)) s[k] = structuredClone(defaultSettings[k]);
    }
    if (!Array.isArray(s.presets)) s.presets = structuredClone(DEFAULT_PRESETS);
    return s;
}
const save = () => ctx().saveSettingsDebounced();

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

/** Finds a displayed snippet inside raw text, ignoring * _ and whitespace differences. Returns raw index or -1. */
function findInRaw(raw, needle) {
    const direct = raw.indexOf(needle);
    if (direct >= 0) return direct;
    const norm = (s) => {
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
    };
    const r = norm(raw), n = norm(needle.trim());
    if (!n.out) return -1;
    const at = r.out.indexOf(n.out);
    return at < 0 ? -1 : r.idx[at];
}

function paraSeparator(raw) {
    return /\n[ \t]*\n/.test(raw) ? '\n\n' : '\n';
}

/** Snaps a raw offset back to the start of the word it falls in. */
function snapToWord(raw, i, floor) {
    while (i > floor && !/\s/.test(raw[i - 1])) i--;
    return i;
}

function fill(tpl, vars) {
    return String(tpl).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Removes text the model repeated from the kept part. Returns the cleaned continuation (no leading space). */
function trimOverlap(kept, cont) {
    let body = cont.replace(/^\s+/, '');
    const keptTrim = kept.trimEnd();
    // Model restated the tail of the kept text
    for (let k = Math.min(keptTrim.length, body.length, 800); k >= 12; k--) {
        const tail = keptTrim.slice(-k).trimStart();
        if (tail.length >= 12 && body.startsWith(tail)) return body.slice(tail.length).replace(/^\s+/, '');
    }
    // Model restated just the (short) last line
    const lastLine = keptTrim.slice(keptTrim.lastIndexOf('\n') + 1).trim();
    if (lastLine.length >= 4 && body.startsWith(lastLine)) return body.slice(lastLine.length).replace(/^\s+/, '');
    // Model restarted the whole reply from the top
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
    // close the inner one first: *... "...  →  *... "..."*
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

// ---------- chat selection tracking (for "drag in chat, then press the button") ----------
let lastChatSelection = null;
function trackChatSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode) return;
    const anchorEl = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const mesText = anchorEl?.closest?.('#chat .mes .mes_text');
    if (!mesText) return;
    const mesId = Number(mesText.closest('.mes')?.getAttribute('mesid'));
    // Start of the selection in document order
    const range = sel.getRangeAt(0);
    const probe = document.createRange();
    probe.setStart(range.startContainer, range.startOffset);
    probe.setEnd(mesText, mesText.childNodes.length);
    const text = probe.toString().slice(0, 40);
    if (Number.isFinite(mesId) && text.trim()) lastChatSelection = { mesId, text, at: Date.now() };
}

// ---------- remember the last run so "same spot, try again" is one click ----------
let lastRun = null; // { chatId, mesId, kept, insert, direction }

// ---------- popup ----------
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
        cut: null,           // raw index where the rewrite starts
        insertMode: s.insertMode,
        resultMode: s.resultMode,
    };

    // Preselect: text dragged in the chat → else the last run's cut on this message
    const selRecent = lastChatSelection && lastChatSelection.mesId === mesId && Date.now() - lastChatSelection.at < 60000;
    if (selRecent && s.cutMode !== 'paragraph') {
        const at = findInRaw(raw, lastChatSelection.text);
        if (at > 0) state.cut = snapToWord(raw, at, 0);
    }
    const sameRun = lastRun && lastRun.chatId === c.chatId && lastRun.mesId === mesId && raw.startsWith(lastRun.kept) && lastRun.kept.length < raw.length;
    if (state.cut == null && sameRun) state.cut = lastRun.kept.length;
    lastChatSelection = null;

    // ----- build UI -----
    const textBox = el('div', { class: 'mr-text' });
    const hint = el('div', { class: 'mr-hint' });
    const status = el('div', { class: 'mr-status' });

    const cutHint = {
        both: '문단을 누르면 그 문단부터, 글자를 드래그하면 그 위치부터 다시 써요.',
        paragraph: '다시 쓰기 시작할 문단을 눌러 주세요.',
        select: '다시 쓰기 시작할 위치를 누르거나 드래그해 주세요.',
    }[s.cutMode] ?? '';
    hint.textContent = cutHint;

    const insertArea = el('textarea', { class: 'text_pole mr-insert', rows: 3, placeholder: '비워 두면 끼워넣지 않아요.' });
    const dirArea = el('textarea', { class: 'text_pole mr-dir', rows: 3, placeholder: '비워 두면 지시 없이 그 지점부터 다시 써요.' });
    if (sameRun) {
        insertArea.value = lastRun.insert ?? '';
        dirArea.value = lastRun.direction ?? '';
    }

    const seg = (options, get, set) => {
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
    };

    const insertSeg = seg([['inline', '답변 안에 넣기'], ['separate', '유저 메시지로 따로']],
        () => state.insertMode, (v) => { state.insertMode = v; });
    const resultSeg = seg([['swipe', '새 스와이프'], ['overwrite', '덮어쓰기']],
        () => state.resultMode, (v) => { state.resultMode = v; });

    const chips = el('div', { class: 'mr-chips' },
        s.presets.filter((p) => p?.name && p?.text).map((p) => el('button', {
            type: 'button', class: 'mr-chip', text: p.name, title: p.text,
            onclick: () => {
                const cur = dirArea.value.trim();
                dirArea.value = cur ? `${cur}\n${p.text}` : p.text;
                dirArea.focus();
            },
        })));

    const apiLabel = el('span', { class: 'mr-api', text: apiDescription() });

    const backup = msg.extra?.mid_reroll_backup;
    const restoreBtn = backup ? el('button', {
        type: 'button', class: 'mr-link', text: '↩ 덮어쓰기 전 원본으로 되돌리기',
        onclick: async () => {
            await restoreBackup(mesId);
            popup.completeCancelled();
        },
    }) : null;

    const root = el('div', { class: 'mr-popup' },
        el('div', { class: 'mr-title' }, el('i', { class: 'fa-solid fa-scissors' }), ' 중간 리롤'),
        el('div', { class: 'mr-section' },
            el('div', { class: 'mr-label', text: '어디서부터 다시 쓸까요?' }),
            hint, textBox, status),
        el('div', { class: 'mr-section' },
            el('div', { class: 'mr-row' }, el('div', { class: 'mr-label', text: '끼워넣을 내용 (선택)' }), insertSeg),
            insertArea),
        el('div', { class: 'mr-section' },
            el('div', { class: 'mr-label', text: '전개 지시 (선택)' }),
            chips, dirArea),
        el('div', { class: 'mr-foot' },
            el('div', { class: 'mr-row' }, el('span', { class: 'mr-small', text: '결과' }), resultSeg),
            el('div', { class: 'mr-row' }, el('span', { class: 'mr-small', text: 'API' }), apiLabel),
            restoreBtn),
    );

    // ----- render message text with the cut marker -----
    const fmt = (t) => {
        try { return c.messageFormatting(t, msg.name, false, false, mesId); } catch { return el('span', { text: t }).innerHTML; }
    };
    const plain = (t) => t.replace(/\*/g, '');

    function render() {
        const cut = state.cut;
        const nodes = [];
        let markerPlaced = false;
        paras.forEach((p, i) => {
            const block = el('div', { class: 'mr-para', 'data-i': i });
            if (cut == null || p.end <= cut) {
                block.innerHTML = fmt(p.text);
            } else if (p.start >= cut) {
                block.classList.add('mr-cut');
                block.innerHTML = fmt(p.text);
                if (!markerPlaced) {
                    nodes.push(el('div', { class: 'mr-marker' }, el('span', { text: '✂ 여기서부터 새로 써요' })));
                    markerPlaced = true;
                }
            } else {
                block.classList.add('mr-split');
                block.append(
                    el('span', { text: plain(p.text.slice(0, cut - p.start)) }),
                    el('span', { class: 'mr-inline-mark' }),
                    el('span', { class: 'mr-cut-inline', text: plain(p.text.slice(cut - p.start)) }),
                );
                markerPlaced = true;
            }
            nodes.push(block);
        });
        textBox.replaceChildren(...nodes);
        if (cut == null) {
            status.textContent = '';
        } else {
            const removed = raw.length - cut;
            status.textContent = cut === 0
                ? '처음부터 전부 다시 써요. (끼워넣을 내용이 있어야 해요)'
                : `앞부분 ${cut.toLocaleString()}자는 그대로 두고, 뒤 ${removed.toLocaleString()}자를 새로 써요.`;
        }
        textBox.classList.toggle('mr-mode-paragraph', s.cutMode === 'paragraph');
    }

    function setCut(i) {
        if (!Number.isFinite(i)) return;
        i = Math.max(0, Math.min(raw.length, i));
        if (i >= raw.trimEnd().length) return toastr.info('맨 끝이라 다시 쓸 부분이 없어요.');
        state.cut = i;
        render();
        const mark = textBox.querySelector('.mr-marker, .mr-inline-mark');
        mark?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function preciseFromPoint(node, offset) {
        const blockEl = (node.nodeType === 1 ? node : node.parentElement)?.closest('.mr-para');
        if (!blockEl || !textBox.contains(blockEl)) return false;
        const p = paras[Number(blockEl.dataset.i)];
        const r = document.createRange();
        r.selectNodeContents(blockEl);
        try { r.setEnd(node, offset); } catch { return false; }
        const shownOff = r.toString().length;
        const rawOff = p.start + mapOffset(p.text, blockEl.textContent, shownOff);
        setCut(snapToWord(raw, rawOff, p.start));
        return true;
    }

    textBox.addEventListener('click', (e) => {
        const blockEl = e.target.closest('.mr-para');
        if (!blockEl) return;
        const sel = window.getSelection();
        if (s.cutMode !== 'paragraph' && sel && !sel.isCollapsed && textBox.contains(sel.anchorNode)) {
            const rg = sel.getRangeAt(0);
            if (preciseFromPoint(rg.startContainer, rg.startOffset)) { sel.removeAllRanges(); return; }
        }
        if (s.cutMode === 'select') {
            const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
            const rg = pos ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY);
            const node = pos?.offsetNode ?? rg?.startContainer;
            const off = pos?.offset ?? rg?.startOffset;
            if (node && preciseFromPoint(node, off)) return;
        }
        setCut(paras[Number(blockEl.dataset.i)].start);
    });

    // Touch devices: long-press selection does not fire click
    let selTimer = null;
    const onSelChange = () => {
        if (s.cutMode === 'paragraph') return;
        clearTimeout(selTimer);
        selTimer = setTimeout(() => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || !textBox.contains(sel.anchorNode)) return;
            const rg = sel.getRangeAt(0);
            preciseFromPoint(rg.startContainer, rg.startOffset);
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
            if (state.cut == null) { toastr.warning('다시 쓰기 시작할 위치를 먼저 골라 주세요.'); return false; }
            const ins = insertArea.value.trim();
            if (state.cut === 0 && !(ins && state.insertMode === 'inline')) {
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

    await runRewrite({
        mesId,
        cut: state.cut,
        insert: insertArea.value,
        direction: dirArea.value,
        insertMode: state.insertMode,
        resultMode: state.resultMode,
    });
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

// ---------- the rewrite ----------
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
    await rerender(mesId);
    await c.saveChat();
    toastr.success('원본으로 되돌렸어요.');
}

async function runRewrite({ mesId, cut, insert, direction, insertMode, resultMode }) {
    const c = ctx();
    const s = getSettings();
    const chat = c.chat;
    const msg = chat[mesId];
    if (!msg || mesId !== chat.length - 1) return toastr.warning('그사이 채팅이 바뀌었어요. 다시 열어 주세요.');

    const raw = String(msg.mes ?? '');
    const before = raw.slice(0, cut);
    let kept = before.replace(/\s+$/, '');
    const gap = before.slice(kept.length);
    const sep = paraSeparator(raw);
    let joiner = gap.includes('\n') ? sep : (gap ? ' ' : '');
    insert = String(insert ?? '').trim();
    direction = String(direction ?? '').trim();
    const inline = !!insert && insertMode === 'inline';
    const separate = !!insert && insertMode === 'separate';

    // The kept part ends here for good (something follows it), so close an open *italic* or "quote"
    if (kept && insert) kept = closeOpenMarks(kept);
    if (inline) {
        kept = kept ? kept + sep + insert : insert;
        joiner = sep;
    }
    if (!kept) return toastr.warning('남길 부분이 없어요.');

    lastRun = { chatId: c.chatId, mesId, kept: raw.slice(0, cut), insert, direction };

    const snap = snapshotOf(msg);
    busy = true;
    const textarea = document.getElementById('send_textarea');
    const draft = textarea?.value ?? '';
    let userMsgAdded = false;
    let newAiIndex = -1;
    try {
        // 1) Cut the message (new swipe or in place)
        if (resultMode === 'swipe') {
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
            msg.swipes.push(kept);
            msg.swipe_info.push({ send_date: now, gen_started: now, gen_finished: null, extra });
            msg.swipe_id = msg.swipes.length - 1;
            msg.mes = kept;
            msg.extra = structuredClone(extra);
        } else {
            msg.extra = msg.extra ?? {};
            msg.extra.mid_reroll_backup = { mes: raw, at: Date.now() };
            setMessageText(msg, kept);
        }
        await rerender(mesId);
        await c.saveChat();

        // 2) One-shot direction for this generation only
        const lines = [];
        if (direction) lines.push(fill(s.directionTemplate, { direction }));
        if (inline) lines.push(s.insertNoteTemplate);
        if (lines.length) c.setExtensionPrompt(PROMPT_KEY, lines.join('\n'), IN_CHAT, Number(s.injectDepth) || 0, false, ROLE_SYSTEM);

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
    if (!separate) {
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
    } else if (userMsgAdded) {
        const last = chat[chat.length - 1];
        if (newAiIndex < 0 && last?.is_user) toastr.info('유저 메시지는 들어갔지만 AI 답변은 생성되지 않았어요.');
    }
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

// ---------- generating with a saved profile or a custom endpoint ----------
async function capturePrompt(type) {
    const c = ctx();
    let captured = null;
    const hook = (data, dryRun) => { if (dryRun) captured = data?.prompt ?? null; };
    c.eventSource.on(c.eventTypes.GENERATE_AFTER_DATA, hook);
    try {
        await c.generate(type, {}, true);
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

async function requestStream(prompt, signal) {
    const c = ctx();
    const s = getSettings();
    const maxTokens = Number(s.maxTokens) > 0 ? Number(s.maxTokens) : defaultMaxTokens();
    if (s.apiMode === 'profile') {
        const svc = c.ConnectionManagerRequestService;
        if (!svc) throw new Error('연결 관리자(Connection Manager)를 쓸 수 없어요.');
        if (!getProfiles().some((p) => p.id === s.profileId)) throw new Error('선택한 저장 프로필을 찾지 못했어요. 설정에서 다시 골라 주세요.');
        return svc.sendRequest(s.profileId, prompt, maxTokens, { stream: true, signal, extractData: true, includePreset: true, includeInstruct: true });
    }
    // custom
    const url = String(s.customUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    if (!url) throw new Error('커스텀 API 주소를 설정에서 입력해 주세요.');
    if (!s.customModel) throw new Error('커스텀 모델 이름을 설정에서 입력해 주세요.');
    const key = getCustomKey();
    const messages = Array.isArray(prompt) ? prompt : [{ role: 'user', content: String(prompt) }];
    return c.ChatCompletionService.processRequest({
        stream: true,
        messages,
        model: s.customModel,
        chat_completion_source: 'custom',
        custom_url: url,
        max_tokens: maxTokens,
        custom_include_headers: key ? `Authorization: ${JSON.stringify('Bearer ' + key)}` : undefined,
    }, {}, true, signal);
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
        const res = await requestStream(prompt, ac.signal);
        if (typeof res === 'function') {
            for await (const chunk of res()) {
                text = String(chunk?.text ?? text);
                paint();
            }
        } else {
            text = typeof res === 'string' ? res : String(res?.content ?? '');
        }
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

// ---------- message button ----------
const BTN_HTML = '<div title="중간 리롤 (여기서부터 다시 쓰기)" class="mes_button mid_reroll_btn fa-solid fa-scissors"></div>';

function addButtons() {
    const tpl = document.querySelector('#message_template .extraMesButtons');
    if (tpl && !tpl.querySelector('.mid_reroll_btn')) tpl.insertAdjacentHTML('afterbegin', BTN_HTML);
    document.querySelectorAll('#chat .mes .extraMesButtons').forEach((n) => {
        if (!n.querySelector('.mid_reroll_btn')) n.insertAdjacentHTML('afterbegin', BTN_HTML);
    });
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

    // API
    const profSel = el('select', { class: 'text_pole' });
    const fillProfiles = () => {
        const list = getProfiles();
        profSel.replaceChildren(el('option', { value: '', text: list.length ? '— 프로필 선택 —' : '저장된 프로필이 없어요' }),
            ...list.map((p) => el('option', { value: p.id, text: p.name })));
        profSel.value = list.some((p) => p.id === s.profileId) ? s.profileId : '';
    };
    profSel.addEventListener('mousedown', fillProfiles);
    profSel.addEventListener('focus', fillProfiles);
    profSel.addEventListener('change', () => { s.profileId = profSel.value; save(); });
    fillProfiles();

    const urlIn = el('input', { class: 'text_pole', type: 'text', placeholder: 'https://example.com/v1', value: s.customUrl });
    urlIn.addEventListener('input', () => { s.customUrl = urlIn.value.trim(); save(); });
    const modelIn = el('input', { class: 'text_pole', type: 'text', placeholder: '모델 이름', value: s.customModel });
    modelIn.addEventListener('input', () => { s.customModel = modelIn.value.trim(); save(); });
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

    const profBox = el('div', { class: 'mr-sub' }, field('저장 프로필', profSel, '연결 관리자에 저장한 프로필로 보내요. 캐릭터·월드인포·프리셋 프롬프트는 지금 화면 그대로 쓰고, 보내는 곳만 바뀌어요.'));
    const customBox = el('div', { class: 'mr-sub' },
        field('API 주소', urlIn, 'OpenAI 호환 주소 (…/v1 까지). /chat/completions 는 자동으로 붙어요.'),
        field('모델', modelIn),
        field('API 키', el('div', { class: 'mr-inline' }, keyIn, keyClear), '키는 서버가 아닌 이 브라우저에만 저장돼요. 다른 기기에서는 다시 입력해야 해요.'));
    const maxBox = el('div', { class: 'mr-sub' }, field('최대 응답 길이 (토큰)', maxIn, '0 = 실리태번의 현재 응답 길이 설정을 따라요.'));
    const syncApi = () => {
        profBox.style.display = s.apiMode === 'profile' ? '' : 'none';
        customBox.style.display = s.apiMode === 'custom' ? '' : 'none';
        maxBox.style.display = s.apiMode === 'current' ? 'none' : '';
    };

    // Presets
    const presetList = el('div', { class: 'mr-presets' });
    const drawPresets = () => {
        presetList.replaceChildren(...s.presets.map((p, i) => {
            const name = el('input', { class: 'text_pole mr-p-name', type: 'text', value: p.name, placeholder: '버튼 이름' });
            const text = el('textarea', { class: 'text_pole mr-p-text', rows: 2, placeholder: '지시 내용' });
            text.value = p.text;
            name.addEventListener('input', () => { p.name = name.value; save(); });
            text.addEventListener('input', () => { p.text = text.value; save(); });
            const del = el('button', { type: 'button', class: 'menu_button mr-mini', title: '삭제', onclick: () => { s.presets.splice(i, 1); save(); drawPresets(); } },
                el('i', { class: 'fa-solid fa-trash-can' }));
            const up = el('button', { type: 'button', class: 'menu_button mr-mini', title: '위로', disabled: i === 0, onclick: () => { [s.presets[i - 1], s.presets[i]] = [s.presets[i], s.presets[i - 1]]; save(); drawPresets(); } },
                el('i', { class: 'fa-solid fa-arrow-up' }));
            return el('div', { class: 'mr-preset' }, el('div', { class: 'mr-inline' }, name, up, del), text);
        }));
    };
    drawPresets();
    const addPreset = el('button', { type: 'button', class: 'menu_button', onclick: () => { s.presets.push({ name: '새 프리셋', text: '' }); save(); drawPresets(); } },
        el('i', { class: 'fa-solid fa-plus' }), ' 프리셋 추가');
    const resetPresets = el('button', { type: 'button', class: 'menu_button', onclick: async () => {
        if (!await ctx().Popup.show.confirm('프리셋 초기화', '프리셋을 기본값으로 되돌릴까요? 지금 목록은 사라져요.')) return;
        s.presets = structuredClone(DEFAULT_PRESETS); save(); drawPresets();
    } }, el('i', { class: 'fa-solid fa-rotate-left' }), ' 기본값');

    // Advanced
    const dirTpl = el('textarea', { class: 'text_pole', rows: 3 });
    dirTpl.value = s.directionTemplate;
    dirTpl.addEventListener('input', () => { s.directionTemplate = dirTpl.value; save(); });
    const insTpl = el('textarea', { class: 'text_pole', rows: 3 });
    insTpl.value = s.insertNoteTemplate;
    insTpl.addEventListener('input', () => { s.insertNoteTemplate = insTpl.value; save(); });
    const depthIn = el('input', { class: 'text_pole', type: 'number', min: 0, max: 20, value: s.injectDepth });
    depthIn.addEventListener('input', () => { s.injectDepth = Math.max(0, Number(depthIn.value) || 0); save(); });
    const trimChk = el('input', { type: 'checkbox' });
    trimChk.checked = !!s.trimOverlap;
    trimChk.addEventListener('change', () => { s.trimOverlap = trimChk.checked; save(); });
    const resetTpl = el('button', { type: 'button', class: 'menu_button', onclick: () => {
        s.directionTemplate = DEFAULT_DIRECTION_TEMPLATE; s.insertNoteTemplate = DEFAULT_INSERT_NOTE;
        dirTpl.value = s.directionTemplate; insTpl.value = s.insertNoteTemplate; save();
    } }, el('i', { class: 'fa-solid fa-rotate-left' }), ' 지시문 기본값');

    const group = (title, ...kids) => el('div', { class: 'mr-group' }, el('div', { class: 'mr-group-title', text: title }), ...kids);

    const content = el('div', { class: 'inline-drawer-content mr-settings' },
        group('기본 동작',
            field('자르는 방법', select('cutMode', [['both', '문단 클릭 + 드래그 선택 (둘 다)'], ['paragraph', '문단 클릭만'], ['select', '드래그·글자 위치만']])),
            field('끼워넣기 기본값', select('insertMode', [['inline', 'AI 답변 안에 넣기'], ['separate', '유저 메시지로 따로 넣기']])),
            field('결과 처리 기본값', select('resultMode', [['swipe', '새 스와이프로 추가 (원본 유지)'], ['overwrite', '덮어쓰기 (원본은 되돌리기용으로 보관)']]),
                '끼워넣기·결과 처리는 창에서 매번 바꿀 수도 있어요.'),
        ),
        group('API',
            field('생성에 쓸 연결', select('apiMode', [['current', '현재 연결'], ['profile', '실리태번 저장 프로필'], ['custom', '커스텀 (직접 입력)']], syncApi)),
            profBox, customBox, maxBox,
        ),
        el('details', { class: 'mr-group mr-adv' },
            el('summary', { class: 'mr-group-title', text: '전개 지시 프리셋' }),
            el('small', { class: 'mr-note', text: '창에서 버튼으로 눌러 지시 칸에 바로 넣을 수 있어요.' }),
            presetList, el('div', { class: 'mr-inline' }, addPreset, resetPresets)),
        el('details', { class: 'mr-group mr-adv' },
            el('summary', { class: 'mr-group-title', text: '고급' }),
            field('지시문 형식', dirTpl, '{{direction}} 자리에 입력한 지시가 들어가요. 이번 생성에만 한 번 쓰이고 채팅에는 남지 않아요.'),
            field('끼워넣기 안내문', insTpl, '"답변 안에 넣기"로 끼워넣었을 때만 함께 보내요.'),
            field('지시 삽입 깊이', depthIn, '0 = 맨 끝 바로 앞. 보통 그대로 두면 돼요.'),
            el('label', { class: 'checkbox_label mr-check' }, trimChk, el('span', { text: '모델이 앞부분을 반복하면 자동으로 잘라내기' })),
            resetTpl,
        ),
    );

    const drawer = el('div', { id: 'mid_reroll_settings', class: 'inline-drawer' },
        el('div', { class: 'inline-drawer-toggle inline-drawer-header' },
            el('b', {}, el('i', { class: 'fa-solid fa-scissors' }), ' 중간 리롤'),
            el('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' })),
        content);
    host.append(drawer);
    syncApi();
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
    if (document.getElementById('extensions_settings2')) onReady();
    try { registerCommand(); } catch (e) { console.warn(LOG, 'slash command not registered', e); }
})();
