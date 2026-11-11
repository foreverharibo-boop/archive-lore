// Archive Lore modifications Copyright (C) 2026 foreverharibo-boop
// SPDX-License-Identifier: AGPL-3.0-only
// One local, consistent outline set; no icon-font dependency.
const paths = {
    book: '<path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V4Zm0 12h14M8 4v8l3-2 3 2V4"/>',
    settings: '<path d="m9 3-.5 2-2 1-2-.5L2.5 9 4 10.5v3L2.5 15l2 3.5 2-.5 2 1 .5 2h6l.5-2 2-1 2 .5 2-3.5-1.5-1.5v-3L21.5 9l-2-3.5-2 .5-2-1-.5-2Z"/><circle cx="12" cy="12" r="3"/>',
    tools: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    left: '<path d="m15 5-7 7 7 7"/>',
    layers: '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
};
export const loreIcon = name => `<svg class="al-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.book}</svg>`;
