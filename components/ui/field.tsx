"use client";

/**
 * Warm-paper form field primitives + confirmation dialog + shared button kit.
 *
 * Tokens come from app/globals.css (--bg, --bg-panel, --border, --accent,
 * --accent-strong, --accent-hover, --text, --text-muted, --text-dim,
 * --radius-control, --radius-card, --shadow-card, --shadow-pop, --space-*,
 * --text-*, --control-height-*, --control-touch). No global CSS edits — focus
 * glow + invalid state are implemented inline via React state on focus / blur.
 */
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEventHandler,
  type ReactElement,
  type ReactNode,
} from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";

/* ────────────────────────── Field wrapper ────────────────────────── */

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** When true, the label is rendered with a required asterisk. */
  required?: boolean;
  children: ReactNode;
  /** Inline style overrides for the outer wrapper. */
  style?: CSSProperties;
  id?: string;
}

export function Field({ label, hint, error, required, children, style, id }: FieldProps) {
  const autoId = useId();
  const childId = isValidElement(children) ? (children.props as { id?: string }).id : undefined;
  const fieldId = id || childId || autoId;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = !error && hint ? `${fieldId}-hint` : undefined;
  const describedBy = errorId || hintId;

  let enhancedChildren = children;
  if (isValidElement(children)) {
    enhancedChildren = cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, {
      id: childId || fieldId,
      "aria-describedby": (children.props as { "aria-describedby"?: string })["aria-describedby"] || describedBy,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0, ...style }}>
      <label
        htmlFor={fieldId}
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          color: error ? "var(--accent)" : "var(--text-muted)",
          letterSpacing: "0.01em",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
        }}
      >
        {label}
        {required && <span style={{ color: "var(--accent)" }}>*</span>}
      </label>
      {enhancedChildren}
      {error ? (
        <FieldError id={errorId}>{error}</FieldError>
      ) : hint ? (
        <span id={hintId} style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", lineHeight: 1.4 }}>{hint}</span>
      ) : null}
    </div>
  );
}

function FieldError({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <span
      id={id}
      role="alert"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        fontSize: "var(--text-md)",
        color: "var(--accent)",
        lineHeight: 1.3,
        marginTop: "calc(var(--space-1) / 2)",
      }}
    >
      <AlertCircle size={12} aria-hidden="true" />
      {children}
    </span>
  );
}

/* ──────────────────────── Form group / card ──────────────────────── */

export function FieldGroup({
  label,
  children,
  style,
}: {
  label: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "calc(var(--space-5) - var(--space-1))",
        padding: "var(--space-5) calc(var(--space-5) + var(--space-1))",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        minWidth: 0,
        ...style,
      }}
    >
      <div
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "calc(var(--space-5) - var(--space-1))", minWidth: 0 }}>{children}</div>
    </section>
  );
}

/* ──────────────────────── Inputs / selects ──────────────────────── */

interface InputShellStyleOptions {
  invalid: boolean;
}

function inputShellStyle({ invalid }: InputShellStyleOptions): CSSProperties {
  return {
    padding: "var(--space-3) calc(var(--space-4) + var(--space-1) / 2)",
    background: "var(--bg)",
    border: `1px solid ${invalid ? "var(--accent)" : "var(--border)"}`,
    borderRadius: "var(--radius-control)",
    color: "var(--text)",
    fontSize: "var(--text-md)",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color var(--dur-fast) var(--ease-out-warm), box-shadow var(--dur-fast) var(--ease-out-warm)",
  };
}

/** Internal: applied border + box-shadow on focus. */
function focusGlowStyle(focused: boolean, invalid: boolean): CSSProperties {
  if (!focused) return {};
  return {
    borderColor: invalid ? "var(--accent)" : "var(--accent)",
    boxShadow: "var(--focus-ring)",
  };
}

/* ─── Text input ─── */

export interface TextInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  invalid?: boolean;
  error?: string | null;
  onBlurValidate?: () => void;
  disabled?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  id?: string;
  name?: string;
  style?: CSSProperties;
  className?: string;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  invalid,
  error,
  onBlurValidate,
  disabled,
  onKeyDown,
  autoComplete,
  spellCheck,
  id,
  name,
  style,
  className,
}: TextInputProps) {
  const [focused, setFocused] = useState(false);
  const isInvalid = Boolean(invalid || error);
  return (
    <input
      id={id}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      onKeyDown={onKeyDown}
      autoComplete={autoComplete}
      spellCheck={spellCheck}
      aria-invalid={isInvalid || undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        onBlurValidate?.();
      }}
      className={className}
      style={{
        ...inputShellStyle({ invalid: isInvalid }),
        ...focusGlowStyle(focused, isInvalid),
        fontFamily: mono ? "var(--font-mono)" : "inherit",
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    />
  );
}

/* ─── Number input ─── */

export interface NumInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  error?: string | null;
  onBlurValidate?: () => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  style?: CSSProperties;
  className?: string;
}

export function NumInput({
  value,
  onChange,
  placeholder,
  invalid,
  error,
  onBlurValidate,
  disabled,
  id,
  name,
  style,
  className,
}: NumInputProps) {
  const [focused, setFocused] = useState(false);
  const isInvalid = Boolean(invalid || error);
  return (
    <input
      id={id}
      name={name}
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={isInvalid || undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        onBlurValidate?.();
      }}
      className={className}
      style={{
        ...inputShellStyle({ invalid: isInvalid }),
        ...focusGlowStyle(focused, isInvalid),
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    />
  );
}

/* ─── Secret (password) input with show / hide ─── */

export interface SecretInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  error?: string | null;
  onBlurValidate?: () => void;
  disabled?: boolean;
  showLabel?: string;
  hideLabel?: string;
  id?: string;
  name?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  style?: CSSProperties;
  className?: string;
  "aria-describedby"?: string;
}

export function SecretInput({
  value,
  onChange,
  placeholder,
  invalid,
  error,
  onBlurValidate,
  disabled,
  showLabel = "Show password",
  hideLabel = "Hide password",
  id,
  name,
  autoComplete = "off",
  autoFocus,
  required,
  onKeyDown,
  style,
  className,
  "aria-describedby": ariaDescribedBy,
}: SecretInputProps) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const isInvalid = Boolean(invalid || error);

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }} className={className}>
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
        onKeyDown={onKeyDown}
        spellCheck={false}
        aria-invalid={isInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlurValidate?.();
        }}
        style={{
          ...inputShellStyle({ invalid: isInvalid }),
          ...focusGlowStyle(focused, isInvalid),
          paddingRight: "var(--control-touch, 44px)",
          fontFamily: "var(--font-mono)",
          opacity: disabled ? 0.6 : 1,
        }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        title={visible ? hideLabel : showLabel}
        className="ui-focus-ring"
        style={{
          position: "absolute",
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          width: "var(--control-touch, 44px)",
          height: "var(--control-touch, 44px)",
          minWidth: "var(--control-touch, 44px)",
          minHeight: "var(--control-touch, 44px)",
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-control)",
        }}
      >
        {visible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
      </button>
    </div>
  );
}

/* ─── Select ─── */

export type SelectOptionItem = string | { value: string; label: ReactNode | string };
export type SelectOption = SelectOptionItem;

export interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: readonly SelectOptionItem[];
  required?: boolean;
  placeholder?: string;
  invalid?: boolean;
  error?: string | null;
  disabled?: boolean;
  id?: string;
  name?: string;
  ariaLabel?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  title?: string;
  style?: CSSProperties;
  className?: string;
}

export function Select({
  value,
  onChange,
  options,
  required,
  placeholder,
  invalid,
  error,
  disabled,
  id,
  name,
  ariaLabel,
  "aria-label": ariaLabelProp,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  title,
  style,
  className,
}: SelectProps) {
  const [focused, setFocused] = useState(false);
  const isInvalid = Boolean(invalid || error);
  const effectiveAriaLabel = ariaLabel ?? ariaLabelProp;

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        width: style?.width ?? "100%",
        minWidth: style?.minWidth ?? 0,
        flex: style?.flex,
      }}
      className={className}
    >
      <select
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={isInvalid || undefined}
        aria-label={effectiveAriaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        title={title}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...inputShellStyle({ invalid: isInvalid }),
          ...focusGlowStyle(focused, isInvalid),
          color: value ? "var(--text)" : "var(--text-dim)",
          appearance: "none",
          WebkitAppearance: "none",
          width: "100%",
          paddingRight: "var(--space-8)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          ...style,
        }}
      >
        {!required && <option value="" style={{ background: "var(--bg-panel)", color: "var(--text)" }}>{placeholder ?? ""}</option>}
        {required && placeholder !== undefined && (
          <option value="" style={{ background: "var(--bg-panel)", color: "var(--text)" }}>
            {placeholder}
          </option>
        )}
        {options.map((option) => {
          if (typeof option === "string") {
            return (
              <option key={option} value={option} style={{ background: "var(--bg-panel)", color: "var(--text)" }}>
                {option}
              </option>
            );
          }
          return (
            <option key={option.value} value={option.value} style={{ background: "var(--bg-panel)", color: "var(--text)" }}>
              {option.label}
            </option>
          );
        })}
      </select>
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ position: "absolute", right: "var(--space-4)", color: "var(--text-dim)", pointerEvents: "none" }}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}

/* ─── Checkbox ─── */

interface CheckProps {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

export function Check({ label, checked, onChange, disabled }: CheckProps) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-3)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "var(--text-md)",
        color: disabled ? "var(--text-dim)" : "var(--text-muted)",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: disabled ? "not-allowed" : "pointer" }}
      />
      {label}
    </label>
  );
}

/* ─── Accessible Switch ─── */

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  ariaLabel?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  title?: string;
  style?: CSSProperties;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  disabled,
  id,
  name,
  ariaLabel,
  "aria-label": ariaLabelProp,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  title,
  style,
  className,
}: SwitchProps) {
  const effectiveAriaLabel = ariaLabel ?? ariaLabelProp;

  return (
    <button
      type="button"
      role="switch"
      id={id}
      name={name}
      aria-checked={checked}
      aria-label={effectiveAriaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (!disabled) {
          onChange(!checked);
        }
      }}
      className={["ui-focus-ring", className].filter(Boolean).join(" ") || undefined}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "var(--control-touch, 44px)",
        minHeight: "var(--control-touch, 44px)",
        padding: 0,
        background: "none",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        flexShrink: 0,
        ...style,
      }}
    >
      <span
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          width: 36,
          height: 20,
          borderRadius: 10,
          background: checked ? "var(--accent)" : "var(--switch-track, var(--border))",
          transition: "background var(--dur-fast) var(--ease-out-warm)",
          padding: 2,
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            background: "var(--switch-thumb, var(--on-accent))",
            transform: checked ? "translateX(16px)" : "translateX(0px)",
            transition: "transform var(--dur-fast) var(--ease-out-warm)",
            boxShadow: "var(--switch-thumb-shadow, var(--shadow-card))",
          }}
        />
      </span>
    </button>
  );
}

/* ─── Shared Button ─── */

export interface ButtonProps {
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  id?: string;
  name?: string;
  autoFocus?: boolean;
  title?: string;
  "aria-label"?: string;
  ariaLabel?: string;
}

export function Button({
  type = "button",
  variant = "primary",
  size = "md",
  busy = false,
  disabled = false,
  onClick,
  children,
  style,
  className,
  id,
  name,
  autoFocus,
  title,
  "aria-label": ariaLabelProp,
  ariaLabel,
}: ButtonProps) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isInactive = disabled || busy;
  const effectiveAriaLabel = ariaLabel ?? ariaLabelProp;

  const isPrimary = variant === "primary" || variant === "danger";
  const isSecondary = variant === "secondary";

  let bg = "var(--accent-strong)";
  let hoverBg = "var(--accent-hover)";
  let color = "var(--on-accent)";
  let border = "none";

  if (isSecondary) {
    bg = "transparent";
    hoverBg = "var(--bg-subtle)";
    color = "var(--text-muted)";
    border = "1px solid var(--border)";
  }

  const currentBg = hovered && !isInactive ? hoverBg : bg;

  const padding =
    size === "sm"
      ? "var(--space-1) var(--space-3)"
      : size === "lg"
        ? "var(--space-3) calc(var(--space-6) + var(--space-1))"
        : "var(--space-3) calc(var(--space-5) + var(--space-1))";

  const minHeight =
    size === "sm"
      ? "var(--control-height-sm, 28px)"
      : size === "lg"
        ? "var(--control-height-lg, 40px)"
        : "var(--control-height, 36px)";

  return (
    <button
      type={type}
      id={id}
      name={name}
      disabled={isInactive}
      autoFocus={autoFocus}
      title={title}
      aria-label={effectiveAriaLabel}
      aria-busy={busy || undefined}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-2)",
        minHeight,
        padding,
        background: currentBg,
        border,
        borderRadius: "var(--radius-control)",
        color,
        fontSize: "var(--text-base)",
        fontWeight: isPrimary ? 600 : 500,
        cursor: busy ? "wait" : disabled ? "not-allowed" : "pointer",
        opacity: isInactive ? 0.7 : 1,
        outline: "none",
        boxShadow: focused ? "var(--focus-ring)" : undefined,
        transition:
          "background var(--dur-fast) var(--ease-out-warm), box-shadow var(--dur-fast) var(--ease-out-warm), opacity var(--dur-fast) var(--ease-out-warm)",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export const PrimaryButton = Button;

/* ──────────────────── Convenience hooks ──────────────────── */

/**
 * Tiny controller for inline validation: validate on blur (and on demand from
 * submit), clear on change. Caller owns the message strings and the validator.
 */
export function useFieldValidation(validate: () => string | null) {
  const [error, setError] = useState<string | null>(null);
  const validateRef = useRef(validate);
  validateRef.current = validate;

  const onBlur = useCallback(() => {
    setError(validateRef.current());
  }, []);

  const onChange = useCallback(() => {
    setError((prev) => (prev === null ? null : null));
  }, []);

  const onSubmit = useCallback((): string | null => {
    const e = validateRef.current();
    setError(e);
    return e;
  }, []);

  return { error, onBlur, onChange, onSubmit };
}

/* ──────────────────── Confirm dialog ──────────────────── */

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ariaLabel={typeof title === "string" ? title : undefined}
        style={{
          width: 420,
          maxWidth: "min(92vw, 420px)",
          padding: "calc(var(--space-8) - var(--space-1))",
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <div style={{ height: "var(--space-4)" }} />
        {description && (
          <p
            style={{
              margin: "0 0 calc(var(--space-6) + var(--space-1))",
              fontSize: "var(--text-base)",
              lineHeight: 1.55,
              color: "var(--text-muted)",
            }}
          >
            {description}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-4)" }}>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel ?? "Cancel"}
          </Button>
          <Button
            type="button"
            variant={danger ? "danger" : "primary"}
            busy={busy}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
