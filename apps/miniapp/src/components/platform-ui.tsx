import { Children, cloneElement, isValidElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import {
  Avatar,
  Button as VKButton,
  Counter as VKCounter,
  IconButton as VKIconButton,
  Input as VKInput,
  Spinner as VKSpinner,
  Textarea as VKTextarea,
  type ButtonProps as VKButtonProps,
  type InputProps as VKInputProps,
  type TextareaProps as VKTextareaProps,
} from '@vkontakte/vkui';

type Size = 'small' | 'medium' | 'large';
type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';

function vkSize(size: Size): 's' | 'm' | 'l' {
  return size === 'small' ? 's' : size === 'large' ? 'l' : 'm';
}

export function Button({ size = 'medium', variant = 'primary', type = 'button', iconBefore, ...props }: Omit<VKButtonProps, 'size' | 'mode' | 'appearance' | 'before'> & {
  size?: Size;
  variant?: Variant;
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
  iconBefore?: React.ReactNode;
}) {
  return (
    <VKButton
      {...props}
      type={type}
      size={vkSize(size)}
      before={iconBefore}
      mode={variant === 'secondary' ? 'secondary' : variant === 'ghost' ? 'tertiary' : 'primary'}
      appearance={variant === 'destructive' ? 'negative' : 'accent'}
    />
  );
}

export function IconButton({ size: _size = 'small', variant: _variant = 'secondary', type = 'button', ...props }: Omit<VKButtonProps, 'size' | 'mode' | 'appearance'> & {
  size?: Size;
  variant?: Variant;
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
}) {
  return <VKIconButton {...props} type={type} label={props['aria-label'] ?? 'Действие'} size={44} />;
}

type InputSize = 'medium' | 'large';
export function Input({ size: _size, mode: _mode, iconBefore, withClearButton, value, onChange, ...props }: Omit<VKInputProps, 'mode' | 'before'> & {
  size?: InputSize;
  mode?: 'contrast' | 'default';
  iconBefore?: React.ReactNode;
  withClearButton?: boolean;
}) {
  const clear = withClearButton && value ? (
    <VKIconButton
      label="Очистить поле"
      onClick={() => onChange?.({ target: { value: '' } } as React.ChangeEvent<HTMLInputElement>)}
    >
      ×
    </VKIconButton>
  ) : undefined;
  return <VKInput {...props} before={iconBefore} after={clear} value={value} onChange={onChange} mode="default" />;
}

export function Textarea({ ...props }: VKTextareaProps) {
  return <VKTextarea {...props} />;
}

export function Spinner({ size = 20, ...props }: Omit<React.ComponentProps<typeof VKSpinner>, 'size'> & { size?: number | 's' | 'm' | 'l' | 'xl' }) {
  const vkSpinnerSize = typeof size === 'number' ? size <= 20 ? 's' : size <= 32 ? 'm' : 'l' : size;
  return <VKSpinner {...props} size={vkSpinnerSize} />;
}

export function Counter({ value, variant: _variant, rounded: _rounded, ...props }: React.ComponentProps<typeof VKCounter> & {
  value: number | string;
  variant?: 'primary';
  rounded?: boolean;
}) {
  return <VKCounter {...props} mode="primary" appearance="accent">{value}</VKCounter>;
}

type TypographyVariant = 'hero' | 'header' | 'subheader' | 'title' | 'body' | 'body-strong' | 'detail' | 'description' | 'note';
type TypographyColor = 'primary' | 'secondary' | 'tertiary';

function Text({ asChild, variant = 'body', color = 'primary', children, className, ...props }: {
  asChild?: boolean;
  variant?: TypographyVariant;
  color?: TypographyColor;
  children: ReactNode;
  className?: string;
}) {
  const classes = ['vk-text', `vk-text--${variant}`, `vk-text--${color}`, className].filter(Boolean).join(' ');
  if (asChild) {
    const child = Children.only(children);
    if (isValidElement<{ className?: string }>(child)) {
      return cloneElement(child, { ...props, className: [child.props.className, classes].filter(Boolean).join(' ') });
    }
  }
  return <span {...props} className={classes}>{children}</span>;
}

export const Typography = { Text };
export { Avatar };
