/** Locked source capture and candidate staging. Pure analysis lives in domain/. */
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { parseManuscript } from '../domain/manuscript.js';
import { analyzeManuscript, DIAGNOSTIC_LIMITS, ParagraphLimitError } from '../domain/diagnostics.js';
import { fingerprint } from '../domain/lifecycle.js';
import { currentContextBasis, assertContextBasis } from '../storage/chapters.js';
import { withResourceLock } from '../storage/process-lock.js';
import { readChapter, readCandidate, readWorkMeta, listCandidates, stageCandidate } from '../work-store.js';
import { ZhizhangError } from '../errors.js';
export const bodyHash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const fail = (code, message) => { throw new ZhizhangError(code, message); };
function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail('bad_source', '须提供有效对象');
    return value;
}
function sourceSelector(value) {
    const source = object(value);
    if (typeof source.chapter !== 'string' || (source.kind !== 'chapter' && source.kind !== 'candidate') || (source.kind === 'candidate' && typeof source.candidate !== 'string'))
        fail('bad_source', '须指定章节和源类型');
    return { chapter: source.chapter, kind: source.kind, candidate: source.candidate };
}
/** Normalize known fields: JSON property order and unrelated keys do not change identity. */
function sourceIdentity(value) {
    const source = object(value), selector = sourceSelector(source);
    for (const field of ['workIdentity', 'targetRevision', 'bodyHash', 'contextHash']) {
        if (typeof source[field] !== 'string' || !/^[a-f0-9]{64}$/.test(source[field]))
            fail('bad_source', '正文版本标识无效');
    }
    if (source.pace !== null && typeof source.pace !== 'string')
        fail('bad_source', '节奏依据无效');
    return {
        workIdentity: source.workIdentity, chapter: selector.chapter, kind: selector.kind,
        candidate: selector.kind === 'candidate' ? selector.candidate : undefined,
        targetRevision: source.targetRevision, bodyHash: source.bodyHash,
        contextHash: source.contextHash, pace: source.pace,
    };
}
async function workIdentity(dir) {
    return fingerprint({ root: await realpath(dir), key: (await readWorkMeta(dir)).key });
}
async function capture(dir, value) {
    const selector = sourceSelector(value);
    const chapter = await readChapter(dir, selector.chapter), meta = await readWorkMeta(dir);
    const candidate = selector.kind === 'candidate' ? await readCandidate(dir, selector.candidate) : null;
    if (candidate && (candidate.chapterId !== chapter.id || candidate.acceptedAt || candidate.targetRevision !== chapter.revision))
        fail('source_changed', '候选目标已变化或已经采纳');
    if (candidate?.basis)
        await assertContextBasis(dir, candidate.basis, chapter.id);
    const basis = candidate?.basis ?? await currentContextBasis(dir, chapter.id);
    const text = candidate?.body ?? chapter.body;
    if (Buffer.byteLength(text) > DIAGNOSTIC_LIMITS.bodyBytes)
        fail('body_too_large', '正文超过完整扫描上限');
    return { text, basis, source: {
            workIdentity: await workIdentity(dir), chapter: chapter.id, kind: selector.kind,
            candidate: candidate?.id, targetRevision: chapter.revision, bodyHash: bodyHash(text),
            contextHash: fingerprint({ basis, pace: meta.pace ?? null }), pace: meta.pace ?? null,
        } };
}
export async function diagnose(dir, value) {
    const input = object(value);
    return withResourceLock(dir, async () => {
        if (input.mode && input.mode !== 'quick')
            fail('deep_unavailable', '深度能力尚未验证，当前仅支持快速扫描');
        const { text, source } = await capture(dir, input);
        if (input.expectedRevision !== source.targetRevision || input.bodyHash !== source.bodyHash)
            fail('source_changed', '已加载正文发生变化，请刷新后重新扫描');
        try {
            return { source, ...analyzeManuscript(text) };
        }
        catch (error) {
            if (error instanceof ParagraphLimitError)
                fail('too_many_paragraphs', error.message);
            throw error;
        }
    });
}
function paragraphEdits(value) {
    if (!Array.isArray(value) || !value.length || value.length > DIAGNOSTIC_LIMITS.edits)
        fail('bad_revision', '须提供有效的段落修改');
    return value.map(value => {
        const edit = object(value);
        if (!Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) || typeof edit.before !== 'string' || typeof edit.after !== 'string')
            fail('bad_edit', '段落修改格式无效');
        return { start: edit.start, end: edit.end, before: edit.before, after: edit.after };
    }).sort((a, b) => b.start - a.start || b.end - a.end);
}
export async function stageRevisionCandidate(dir, value) {
    const input = object(value);
    if (input.confirm !== true || typeof input.requestId !== 'string' || !/^[\w-]{8,100}$/.test(input.requestId))
        fail('bad_revision', '须明确保存并提供请求标识');
    const requestId = input.requestId, source = sourceIdentity(input.source), edits = paragraphEdits(input.edits);
    const digest = fingerprint({ source, edits });
    return withResourceLock(dir, async () => {
        if (source.workIdentity !== await workIdentity(dir))
            fail('source_changed', '当前作品与编辑来源不一致');
        const catalogue = await listCandidates(dir);
        const prior = catalogue.filter(candidate => candidate.revisionSource?.requestId === requestId);
        if (prior.length) {
            if (prior.length !== 1 || prior[0].revisionSource.digest !== digest)
                fail('request_conflict', '同一请求标识对应不同修改');
            return { candidateId: prior[0].id, reused: true };
        }
        // An unreadable row may contain this request; fail closed instead of duplicating it.
        if (catalogue.some(candidate => candidate.unavailable))
            fail('candidate_unavailable', '候选目录存在不可读记录，请恢复后重试；修改仍保留');
        const current = await capture(dir, source);
        if (fingerprint(current.source) !== fingerprint(source))
            fail('source_changed', '编辑期间正文或依据变化，未保存；请保留修改并重新核对');
        const blocks = parseManuscript(current.text).filter(block => block.kind === 'p');
        let text = current.text, boundary = text.length;
        for (const edit of edits) {
            if (!blocks.some(block => block.start === edit.start && block.end === edit.end) || edit.end > boundary || current.text.slice(edit.start, edit.end) !== edit.before)
                fail('bad_edit', '修改范围不是原始完整段落或存在重叠');
            text = text.slice(0, edit.start) + edit.after + text.slice(edit.end);
            boundary = edit.start;
        }
        if (Buffer.from(text, 'utf8').toString('utf8') !== text)
            fail('bad_edit', '修改包含不完整 Unicode 字符');
        if (text === current.text || !text.trim() || Buffer.byteLength(text) > DIAGNOSTIC_LIMITS.bodyBytes)
            fail('bad_edit', '正文没有变化、为空或超过大小上限');
        const candidate = await stageCandidate(dir, {
            chapterId: source.chapter, body: text, source: 'panel-author', editOf: source.candidate,
            note: '作者在表达诊断中修订', revisionSource: { requestId, digest, pace: source.pace, source },
            capturedBasis: current.basis, expectedRevision: source.targetRevision,
        });
        return { candidateId: candidate.id, reused: false };
    });
}
