// Copyright (C) 2024–2026 Aiko Hanasaki
// SPDX-License-Identifier: AGPL-3.0-only

import { getCurrentChatId, name1, name2, chat_metadata, saveMetadata, getRequestHeaders } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { createNewWorldInfo, METADATA_KEY, world_names } from '../../../world-info.js';
import { translate } from '../../../i18n.js';

const MODULE_NAME = 'STMemoryBooks-AutoCreate';
const creating = new WeakMap();

/**
 * i18n helper: translate with Mustache-style {{var}} interpolation
 * Mirrors the local 'tr' used in index.js to keep calls like i18n('key','fallback',{...})
 * compatible with SillyTavern's translate(fallback, key).
 */
function i18n(key, fallback, params) {
    const localized = translate(fallback, key);
    if (!params) return localized;
    return localized.replace(/{{\s*(\w+)\s*}}/g, (m, p1) => {
        const v = params[p1];
        return v !== undefined && v !== null ? String(v) : '';
    });
}

/**
 * Generate lorebook name from template with auto-numbering
 * @param {string} template - Template string with {{chat}}, {{char}}, {{user}} placeholders
 * @returns {string} Generated lorebook name with auto-numbering if needed
 */
export function generateLorebookName(template) {
    // Validate template - fallback to default if empty
    if (!template || template.trim() === '') {
        template = i18n('STMemoryBooks_LorebookNameTemplatePlaceholder', 'LTM - {{char}} - {{chat}}');
    }

    // Template substitutions
    const chatId = getCurrentChatId() || i18n('common.unknown', 'Unknown');
    const charName = name2 || i18n('common.unknown', 'Unknown');
    const userName = name1 || i18n('addlore.defaults.user', 'User');

    let name = template
        .replace(/\{\{chat\}\}/g, chatId)
        .replace(/\{\{char\}\}/g, charName)
        .replace(/\{\{user\}\}/g, userName);

    // Sanitize for filesystem - only block reserved characters, allow Unicode
    // Reserve 4 chars for potential " 999" suffix
    name = name.replace(/[\/\\:*?"<>|]/g, '_').replace(/_{2,}/g, '_').substring(0, 60).trim();

    // Auto-numbering if name exists (with null safety)
    if (!world_names || !world_names.includes(name)) return name;

    for (let i = 2; i <= 999; i++) {
        const numberedName = `${name} ${i}`;
        if (!world_names.includes(numberedName)) return numberedName;
    }

    return `${name} ${Date.now()}`; // Fallback with timestamp
}

/**
 * Auto-create and bind a lorebook using the configured template
 * @param {string} template - Name template to use
 * @param {string} context - Context description for logging (e.g., 'chat', 'auto-summary')
 * @returns {Promise<{success: boolean, name?: string, error?: string}>}
 */
export async function autoCreateLorebook(template, context = 'chat', options = {}) {
    const chat = getContext().chat;
    if (!chat) return { success: false, error: '채팅방을 먼저 열어 주세요.' };
    const mode = options.mode || 'chat';
    const pending = creating.get(chat);
    if (pending) return pending.mode === mode ? pending.promise : { success: false, error: '다른 연결 대상의 로어북을 생성 중입니다.' };
    const promise = createAndBindLorebook(template, context, { ...options, mode });
    creating.set(chat, { mode, promise });
    try { return await promise; } finally { if (creating.get(chat)?.promise === promise) creating.delete(chat); }
}

async function createAndBindLorebook(template, context, { mode, canBind = () => true }) {
    const origin = getContext();
    const chatId = getCurrentChatId();
    const character = origin.characters?.[origin.characterId];
    const current = () => getCurrentChatId() === chatId && getContext().chat === origin.chat
        && getContext().groupId === origin.groupId && getContext().characters?.[getContext().characterId]?.avatar === character?.avatar;
    const binding = () => mode === 'character' ? character?.data?.extensions?.world : origin.chatMetadata?.[METADATA_KEY];
    const originalBinding = binding();
    try {
        if (!chatId || !['chat', 'character'].includes(mode) || (mode === 'character' && (origin.groupId || !character?.avatar))) {
            throw new Error('로어북을 연결할 채팅 또는 캐릭터를 확인해 주세요.');
        }
        const newLorebookName = generateLorebookName(template);

        console.log(i18n('autocreate.log.creating', `${MODULE_NAME}: Auto-creating lorebook "{{name}}" for {{context}}`, { name: newLorebookName, context }));
        const created = await createNewWorldInfo(newLorebookName);

        if (created) {
            // Never attach a newly created book to a different chat or overwrite a
            // binding changed while the create request was in flight.
            if (!current() || binding() !== originalBinding || !canBind()) throw new Error(`로어북은 만들었지만 채팅 또는 연결이 바뀌었습니다. 목록에서 ${newLorebookName}을 선택해 주세요.`);
            if (mode === 'character') {
                const response = await fetch('/api/characters/merge-attributes', {
                    method: 'POST', headers: getRequestHeaders(),
                    body: JSON.stringify({ avatar: character.avatar, data: { extensions: { world: newLorebookName } } }),
                });
                if (!response.ok) throw new Error(`로어북은 만들었지만 캐릭터 연결에 실패했습니다. 목록에서 ${newLorebookName}을 선택해 주세요.`);
                character.data ||= {}; character.data.extensions ||= {};
                character.data.extensions.world = newLorebookName;
                if (character.json_data) {
                    const data = JSON.parse(character.json_data);
                    data.data ||= {}; data.data.extensions ||= {}; data.data.extensions.world = newLorebookName;
                    character.json_data = JSON.stringify(data);
                }
                if (!current()) throw new Error('원래 캐릭터에 로어북을 연결했지만 채팅이 바뀌어 수집을 중단했습니다.');
                const field = document.querySelector('#character_world');
                if (field) field.value = newLorebookName;
                const jsonField = document.querySelector('#character_json_data');
                if (jsonField && character.json_data) jsonField.value = character.json_data;
            } else {
                chat_metadata[METADATA_KEY] = newLorebookName;
                try { await saveMetadata(); }
                catch (error) {
                    if (current() && chat_metadata[METADATA_KEY] === newLorebookName) {
                        if (originalBinding === undefined) delete chat_metadata[METADATA_KEY];
                        else chat_metadata[METADATA_KEY] = originalBinding;
                    }
                    throw error;
                }
                if (!current()) throw new Error('원래 채팅에 로어북을 연결했지만 채팅이 바뀌어 수집을 중단했습니다.');
                $('.chat_lorebook_button').addClass('world_set');
            }

            console.log(i18n('autocreate.log.created', `${MODULE_NAME}: Successfully created and bound lorebook "{{name}}"`, { name: newLorebookName }));
            toastr.success(i18n('autocreate.toast.createdBound', 'Created and bound lorebook "{{name}}"', { name: newLorebookName }), i18n('autocreate.toast.title', 'STMemoryBooks'));

            return { success: true, name: newLorebookName };
        } else {
            console.error(i18n('autocreate.log.createFailed', `${MODULE_NAME}: Failed to create lorebook`));
            return { success: false, error: i18n('autocreate.errors.failedAutoCreate', 'Failed to auto-create lorebook.') };
        }
    } catch (error) {
        console.error(i18n('autocreate.log.createError', `${MODULE_NAME}: Error creating lorebook:`), error);
        return { success: false, error: i18n('autocreate.errors.failedAutoCreateWithMessage', 'Failed to auto-create lorebook: {{message}}', { message: error.message }) };
    }
}
