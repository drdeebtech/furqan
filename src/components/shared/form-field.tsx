import type { InputHTMLAttributes, ReactNode } from "react";

const DEFAULT_INPUT_CLASS =
  "glass-input w-full rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "name" | "className" | "type"> {
  /** Label text. Pass through `t(ar, en)` for bilingual. Required. */
  label: string;
  /** Input name + id. Used for both `htmlFor` and the form-data key. Required. */
  name: string;
  /** Override input type (text, email, tel, password, number, datetime-local, etc.). Default 'text'. */
  type?: string;
  /** When set, renders a small "(optional)" hint next to the label. */
  optional?: boolean;
  /** Help text below the input. */
  hint?: ReactNode;
  /** Error message below the input. Displayed in error tone. */
  error?: ReactNode;
  /**
   * If provided, replaces the default `<input>` with custom children
   * (select, textarea, multi-input compositions). The label + hint +
   * error chrome stays consistent across input shapes.
   */
  children?: ReactNode;
  /** Override the default `glass-input` class on the input element. */
  inputClassName?: string;
}

/**
 * Bilingual-friendly form field wrapper.
 *
 * Default usage — text input:
 *   <FormField label={t("الاسم", "Name")} name="full_name" required placeholder="..." />
 *
 * Select / textarea — pass `children` and the wrapper just renders
 * label + chrome:
 *   <FormField label={t("الدولة", "Country")} name="country">
 *     <select name="country" className="...">{...}</select>
 *   </FormField>
 *
 * Error / hint:
 *   <FormField label="..." name="..." error={state.error} hint="Format: +20 ..." />
 *
 * Replaces the inline `<div><label/><input/></div>` pattern that's
 * scattered across ~190 form sites. Migration is incremental — this
 * primitive is purely additive, doesn't break anything.
 */
export function FormField({
  label,
  name,
  type = "text",
  optional = false,
  hint,
  error,
  children,
  inputClassName,
  ...inputProps
}: FormFieldProps) {
  const fieldClass = inputClassName ?? DEFAULT_INPUT_CLASS;

  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
        {optional ? <span className="ms-1 text-xs text-muted">(optional)</span> : null}
      </label>
      {children ?? (
        <input id={name} name={name} type={type} className={fieldClass} {...inputProps} />
      )}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-error">{error}</p> : null}
    </div>
  );
}
