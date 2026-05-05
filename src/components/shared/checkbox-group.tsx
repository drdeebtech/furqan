"use client";

/**
 * Reusable checkbox-pill picker for multi-select form fields.
 *
 * Renders a horizontal wrap of clickable pills, each tied to a hidden
 * checkbox with the same `name`. Browser form serialization gives the
 * server `formData.getAll(name)` → string[] natively, so the server
 * action just reads the array — no comma-splitting needed.
 *
 * Used for teacher CV picklists (specialties, languages, recitations)
 * across the admin CV edit page, the teacher self-edit page, and the
 * public /teach-with-us/apply form. Keeps the visual + a11y contract identical
 * everywhere so teachers don't have to relearn the picker.
 */

interface CheckboxGroupProps {
  /** Field label shown to the user (already translated). */
  label: string;
  /** Form field name. Multiple checkboxes share this name. */
  name: string;
  /** Available options. `value` is what gets stored / submitted. */
  options: Array<{ value: string; label: string }>;
  /** Pre-checked values for edit forms. Empty/undefined for create forms. */
  defaultValues?: string[];
  /** Optional helper line under the label. */
  hint?: string;
}

export function CheckboxGroup({
  label,
  name,
  options,
  defaultValues = [],
  hint,
}: CheckboxGroupProps) {
  const checkedSet = new Set(defaultValues);

  return (
    <fieldset>
      <legend className="mb-2 block text-sm font-medium">{label}</legend>
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="glass-pill flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:text-gold has-[:checked]:bg-gold/15 has-[:checked]:text-gold has-[:checked]:border-gold/40"
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={checkedSet.has(o.value)}
              className="accent-gold"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
