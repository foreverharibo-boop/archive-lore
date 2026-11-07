// SPDX-License-Identifier: AGPL-3.0-only
// A parent dialog can remain open while a child saves newer settings. Only
// submit values actually edited in that dialog, never its stale initial values.
const snapshots = new WeakMap();
const titleControls = '#stmb-title-format-select, #stmb-custom-title-format';

function valueOf(control) {
    if (control.type === 'checkbox' || control.type === 'radio') return control.checked;
    if (control.multiple) return JSON.stringify(Array.from(control.selectedOptions, x => x.value));
    return control.value;
}

export function captureSettingsForm(root) {
    const values = new WeakMap();
    for (const control of root.querySelectorAll('input, select, textarea')) values.set(control, valueOf(control));
    snapshots.set(root, values);
}

export function acknowledgeSettingsControl(root, control) {
    const values = snapshots.get(root);
    if (!values || !control) return;
    values.set(control, valueOf(control));
    // These two fields jointly describe one title format.
    if (control.matches(titleControls)) {
        for (const field of root.querySelectorAll(titleControls)) values.set(field, valueOf(field));
    }
}

export function changedSettingsForm(root) {
    const values = snapshots.get(root);
    if (!values) return root;
    const changed = control => control && values.has(control) && values.get(control) !== valueOf(control);
    const titleChanged = Array.from(root.querySelectorAll(titleControls)).some(changed);
    return {
        querySelector(selector) {
            const control = root.querySelector(selector);
            return control && (changed(control) || (titleChanged && control.matches(titleControls))) ? control : null;
        },
    };
}
